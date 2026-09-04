// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { BlockData, PluginSettings } from '@/lib/morrow/types';

import commitActivityFixture from './commit-activity.json';
import contributionsFixture from './contributions.json';
import contributorsFixture from './contributors.json';
import {
  parseCommitActivity,
  parseContributions,
  parseContributors,
  type GitHubData,
} from '../github';
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
      commitActivity: null,
      topContributors: null,
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

describe('repository commit activity', () => {
  // The fixture's final week is the week of 2026-08-30, so pin "now" inside it.
  const activity = parseCommitActivity(
    commitActivityFixture,
    new Date('2026-09-04T12:00:00Z'),
  );
  const people = parseContributors(contributorsFixture, 427);
  const repoSettings = { user: '', repo: 'github/docs' };

  it('draws the repository year and names the busiest contributors', () => {
    const { container } = show(
      'commits',
      stored({ commitActivity: activity, topContributors: people }),
      repoSettings,
    );
    // Figures stay readable however sparse the grid is.
    expect(screen.getByText('commits this week')).toBeTruthy();
    expect(screen.getByText('last 28 days')).toBeTruthy();
    // 10,474 is shown compactly, as a wall needs.
    expect(screen.getByText('10.5k')).toBeTruthy();
    // A repository busy all year keeps all 52 columns.
    expect(container.querySelectorAll('.github-heatmap circle')).toHaveLength(
      52 * 7,
    );
    expect(screen.getByText(/427 contributors/)).toBeTruthy();
    expect(screen.getByText('Octomerger')).toBeTruthy();
    // 15,994 rounds to 16k rather than 16.0k, which reads better on a wall.
    expect(screen.getByText('16k')).toBeTruthy();
  });

  it('narrows the grid for a young repository instead of a year of blanks', () => {
    const quiet = {
      weeks: Array.from({ length: 52 }, (_, index) =>
        index === 51 ? [0, 0, 0, 0, 14, 12, 0] : [0, 0, 0, 0, 0, 0, 0],
      ),
      total: 26,
      last7: 26,
      last28: 26,
      from: '2025-09-07',
      to: '2026-09-05',
      repos: [],
      pending: 0,
    };
    const { container } = show(
      'commits',
      stored({ commitActivity: quiet }),
      repoSettings,
    );
    // 16 columns rather than 52, so the dots are legible.
    expect(container.querySelectorAll('.github-heatmap circle')).toHaveLength(
      16 * 7,
    );
    expect(screen.getByText(/graph: last 16 weeks/)).toBeTruthy();
    // The numbers say what the picture cannot.
    expect(screen.getAllByText('26').length).toBeGreaterThanOrEqual(3);
  });

  it('shows the graph alone when GitHub has not worked out the contributors', () => {
    const { container } = show(
      'commits',
      stored({
        commitActivity: activity,
        topContributors: { total: null, top: [] },
      }),
      repoSettings,
    );
    expect(
      container.querySelectorAll('.github-heatmap circle').length,
    ).toBeGreaterThan(0);
    // 10,474 is shown compactly, as a wall needs.
    expect(screen.getByText('10.5k')).toBeTruthy();
    expect(container.querySelector('.github-top')).toBeNull();
  });

  it('shows the contributors when the graph is still being computed', () => {
    const { container } = show(
      'commits',
      stored({
        commitActivity: null,
        topContributors: people,
        warnings: [
          'Commit activity: GitHub is still working out this repository.',
        ],
      }),
      repoSettings,
    );
    // The part that arrived is on screen rather than discarded.
    expect(screen.getByText('Octomerger')).toBeTruthy();
    expect(
      screen.getByText(/427 contributors · commit graph on the way/),
    ).toBeTruthy();
    expect(container.querySelector('.github-heatmap')).toBeNull();
  });

  it('explains itself when nothing arrived at all', () => {
    show(
      'commits',
      stored({
        warnings: [
          'Commit activity: GitHub is still working out this repository.',
        ],
      }),
      repoSettings,
    );
    expect(screen.getByText(/still working out/)).toBeTruthy();
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
