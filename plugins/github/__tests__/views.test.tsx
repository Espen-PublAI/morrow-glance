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
      hasToken: true,
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
    // A busier day is a larger dot; the class carries the level.
    expect(container.querySelector('circle.is-l4')).toBeTruthy();
    expect(container.querySelector('circle.is-l0')).toBeTruthy();
  });

  it('lays the grid out as one column per week', () => {
    const contributions = parseContributions(contributionsFixture);
    const { container } = show('heatmap', stored({ contributions }));
    // One picture, so the dots stay round whatever shape the block is and the
    // labels cannot drift away from the columns they name.
    const box = container.querySelector('svg')?.getAttribute('viewBox') ?? '';
    const [, , width, height] = box.split(' ').map(Number);
    // Seven rows of ten units plus the header for the month names.
    expect(height).toBe(83);
    // Four weeks would leave a wide block nearly empty, so the columns spread
    // to a readable shape rather than huddling at one end.
    expect((width ?? 0) / (height ?? 1)).toBeCloseTo(2.9, 1);
    // Twenty days carry data; the eight outside the range are not drawn.
    expect(container.querySelectorAll('circle')).toHaveLength(20);
  });

  it('asks for a token when there is none, and explains a token that cannot read them', () => {
    show('heatmap', stored({ hasToken: false }));
    expect(screen.getByText(/need a token/i)).toBeTruthy();
    cleanup();
    show(
      'heatmap',
      stored({ warnings: ['Contributions: GitHub rejected the token.'] }),
    );
    expect(screen.getByText(/rejected the token/i)).toBeTruthy();
  });
});

describe('the repository views, one thing each', () => {
  // The fixture's final week is the week of 2026-08-30, so pin "now" inside it.
  const activity = parseCommitActivity(
    commitActivityFixture,
    new Date('2026-09-04T12:00:00Z'),
  );
  const people = parseContributors(contributorsFixture, 427);
  const repoSettings = { user: '', repo: 'github/docs' };
  const full = {
    ...activity,
    scope: 'Aptide-ai',
    repos: [{ name: 'api', commits: 300 }],
    people: [
      { login: 'ada', commits: 42 },
      { login: 'espen', commits: 11 },
    ],
    peopleDays: 28,
    allTime: 900,
  };

  it('draws the graph alone, with both axes named', () => {
    const { container } = show(
      'commits',
      stored({ commitActivity: full, topContributors: people }),
      repoSettings,
    );
    expect(container.querySelectorAll('circle')).toHaveLength(52 * 7);
    // The labels are drawn inside the picture, so they cannot drift away from
    // the columns and rows they name.
    const labels = [...container.querySelectorAll('text')].map(
      (text) => text.textContent,
    );
    expect(labels).toContain('Mon');
    expect(labels).toContain('Wed');
    expect(labels).toContain('Fri');
    // A month named for each month the graph spans.
    const months = labels.filter(
      (name) => !['Mon', 'Wed', 'Fri'].includes(name ?? ''),
    );
    expect(months.length).toBeGreaterThan(6);
    // Nothing else crowds it.
    expect(container.querySelector('.github-figures')).toBeNull();
    expect(container.querySelector('.github-people')).toBeNull();
  });

  it('spreads few columns but never squeezes many', () => {
    const boxOf = (weeks: number[][]) => {
      const view = show(
        'commits',
        stored({ commitActivity: { ...full, weeks } }),
        repoSettings,
      );
      const box =
        view.container.querySelector('svg')?.getAttribute('viewBox') ?? '';
      cleanup();
      return box.split(' ').map(Number);
    };
    // A dozen weeks would leave a wide block empty, so they spread out.
    const [, , fewWidth, height] = boxOf(
      Array.from({ length: 12 }, () => [1, 1, 1, 1, 1, 1, 1]),
    );
    expect((fewWidth ?? 0) / (height ?? 1)).toBeCloseTo(2.9, 1);
    // A full year already has columns enough; it is not spread further.
    const [, , yearWidth] = boxOf(
      Array.from({ length: 52 }, () => [1, 1, 1, 1, 1, 1, 1]),
    );
    expect(yearWidth).toBe(26 + 52 * 10);
  });

  it('shows the figures alone', () => {
    const { container } = show(
      'figures',
      stored({ commitActivity: full }),
      repoSettings,
    );
    expect(screen.getByText('commits this week')).toBeTruthy();
    expect(screen.getByText('last 28 days')).toBeTruthy();
    expect(screen.getByText('all time')).toBeTruthy();
    expect(screen.getByText('900')).toBeTruthy();
    expect(container.querySelector('.github-heatmap')).toBeNull();
    expect(container.querySelector('.github-people')).toBeNull();
  });

  it('shows the people alone, one per row', () => {
    const { container } = show(
      'people',
      stored({ commitActivity: full }),
      repoSettings,
    );
    expect(screen.getByText('ada')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText(/commits in the last 28 days/)).toBeTruthy();
    expect(container.querySelector('.github-heatmap')).toBeNull();
    expect(container.querySelector('.github-figures')).toBeNull();
  });

  it('falls back to repositories, then to all-time contributors', () => {
    show(
      'people',
      stored({ commitActivity: { ...full, people: [] } }),
      repoSettings,
    );
    expect(screen.getByText('api')).toBeTruthy();
    cleanup();
    show(
      'people',
      stored({
        commitActivity: { ...full, people: [], repos: [] },
        topContributors: people,
      }),
      repoSettings,
    );
    expect(screen.getByText('Octomerger')).toBeTruthy();
    expect(screen.getByText(/all time/)).toBeTruthy();
  });

  it('narrows the graph for a young repository instead of a year of blanks', () => {
    const quiet = {
      ...full,
      weeks: Array.from({ length: 52 }, (_, index) =>
        index === 51 ? [0, 0, 0, 0, 14, 12, 0] : [0, 0, 0, 0, 0, 0, 0],
      ),
    };
    const { container } = show(
      'commits',
      stored({ commitActivity: quiet }),
      repoSettings,
    );
    expect(container.querySelectorAll('circle')).toHaveLength(16 * 7);
    expect(screen.getByText(/16 weeks left to right/)).toBeTruthy();
  });

  it('says what is missing rather than blanking', () => {
    show(
      'commits',
      stored({
        commitActivity: null,
        warnings: ['Commit activity: GitHub is still working out this one.'],
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
      screen.getByText(/Add a token, or a GitHub username or repository/),
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
