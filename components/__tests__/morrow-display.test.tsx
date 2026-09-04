// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MorrowConfig } from '@/lib/morrow/types';
import { morrowConfig } from '@/morrow.config';

/**
 * The Player runs unattended for weeks, so the risky parts are the ones a
 * person is not there to correct: whether a poll disturbs what is on screen,
 * whether pause sticks, and what happens when the server goes away. Two bugs
 * lived here before, both about a poll resetting state, so both are pinned.
 */

const fetchConfig = vi.fn();
const fetchData = vi.fn();
const cacheConfig = vi.fn();
const readCached = vi.fn();

vi.mock('@/lib/morrow/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/morrow/client')>();
  return {
    ...actual,
    fetchRemoteMorrowConfig: () => fetchConfig(),
    fetchBlockData: () => fetchData(),
    cacheMorrowConfig: (config: MorrowConfig) => cacheConfig(config),
    readStoredMorrowConfig: () => readCached(),
    reloadAllowed: () => true,
  };
});

const { MorrowDisplay } = await import('@/components/morrow-display');

const page = (id: string, label: string) => ({
  id,
  label,
  layout: { columns: 12, rows: 5 },
  blocks: [],
});

function config(over: Partial<MorrowConfig> = {}): MorrowConfig {
  return { ...morrowConfig, name: 'Lobby', ...over };
}

const twoPages = config({
  pages: [page('one', 'One'), page('two', 'Two')],
  rotationSeconds: 30,
});

/**
 * Move the fake clock forward and let every promise it released settle.
 * The mount sync is scheduled with requestAnimationFrame, which a fake clock
 * fires at about 16ms, so settling has to step past that.
 */
async function tick(ms = 20) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const settle = () => tick(20);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'setInterval',
      'clearTimeout',
      'clearInterval',
      'Date',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  });
  fetchData.mockResolvedValue({});
  readCached.mockReturnValue(config());
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('first paint', () => {
  it('shows the server-rendered configuration before any fetch', () => {
    fetchConfig.mockResolvedValue({
      config: config(),
      updatedAt: 't',
      staleClient: false,
    });
    render(<MorrowDisplay initialConfig={config({ name: 'Reception' })} />);
    // No await: this is what a screen displays on the very first frame.
    expect(screen.getByText('Reception')).toBeTruthy();
  });

  it('shows one page without tabs or player controls', async () => {
    fetchConfig.mockResolvedValue({
      config: config(),
      updatedAt: 't',
      staleClient: false,
    });
    render(<MorrowDisplay initialConfig={config()} />);
    await settle();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /pause rotation/i }),
    ).toBeNull();
  });

  it('offers tabs and rotation controls once there are two pages', async () => {
    fetchConfig.mockResolvedValue({
      config: twoPages,
      updatedAt: 't',
      staleClient: false,
    });
    render(<MorrowDisplay initialConfig={twoPages} />);
    await settle();
    expect(screen.getByRole('tablist', { name: /glance pages/i })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /pause rotation/i }),
    ).toBeTruthy();
  });
});

describe('what the footer shows', () => {
  const render_ = (footer: Partial<MorrowConfig['footer']>) => {
    const served = config({
      location: 'Veggli',
      footer: { date: true, location: true, time: true, ...footer },
    });
    fetchConfig.mockResolvedValue({
      config: served,
      updatedAt: 't',
      staleClient: false,
    });
    render(<MorrowDisplay initialConfig={served} />);
  };

  it('shows the name, date, location, and time by default', async () => {
    render_({});
    await settle();
    expect(screen.getByText('Lobby')).toBeTruthy();
    expect(screen.getByText('Veggli')).toBeTruthy();
    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeTruthy();
    expect(
      screen.getByText(
        /September|January|February|March|April|May|June|July|August|October|November|December/,
      ),
    ).toBeTruthy();
  });

  it('hides the time when the display asks it to, keeping the name', async () => {
    render_({ time: false });
    await settle();
    expect(screen.queryByText(/^\d{2}:\d{2}$/)).toBeNull();
    expect(screen.getByText('Lobby')).toBeTruthy();
  });

  it('hides the location and the date independently', async () => {
    render_({ location: false, date: false });
    await settle();
    expect(screen.queryByText('Veggli')).toBeNull();
    expect(screen.queryByText(/September/)).toBeNull();
    // The time and the name stay.
    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeTruthy();
    expect(screen.getByText('Lobby')).toBeTruthy();
  });

  it('leaves only the name when everything optional is off', async () => {
    render_({ date: false, location: false, time: false });
    await settle();
    expect(screen.getByText('Lobby')).toBeTruthy();
    expect(screen.queryByText(/^\d{2}:\d{2}$/)).toBeNull();
    expect(screen.queryByText('Veggli')).toBeNull();
  });
});

describe('polling', () => {
  it('applies a configuration that changed on the server', async () => {
    fetchConfig.mockResolvedValue({
      config: config({ name: 'Renamed' }),
      updatedAt: 't',
      staleClient: false,
    });
    render(<MorrowDisplay initialConfig={config({ name: 'Lobby' })} />);
    await settle();
    expect(screen.getByText('Renamed')).toBeTruthy();
  });

  it('caches every configuration it receives, so the screen survives an outage', async () => {
    const served = config();
    fetchConfig.mockResolvedValue({
      config: served,
      updatedAt: 't',
      staleClient: false,
    });
    render(<MorrowDisplay initialConfig={served} />);
    await settle();
    // Identical to what is on screen, and still cached.
    expect(cacheConfig).toHaveBeenCalledWith(served);
  });

  it('falls back to the cached copy when the server cannot be reached', async () => {
    fetchConfig.mockRejectedValue(new Error('offline'));
    readCached.mockReturnValue(config({ name: 'From cache' }));
    render(<MorrowDisplay initialConfig={config({ name: 'Lobby' })} />);
    await settle();
    expect(screen.getByText('From cache')).toBeTruthy();
  });

  it('keeps the last good configuration when a later poll fails', async () => {
    fetchConfig.mockResolvedValueOnce({
      config: config({ name: 'Served' }),
      updatedAt: 't',
      staleClient: false,
    });
    render(<MorrowDisplay initialConfig={config()} />);
    await settle();
    expect(screen.getByText('Served')).toBeTruthy();

    fetchConfig.mockRejectedValue(new Error('offline'));
    readCached.mockReturnValue(config({ name: 'Stale cache' }));
    await tick(31_000);
    // Already loaded once, so a failure must not replace the screen.
    expect(screen.getByText('Served')).toBeTruthy();
    expect(screen.queryByText('Stale cache')).toBeNull();
  });

  it('polls on the interval of the screen named in the URL', async () => {
    const withScreens = config({
      screens: [
        {
          id: 'browser',
          name: 'Browser',
          width: 1920,
          height: 1080,
          refreshSeconds: 3600,
        },
        {
          id: 'lobby',
          name: 'Lobby',
          width: 3840,
          height: 2160,
          refreshSeconds: 60,
        },
      ],
      defaultScreenId: 'browser',
    });
    fetchConfig.mockResolvedValue({
      config: withScreens,
      updatedAt: 't',
      staleClient: false,
    });
    window.history.replaceState({}, '', '/?screen=lobby');
    render(<MorrowDisplay initialConfig={withScreens} />);
    await settle();
    expect(fetchConfig).toHaveBeenCalledTimes(1);

    // The default screen would wait an hour; this one polls every minute.
    await tick(61_000);
    expect(fetchConfig).toHaveBeenCalledTimes(2);
  });
});

describe('cost of running for weeks', () => {
  /** A screen that polls every second, so a test can poll without a minute passing. */
  const brisk = config({
    screens: [
      {
        id: 'browser',
        name: 'Browser',
        width: 1920,
        height: 1080,
        refreshSeconds: 1,
      },
    ],
    defaultScreenId: 'browser',
  });

  it('does not re-render when a poll brings nothing new', async () => {
    const served = brisk;
    fetchConfig.mockResolvedValue({
      config: served,
      updatedAt: 't',
      staleClient: false,
    });
    // A fresh object every poll, as the real endpoint returns.
    fetchData.mockImplementation(async () => ({
      a: { data: { n: 1 }, fetchedAt: 't', error: null },
    }));

    let commits = 0;
    render(
      <Profiler id="player" onRender={() => (commits += 1)}>
        <MorrowDisplay initialConfig={served} />
      </Profiler>,
    );
    await settle();
    const afterFirstLoad = commits;

    for (let i = 0; i < 5; i += 1) await tick(1_100);
    // Five further polls of identical data must not repaint the screen. The
    // bound rather than an exact count: React may split a commit under load,
    // and one stray commit is not the failure worth catching. Repainting on
    // every poll is, and that would land near five.
    expect(fetchConfig.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(commits - afterFirstLoad).toBeLessThanOrEqual(1);
  });

  it('does re-render when the data actually changes', async () => {
    const served = brisk;
    fetchConfig.mockResolvedValue({
      config: served,
      updatedAt: 't',
      staleClient: false,
    });
    fetchData.mockResolvedValueOnce({
      a: { data: { n: 1 }, fetchedAt: 't', error: null },
    });

    let commits = 0;
    render(
      <Profiler id="player" onRender={() => (commits += 1)}>
        <MorrowDisplay initialConfig={served} />
      </Profiler>,
    );
    await settle();
    const afterFirstLoad = commits;

    fetchData.mockResolvedValue({
      a: { data: { n: 2 }, fetchedAt: 't2', error: null },
    });
    await tick(31_000);
    expect(commits).toBeGreaterThan(afterFirstLoad);
  });
});

describe('rotation state survives polling', () => {
  it('does not restart rotation when an unchanged configuration comes back', async () => {
    fetchConfig.mockResolvedValue({
      config: twoPages,
      updatedAt: 't',
      staleClient: false,
    });
    render(<MorrowDisplay initialConfig={twoPages} />);
    await settle();

    const pause = screen.getByRole('button', { name: /pause rotation/i });
    await act(async () => {
      pause.click();
    });
    expect(
      screen.getByRole('button', { name: /resume rotation/i }),
    ).toBeTruthy();

    // Several polls of the same configuration must not un-pause the screen.
    await tick(31_000);
    await tick(31_000);
    expect(
      screen.getByRole('button', { name: /resume rotation/i }),
    ).toBeTruthy();
  });

  it('stays paused when an unrelated part of the configuration changes', async () => {
    fetchConfig.mockResolvedValue({
      config: twoPages,
      updatedAt: 't',
      staleClient: false,
    });
    render(<MorrowDisplay initialConfig={twoPages} />);
    await settle();
    await act(async () => {
      screen.getByRole('button', { name: /pause rotation/i }).click();
    });

    fetchConfig.mockResolvedValue({
      config: { ...twoPages, name: 'Renamed' },
      updatedAt: 't2',
      staleClient: false,
    });
    await tick(31_000);
    expect(screen.getByText('Renamed')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /resume rotation/i }),
    ).toBeTruthy();
  });

  it('starts rotating when a second page appears', async () => {
    const single = config({ pages: [page('one', 'One')] });
    fetchConfig.mockResolvedValue({
      config: single,
      updatedAt: 't',
      staleClient: false,
    });
    render(<MorrowDisplay initialConfig={single} />);
    await settle();
    expect(
      screen.queryByRole('button', { name: /pause rotation/i }),
    ).toBeNull();

    fetchConfig.mockResolvedValue({
      config: twoPages,
      updatedAt: 't2',
      staleClient: false,
    });
    await tick(31_000);
    expect(
      screen.getByRole('button', { name: /pause rotation/i }),
    ).toBeTruthy();
  });
});

describe('page navigation', () => {
  it('advances to the next page on its own after the rotation interval', async () => {
    fetchConfig.mockResolvedValue({
      config: twoPages,
      updatedAt: 't',
      staleClient: false,
    });
    render(<MorrowDisplay initialConfig={twoPages} />);
    await settle();
    expect(screen.getByText('1/2')).toBeTruthy();

    await tick(30_000);
    expect(screen.getByText('2/2')).toBeTruthy();
  });

  it('moves between pages with the arrow controls and wraps around', async () => {
    fetchConfig.mockResolvedValue({
      config: twoPages,
      updatedAt: 't',
      staleClient: false,
    });
    render(<MorrowDisplay initialConfig={twoPages} />);
    await settle();

    await act(async () => {
      screen.getByRole('button', { name: /next page/i }).click();
    });
    expect(screen.getByText('2/2')).toBeTruthy();
    await act(async () => {
      screen.getByRole('button', { name: /next page/i }).click();
    });
    expect(screen.getByText('1/2')).toBeTruthy();
    await act(async () => {
      screen.getByRole('button', { name: /previous page/i }).click();
    });
    expect(screen.getByText('2/2')).toBeTruthy();
  });

  it('answers the arrow keys and the space bar', async () => {
    fetchConfig.mockResolvedValue({
      config: twoPages,
      updatedAt: 't',
      staleClient: false,
    });
    render(<MorrowDisplay initialConfig={twoPages} />);
    await settle();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    expect(screen.getByText('2/2')).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    });
    expect(
      screen.getByRole('button', { name: /resume rotation/i }),
    ).toBeTruthy();
  });
});

describe('picking up a new release', () => {
  it('reloads once the server reports a different build', async () => {
    const reload = vi.fn();
    // Replace only the method: window.location is a class instance.
    Object.defineProperty(window.location, 'reload', {
      configurable: true,
      value: reload,
    });
    fetchConfig.mockResolvedValue({
      config: config(),
      updatedAt: 't',
      staleClient: true,
    });
    render(<MorrowDisplay initialConfig={config()} />);
    await settle();
    expect(reload).toHaveBeenCalled();
  });
});
