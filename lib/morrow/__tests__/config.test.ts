import { describe, expect, it } from 'vitest';

import { MorrowConfigError, parseMorrowConfig } from '@/lib/morrow/config';
import { DEFAULT_SCREENS } from '@/lib/morrow/defaults';
import { morrowConfig } from '@/morrow.config';

const block = (overrides: Record<string, unknown> = {}) => ({
  id: 'b1',
  plugin: 'morrow.clock',
  view: 'digital',
  column: 1,
  span: 4,
  row: 1,
  rowSpan: 2,
  ...overrides,
});

const withBlocks = (...blocks: Record<string, unknown>[]) => ({
  ...morrowConfig,
  pages: [{ ...morrowConfig.pages[0], blocks }],
});

describe('parseMorrowConfig', () => {
  it('accepts the clean-install configuration unchanged', () => {
    expect(parseMorrowConfig(morrowConfig)).toEqual(morrowConfig);
  });

  it('strips unknown keys and trims text', () => {
    const parsed = parseMorrowConfig({
      ...morrowConfig,
      name: '  Lobby  ',
      injected: 'nope',
    });
    expect(parsed.name).toBe('Lobby');
    expect('injected' in parsed).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(() => parseMorrowConfig(null)).toThrow(MorrowConfigError);
    expect(() => parseMorrowConfig('pages')).toThrow(MorrowConfigError);
    expect(() => parseMorrowConfig([])).toThrow(MorrowConfigError);
  });

  it('rejects unknown colours and timezones', () => {
    expect(() => parseMorrowConfig({ ...morrowConfig, color: 'pink' })).toThrow(
      /color/,
    );
    expect(() =>
      parseMorrowConfig({ ...morrowConfig, timeZone: 'Mars/Olympus' }),
    ).toThrow(/timeZone/);
  });

  it('migrates legacy rotationMs to rotationSeconds', () => {
    const { rotationSeconds: _ignored, ...legacy } = morrowConfig;
    const parsed = parseMorrowConfig({ ...legacy, rotationMs: 45_000 });
    expect(parsed.rotationSeconds).toBe(45);
    expect('rotationMs' in parsed).toBe(false);
  });

  it('fills in the browser screen when none are stored', () => {
    const { screens: _s, defaultScreenId: _d, ...bare } = morrowConfig;
    const parsed = parseMorrowConfig(bare);
    expect(parsed.screens).toEqual(DEFAULT_SCREENS);
    expect(parsed.defaultScreenId).toBe('browser');
  });

  it('migrates legacy deviceProfiles, dropping image-output profiles', () => {
    const { screens: _s, defaultScreenId: _d, ...legacy } = morrowConfig;
    const parsed = parseMorrowConfig({
      ...legacy,
      defaultDeviceProfileId: 'trmnl-og',
      deviceProfiles: [
        {
          id: 'lobby-tv',
          name: 'Lobby TV',
          transport: 'browser',
          width: 3840,
          height: 2160,
          colorDepth: 'color',
          refreshSeconds: 60,
        },
        {
          id: 'trmnl-og',
          name: 'TRMNL OG',
          transport: 'image',
          width: 800,
          height: 480,
          colorDepth: 'monochrome',
          refreshSeconds: 900,
        },
      ],
    });
    expect(parsed.screens).toEqual([
      {
        id: 'lobby-tv',
        name: 'Lobby TV',
        width: 3840,
        height: 2160,
        refreshSeconds: 60,
      },
    ]);
    // The old default pointed at a dropped profile, so the first screen takes over.
    expect(parsed.defaultScreenId).toBe('lobby-tv');
    expect('deviceProfiles' in parsed).toBe(false);
  });

  it('falls back to the browser screen when every legacy profile was an image', () => {
    const { screens: _s, defaultScreenId: _d, ...legacy } = morrowConfig;
    const parsed = parseMorrowConfig({
      ...legacy,
      deviceProfiles: [
        {
          id: 'x',
          name: 'X',
          transport: 'image',
          width: 1,
          height: 1,
          refreshSeconds: 1,
        },
      ],
    });
    expect(parsed.screens).toEqual(DEFAULT_SCREENS);
  });

  it('requires the default screen to exist in new-format input', () => {
    expect(() =>
      parseMorrowConfig({ ...morrowConfig, defaultScreenId: 'missing' }),
    ).toThrow(/defaultScreenId/);
    expect(() => parseMorrowConfig({ ...morrowConfig, screens: [] })).toThrow(
      /screens/,
    );
  });

  it('rejects blocks outside the grid', () => {
    expect(() =>
      parseMorrowConfig(withBlocks(block({ column: 10, span: 4 }))),
    ).toThrow(/past the last column/);
    expect(() =>
      parseMorrowConfig(withBlocks(block({ row: 5, rowSpan: 2 }))),
    ).toThrow(/past the last row/);
  });

  it('rejects overlapping blocks', () => {
    expect(() =>
      parseMorrowConfig(withBlocks(block(), block({ id: 'b2', column: 3 }))),
    ).toThrow(/overlaps/);
  });

  it('accepts adjacent blocks', () => {
    const parsed = parseMorrowConfig(
      withBlocks(block(), block({ id: 'b2', column: 5 })),
    );
    expect(parsed.pages[0]?.blocks).toHaveLength(2);
  });

  it('rejects duplicate ids', () => {
    expect(() => parseMorrowConfig(withBlocks(block(), block()))).toThrow(
      /duplicate block/,
    );
    expect(() =>
      parseMorrowConfig({
        ...morrowConfig,
        pages: [morrowConfig.pages[0], morrowConfig.pages[0]],
      }),
    ).toThrow(/duplicate page/);
    expect(() =>
      parseMorrowConfig({
        ...morrowConfig,
        screens: [...DEFAULT_SCREENS, ...DEFAULT_SCREENS],
      }),
    ).toThrow(/duplicate screen/);
  });

  it('keeps only primitive settings and drops null values', () => {
    const parsed = parseMorrowConfig(
      withBlocks(
        block({ settings: { label: 'Oslo', count: 2, on: true, gone: null } }),
      ),
    );
    expect(parsed.pages[0]?.blocks[0]?.settings).toEqual({
      label: 'Oslo',
      count: 2,
      on: true,
    });
    expect(() =>
      parseMorrowConfig(withBlocks(block({ settings: { nested: { a: 1 } } }))),
    ).toThrow(/settings/);
  });

  it('rejects ids that would not survive a URL', () => {
    expect(() =>
      parseMorrowConfig({
        ...morrowConfig,
        screens: [{ ...DEFAULT_SCREENS[0], id: '../etc' }],
        defaultScreenId: '../etc',
      }),
    ).toThrow(/screens\[0\]\.id/);
  });

  it('defaults disabledPlugins to an empty list and de-duplicates entries', () => {
    const { disabledPlugins: _d, ...bare } = morrowConfig;
    expect(parseMorrowConfig(bare).disabledPlugins).toEqual([]);
    expect(
      parseMorrowConfig({
        ...morrowConfig,
        disabledPlugins: ['morrow.text', 'morrow.text'],
      }).disabledPlugins,
    ).toEqual(['morrow.text']);
    expect(() =>
      parseMorrowConfig({ ...morrowConfig, disabledPlugins: ['bad id!'] }),
    ).toThrow(/disabledPlugins\[0\]/);
  });

  it('accepts poll and webhook data sources and rejects unsafe ones', () => {
    const poll = parseMorrowConfig(
      withBlocks(
        block({
          data: {
            kind: 'poll',
            url: 'https://api.example.com/x',
            intervalSeconds: 300,
          },
        }),
      ),
    );
    expect(poll.pages[0]?.blocks[0]?.data).toEqual({
      kind: 'poll',
      url: 'https://api.example.com/x',
      intervalSeconds: 300,
    });
    expect(
      parseMorrowConfig(withBlocks(block({ data: { kind: 'webhook' } })))
        .pages[0]?.blocks[0]?.data,
    ).toEqual({
      kind: 'webhook',
    });
    expect(() =>
      parseMorrowConfig(
        withBlocks(
          block({
            data: { kind: 'poll', url: 'http://x.com', intervalSeconds: 300 },
          }),
        ),
      ),
    ).toThrow(/https/);
    expect(() =>
      parseMorrowConfig(
        withBlocks(
          block({
            data: { kind: 'poll', url: 'https://x.com', intervalSeconds: 5 },
          }),
        ),
      ),
    ).toThrow(/intervalSeconds/);
    expect(() =>
      parseMorrowConfig(withBlocks(block({ data: { kind: 'ftp' } }))),
    ).toThrow(/kind/);
  });

  it('shows every footer field when a configuration predates them', () => {
    const { footer: _f, ...before } = morrowConfig;
    expect(parseMorrowConfig(before).footer).toEqual({
      date: true,
      location: true,
      time: true,
    });
  });

  it('keeps the footer fields a configuration does set', () => {
    // Each field is set to the opposite of its default, so a parser that
    // quietly returned the defaults would fail here.
    const parsed = parseMorrowConfig({
      ...morrowConfig,
      footer: { date: false, location: false, time: false },
    });
    expect(parsed.footer).toEqual({
      date: false,
      location: false,
      time: false,
    });

    const mixed = parseMorrowConfig({
      ...morrowConfig,
      footer: { date: false, location: true, time: false },
    });
    expect(mixed.footer).toEqual({ date: false, location: true, time: false });
  });

  it('fills in only the footer fields that are missing', () => {
    expect(
      parseMorrowConfig({ ...morrowConfig, footer: { time: false } }).footer,
    ).toEqual({
      date: true,
      location: true,
      time: false,
    });
  });

  it('refuses a footer field that is not a boolean', () => {
    expect(() =>
      parseMorrowConfig({ ...morrowConfig, footer: { time: 'no' } }),
    ).toThrow(/footer\.time/);
    expect(() =>
      parseMorrowConfig({ ...morrowConfig, footer: 'none' }),
    ).toThrow(/footer/);
  });

  it('names the failing path in the error', () => {
    try {
      parseMorrowConfig({ ...morrowConfig, screens: [{ id: 'x' }] });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MorrowConfigError);
      expect((error as MorrowConfigError).path).toBe('screens[0].name');
    }
  });
});
