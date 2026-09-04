import { describe, expect, it, vi } from 'vitest';

import commitActivityFixture from './commit-activity.json';
import contributionsFixture from './contributions.json';
import contributorsFixture from './contributors.json';
import eventsFixture from './events.json';
import repoFixture from './repo.json';
import {
  contributionLevel,
  fetchGitHub,
  parseCommitActivity,
  parseContributors,
  isGitHubData,
  normaliseUser,
  parseContributions,
  parseEvents,
  parseLastPage,
  parseRepo,
  parseRepoName,
} from '../github';

describe('settings', () => {
  it('accepts GitHub usernames and strips a leading @', () => {
    expect(normaliseUser('Espen-PublAI')).toBe('Espen-PublAI');
    expect(normaliseUser('@octocat ')).toBe('octocat');
  });

  it('rejects names GitHub would not issue', () => {
    expect(normaliseUser('-leading')).toBeNull();
    expect(normaliseUser('double--hyphen')).toBeNull();
    expect(normaliseUser('has space')).toBeNull();
    expect(normaliseUser('a'.repeat(40))).toBeNull();
    expect(normaliseUser('')).toBeNull();
  });

  it('reads owner/name, a pasted URL, and a .git suffix', () => {
    expect(parseRepoName('github/docs')).toEqual({
      owner: 'github',
      name: 'docs',
    });
    expect(
      parseRepoName('https://github.com/Espen-PublAI/morrow-glance/'),
    ).toEqual({
      owner: 'Espen-PublAI',
      name: 'morrow-glance',
    });
    expect(parseRepoName('owner/repo.git')).toEqual({
      owner: 'owner',
      name: 'repo',
    });
  });

  it('rejects anything that is not exactly owner/name', () => {
    expect(parseRepoName('just-a-name')).toBeNull();
    expect(parseRepoName('a/b/c')).toBeNull();
    expect(parseRepoName('a/b c')).toBeNull();
    expect(parseRepoName('')).toBeNull();
  });
});

describe('a typo in one field does not hide the others', () => {
  const context = {
    env: {},
    timeZone: 'Europe/Oslo',
    now: new Date('2026-09-04T12:00:00Z'),
    secrets: {},
  };

  it('warns about an unparseable repository and still fetches the user', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify(eventsFixture), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const data = await fetchGitHub(
      { user: 'Espen-PublAI', repo: 'Aptide-ai' },
      context,
    );
    expect(data.events).not.toBeNull();
    expect(data.warnings).toEqual([
      'Repository: "Aptide-ai" needs an owner, as in Espen-PublAI/Aptide-ai.',
    ]);
    // Nothing was requested for the unparseable repository.
    expect(calls.some((url) => url.includes('/repos/'))).toBe(false);
    vi.unstubAllGlobals();
  });

  it('fails only when no field is usable', async () => {
    await expect(fetchGitHub({ repo: 'Aptide-ai' }, context)).rejects.toThrow(
      /needs an owner/,
    );
    await expect(fetchGitHub({}, context)).rejects.toThrow(
      /Enter a GitHub username/,
    );
    await expect(fetchGitHub({ user: 'bad--name' }, context)).rejects.toThrow(
      /not a valid GitHub username/,
    );
  });
});

describe('statistics that GitHub computes lazily', () => {
  const context = {
    env: {},
    timeZone: 'Europe/Oslo',
    now: new Date('2026-09-04T12:00:00Z'),
    secrets: {},
  };

  it('retries a 202 once, then succeeds', async () => {
    let statsCalls = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/stats/commit_activity')) {
        statsCalls += 1;
        return statsCalls === 1
          ? new Response('{}', { status: 202 })
          : Response.json(commitActivityFixture);
      }
      if (url.includes('/contributors'))
        return Response.json(contributorsFixture);
      return Response.json(repoFixture);
    });
    const data = await fetchGitHub({ repo: 'github/docs' }, context);
    expect(statsCalls).toBe(2);
    expect(data.commitActivity?.weeks).toHaveLength(52);
    expect(data.warnings).toEqual([]);
    vi.unstubAllGlobals();
  }, 10_000);

  it('explains a persistent 202 without losing the other parts', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/stats/commit_activity')) {
        return new Response('{}', { status: 202 });
      }
      if (url.includes('/contributors'))
        return Response.json(contributorsFixture);
      return Response.json(repoFixture);
    });
    const data = await fetchGitHub({ repo: 'github/docs' }, context);
    expect(data.commitActivity).toBeNull();
    expect(data.warnings.join(' ')).toMatch(/still working out/);
    // The stars and the contributors came back regardless.
    expect(data.repo?.fullName).toBe('github/docs');
    expect(data.topContributors?.top.length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  }, 10_000);
});

describe('repository', () => {
  it('separates issues from pull requests using the pull count', () => {
    const repo = parseRepo(repoFixture, 25);
    expect(repo.fullName).toBe('github/docs');
    expect(repo.stars).toBe(repoFixture.stargazers_count);
    expect(repo.forks).toBe(repoFixture.forks_count);
    // GitHub's open_issues_count is 67 and includes the 25 pull requests.
    expect(repo.openIssues).toBe(42);
    expect(repo.openPulls).toBe(25);
    expect(repo.pushedAt).toBe(repoFixture.pushed_at);
    expect(repo.archived).toBe(false);
  });

  it('falls back to the combined count when pull requests are unknown', () => {
    const repo = parseRepo(repoFixture, null);
    expect(repo.openIssues).toBe(67);
    expect(repo.openPulls).toBeNull();
  });

  it('reads the open pull request count from a per_page=1 Link header', () => {
    expect(
      parseLastPage(
        '<https://api.github.com/repositories/1/pulls?state=open&per_page=1&page=2>; rel="next", <https://api.github.com/repositories/1/pulls?state=open&per_page=1&page=25>; rel="last"',
      ),
    ).toBe(25);
    expect(parseLastPage(null)).toBeNull();
    expect(parseLastPage('<https://x/?page=3>; rel="next"')).toBeNull();
  });

  it('refuses a response without a repository name', () => {
    expect(() => parseRepo({ stargazers_count: 1 }, null)).toThrow(
      /unexpected/,
    );
  });
});

describe('events', () => {
  const at = '2026-09-04T10:00:00Z';
  const events = parseEvents(eventsFixture);

  it('keeps every captured event and only the fields a sentence needs', () => {
    expect(events).toHaveLength(eventsFixture.length);
    for (const event of events) {
      expect(event.id).toBeTruthy();
      expect(event.repo).toMatch(/^[^/]+\/[^/]+$/);
      expect(new Date(event.at).getTime()).toBeGreaterThan(0);
      expect(Object.keys(event)).not.toContain('payload');
      expect(Object.keys(event)).not.toContain('actor');
    }
  });

  it('extracts what each type carries', () => {
    const byType = new Map(events.map((e) => [e.type, e]));
    expect(byType.get('PullRequestEvent')?.number).toBeGreaterThan(0);
    expect(byType.get('IssuesEvent')?.action).toBeTruthy();
    expect(byType.get('CreateEvent')?.refType).toBeTruthy();
    // GitHub omits commit details on some pushes; the count is then unknown,
    // never zero, so the sentence can say "Pushed to" instead of "0 commits".
    for (const push of events.filter((e) => e.type === 'PushEvent')) {
      expect(push.commits === undefined || push.commits > 0).toBe(true);
    }
  });

  it('counts commits from the size fields, then the array, then not at all', () => {
    const push = (payload: Record<string, unknown>) =>
      parseEvents([
        {
          id: '1',
          type: 'PushEvent',
          created_at: at,
          repo: { name: 'a/b' },
          payload,
        },
      ])[0]?.commits;
    expect(push({ distinct_size: 2, size: 5, commits: [{}, {}, {}] })).toBe(2);
    expect(push({ size: 5, commits: [{}] })).toBe(5);
    expect(push({ commits: [{}, {}, {}] })).toBe(3);
    expect(push({ commits: [] })).toBeUndefined();
    expect(push({})).toBeUndefined();
  });

  it('strips refs/heads/ from branch names', () => {
    const [event] = parseEvents([
      {
        id: '1',
        type: 'PushEvent',
        created_at: '2026-09-04T10:00:00Z',
        repo: { name: 'a/b' },
        payload: { ref: 'refs/heads/main', size: 3, distinct_size: 2 },
      },
    ]);
    expect(event?.ref).toBe('main');
    // Prefer distinct commits when the array is absent.
    expect(event?.commits).toBe(2);
  });

  it('skips malformed entries rather than failing the whole feed', () => {
    expect(
      parseEvents([{ type: 'PushEvent' }, ...eventsFixture.slice(0, 2)]),
    ).toHaveLength(2);
    expect(() => parseEvents({ not: 'an array' })).toThrow(/unexpected/);
  });
});

describe('repository commit activity, all contributors', () => {
  const activity = parseCommitActivity(commitActivityFixture);

  it('reads the year as weeks of seven days, Sunday first', () => {
    expect(activity.weeks).toHaveLength(52);
    for (const week of activity.weeks) expect(week).toHaveLength(7);
    // Every day is a real count; there are no out-of-range placeholders here,
    // unlike a person's calendar which starts mid-week.
    expect(activity.weeks.flat().every((count) => count >= 0)).toBe(true);
  });

  it('totals the commits and spans a year of dates', () => {
    const expected = commitActivityFixture.reduce(
      (sum, week) => sum + week.total,
      0,
    );
    expect(activity.total).toBe(expected);
    expect(activity.total).toBeGreaterThan(0);
    expect(activity.from < activity.to).toBe(true);
    const days =
      (Date.parse(activity.to) - Date.parse(activity.from)) / 86_400_000;
    expect(days).toBeGreaterThan(355);
    expect(days).toBeLessThan(372);
  });

  it('sums the day counts rather than trusting the weekly total', () => {
    const one = parseCommitActivity([
      { week: 1_788_048_000, total: 999, days: [0, 1, 2, 3, 4, 5, 6] },
    ]);
    expect(one.total).toBe(21);
    expect(one.weeks[0]).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('pads a short days array and refuses an empty response', () => {
    expect(
      parseCommitActivity([{ week: 1_788_048_000, days: [4, 5] }]).weeks[0],
    ).toEqual([4, 5, 0, 0, 0, 0, 0]);
    expect(() => parseCommitActivity([])).toThrow(/no commit activity/);
    expect(() => parseCommitActivity({})).toThrow(/no commit activity/);
  });
});

describe('repository contributors', () => {
  it('keeps the order GitHub gives, which is busiest first', () => {
    const people = parseContributors(contributorsFixture, 427);
    expect(people.total).toBe(427);
    expect(people.top.map((p) => p.login)).toEqual(
      contributorsFixture.map((c) => c.login),
    );
    expect(people.top[0]?.commits).toBeGreaterThan(people.top[4]?.commits ?? 0);
  });

  it('falls back to the number it can see when the count is unknown', () => {
    expect(parseContributors(contributorsFixture, null).total).toBe(5);
    expect(parseContributors([], null).total).toBeNull();
  });

  it('skips entries with no login and refuses a non-list', () => {
    expect(
      parseContributors(
        [{ contributions: 5 }, { login: 'a', contributions: 2 }],
        null,
      ).top,
    ).toEqual([{ login: 'a', commits: 2 }]);
    expect(() => parseContributors({}, null)).toThrow(
      /unexpected contributors/,
    );
  });
});

describe('contributions', () => {
  const calendar = parseContributions(contributionsFixture);

  it('lays weeks out Sunday-first and marks days outside the range', () => {
    expect(calendar.weeks).toHaveLength(4);
    // The first week starts on a Wednesday, so Sunday to Tuesday are blank.
    expect(calendar.weeks[0]).toEqual([-1, -1, -1, 0, 2, 5, 0]);
    expect(calendar.weeks[1]).toEqual([0, 8, 1, 0, 3, 12, 0]);
    expect(calendar.weeks[3]).toEqual([0, 0, -1, -1, -1, -1, -1]);
  });

  it('carries the total and the date range', () => {
    expect(calendar.total).toBe(41);
    expect(calendar.from).toBe('2026-08-12');
    expect(calendar.to).toBe('2026-08-31');
  });

  it('surfaces GraphQL errors and unknown users as plain messages', () => {
    expect(() =>
      parseContributions({ errors: [{ message: 'Bad credentials' }] }),
    ).toThrow(/Bad credentials/);
    expect(() => parseContributions({ data: { user: null } })).toThrow(
      /not found/,
    );
    expect(() => parseContributions({ data: { user: {} } })).toThrow(
      /no contribution/,
    );
  });
});

describe('contribution levels', () => {
  it('uses GitHub scale: zero, then four quartiles of the busiest day', () => {
    expect(contributionLevel(0, 12)).toBe(0);
    expect(contributionLevel(1, 12)).toBe(1);
    expect(contributionLevel(3, 12)).toBe(1);
    expect(contributionLevel(4, 12)).toBe(2);
    expect(contributionLevel(6, 12)).toBe(2);
    expect(contributionLevel(9, 12)).toBe(3);
    expect(contributionLevel(12, 12)).toBe(4);
  });

  it('never divides by zero', () => {
    expect(contributionLevel(5, 0)).toBe(0);
  });
});

describe('stored data guard', () => {
  it('recognises the shape the server stores and nothing else', () => {
    expect(
      isGitHubData({
        user: 'x',
        repo: null,
        events: [],
        contributions: null,
        warnings: [],
        authenticated: false,
        fetchedAt: 't',
      }),
    ).toBe(true);
    expect(isGitHubData({ events: [] })).toBe(false);
    expect(isGitHubData(null)).toBe(false);
  });
});
