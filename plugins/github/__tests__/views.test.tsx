// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { BlockData, PluginSettings } from '@/lib/morrow/types';

import contributionsFixture from './contributions.json';
import { parseContributions, type GitHubData } from '../github';
import { plugin } from '../plugin';

/**
 * The heatmap cannot be exercised against GitHub without a token, so its
 * rendering is pinned here from a captured-shape fixture instead.
 */

afterEach(cleanup);

const now = new Date('2026-09-04T12:00:00Z');

function stored(over: Partial<GitHubData>): BlockData {
  return {
    fetchedAt: now.toISOString(),
    error: null,
    data: {
      user: 'espen',
      repo: null,
      events: null,
      contributions: null,
      warnings: [],
      authenticated: true,
      fetchedAt: now.toISOString(),
      ...over,
    },
  };
}

function show(
  view: keyof typeof plugin.views,
  data: BlockData | undefined,
  settings: PluginSettings = { user: 'espen' },
) {
  const View = plugin.views[view];
  return render(
    <View now={now} settings={settings} timeZone="Europe/Oslo" data={data} />,
  );
}

describe('contributions view', () => {
  it('draws one dot per day inside the range and none outside it', () => {
    const contributions = parseContributions(contributionsFixture);
    const { container } = show('heatmap', stored({ contributions }));
    const dots = container.querySelectorAll('circle');
    // 4 + 7 + 7 + 2 days carry data; the padding days are not drawn.
    expect(dots).toHaveLength(20);
    expect(screen.getByText('41 contributions in the last year')).toBeTruthy();
  });

  it('scales the dots with GitHub quartiles of the busiest day', () => {
    const contributions = parseContributions(contributionsFixture);
    const { container } = show('heatmap', stored({ contributions }));
    const byLevel = (level: number) =>
      container.querySelectorAll(`circle.is-l${level}`).length;
    // Busiest day is 12. Counts: 0 ×12, 1–3 → l1 (2,1,3), 4–6 → l2 (5,4,6), 7–9 → l3 (8), 10–12 → l4 (12).
    expect(byLevel(0)).toBe(12);
    expect(byLevel(1)).toBe(3);
    expect(byLevel(2)).toBe(3);
    expect(byLevel(3)).toBe(1);
    expect(byLevel(4)).toBe(1);
    const empty = container.querySelector('circle.is-l0');
    const busiest = container.querySelector('circle.is-l4');
    expect(Number(busiest?.getAttribute('r'))).toBeGreaterThan(
      Number(empty?.getAttribute('r')),
    );
  });

  it('lays the grid out as columns of weeks', () => {
    const contributions = parseContributions(contributionsFixture);
    const { container } = show('heatmap', stored({ contributions }));
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe(
      '0 0 40 70',
    );
  });

  it('asks for a token when there is none, and explains a token that cannot read them', () => {
    show('heatmap', stored({ authenticated: false }));
    expect(screen.getByText(/need a token/i)).toBeTruthy();
    cleanup();
    show(
      'heatmap',
      stored({ warnings: ['Contributions: GitHub rejected the token.'] }),
    );
    expect(screen.getByText(/rejected the token/i)).toBeTruthy();
  });
});

describe('activity and repository views', () => {
  it('writes sentences with the owner dropped for the person on display', () => {
    show(
      'activity',
      stored({
        user: 'espen',
        events: [
          {
            id: '1',
            type: 'PushEvent',
            repo: 'espen/glance',
            at: '2026-09-04T09:00:00Z',
            commits: 2,
          },
          {
            id: '2',
            type: 'WatchEvent',
            repo: 'github/docs',
            at: '2026-09-03T09:00:00Z',
          },
        ],
      }),
    );
    expect(screen.getByText('Pushed 2 commits to glance')).toBeTruthy();
    expect(screen.getByText('Starred github/docs')).toBeTruthy();
    expect(screen.getByText('3h')).toBeTruthy();
  });

  it('shows the repository figures and separates pull requests', () => {
    show(
      'repo',
      stored({
        repo: {
          fullName: 'github/docs',
          description: null,
          stars: 20779,
          forks: 68557,
          openIssues: 43,
          openPulls: 26,
          pushedAt: '2026-09-03T23:28:07Z',
          language: 'TypeScript',
          archived: false,
        },
      }),
      { user: '', repo: 'github/docs' },
    );
    expect(screen.getByText('20.8k')).toBeTruthy();
    expect(screen.getByText('68.6k')).toBeTruthy();
    expect(screen.getByText('43')).toBeTruthy();
    expect(screen.getByText('26')).toBeTruthy();
    expect(screen.getByText(/TypeScript · last push 13h ago/)).toBeTruthy();
  });

  it('explains what is missing rather than going blank', () => {
    show('repo', undefined, { user: '', repo: '' });
    expect(
      screen.getByText(/Enter a GitHub username or a repository/),
    ).toBeTruthy();
    cleanup();
    show('activity', {
      fetchedAt: null,
      error: 'GitHub answered 500.',
      data: null,
    });
    expect(
      screen.getByText(/GitHub unavailable · GitHub answered 500/),
    ).toBeTruthy();
  });
});
