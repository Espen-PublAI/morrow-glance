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
  parseOwner,
  describeTokenProblem,
  visibleWeeks,
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

describe('what the repository field accepts', () => {
  const context = {
    env: {},
    timeZone: 'Europe/Oslo',
    now: new Date('2026-09-04T12:00:00Z'),
    secrets: {},
  };

  it('reads a bare name as the whole account or organisation', () => {
    expect(parseOwner('Aptide-ai')).toBe('Aptide-ai');
    expect(parseOwner(' @octocat ')).toBe('octocat');
    expect(parseOwner('https://github.com/Aptide-ai/')).toBe('Aptide-ai');
    // Anything with a slash is a repository, not an owner.
    expect(parseOwner('github/docs')).toBeNull();
    expect(parseOwner('has space')).toBeNull();
  });

  it('aggregates every repository of an owner, busiest first', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      if (url.includes('/orgs/Aptide-ai/repos')) {
        return Response.json([
          { full_name: 'Aptide-ai/api' },
          { full_name: 'Aptide-ai/web' },
        ]);
      }
      if (url.includes('/repos/Aptide-ai/api/stats/commit_activity')) {
        return Response.json([
          { week: 1_788_048_000, days: [1, 0, 0, 0, 0, 0, 0] },
        ]);
      }
      if (url.includes('/repos/Aptide-ai/web/stats/commit_activity')) {
        return Response.json([
          { week: 1_788_048_000, days: [0, 2, 0, 0, 0, 0, 0] },
        ]);
      }
      throw new Error(`unexpected ${url}`);
    });
    const data = await fetchGitHub({ repo: 'Aptide-ai' }, context);
    // Weeks are added together on the week they start, not by position.
    expect(data.commitActivity?.weeks[0]).toEqual([1, 2, 0, 0, 0, 0, 0]);
    expect(data.commitActivity?.total).toBe(3);
    expect(data.commitActivity?.repos).toEqual([
      { name: 'web', commits: 2 },
      { name: 'api', commits: 1 },
    ]);
    expect(data.commitActivity?.pending).toBe(0);
    // Stars and contributors are per-repository, so they are not fetched.
    expect(calls.some((url) => url.includes('/contributors'))).toBe(false);
    vi.unstubAllGlobals();
  });

  it('keeps the repositories it could read and counts the rest as pending', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/orgs/Aptide-ai/repos')) {
        return Response.json([
          { full_name: 'Aptide-ai/api' },
          { full_name: 'Aptide-ai/web' },
        ]);
      }
      if (url.includes('/api/stats/'))
        return new Response('{}', { status: 202 });
      return Response.json([
        { week: 1_788_048_000, days: [0, 2, 0, 0, 0, 0, 0] },
      ]);
    });
    const data = await fetchGitHub({ repo: 'Aptide-ai' }, context);
    expect(data.commitActivity?.total).toBe(2);
    expect(data.commitActivity?.pending).toBe(1);
    vi.unstubAllGlobals();
  }, 15_000);

  it('falls back to a personal account when there is no such organisation', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      if (url.includes('/orgs/')) return new Response('[]', { status: 404 });
      if (url.includes('/users/espen/repos')) {
        return Response.json([{ full_name: 'espen/glance' }]);
      }
      return Response.json([
        { week: 1_788_048_000, days: [3, 0, 0, 0, 0, 0, 0] },
      ]);
    });
    const data = await fetchGitHub({ repo: 'espen' }, context);
    expect(data.commitActivity?.total).toBe(3);
    expect(calls.some((url) => url.includes('/users/espen/repos'))).toBe(true);
    vi.unstubAllGlobals();
  });

  const withToken = { ...context, secrets: { token: 'test-token' } };

  it('finds a grant that only shows up in the token\u2019s own repository list', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      // The organisation endpoint sees nothing, but the token does.
      if (url.includes('/orgs/Aptide-ai/repos')) return Response.json([]);
      if (url.includes('/users/Aptide-ai/repos')) {
        return new Response('[]', { status: 404 });
      }
      if (url.includes('/user/repos')) {
        return Response.json([
          { full_name: 'Aptide-ai/api' },
          { full_name: 'someone-else/other' },
        ]);
      }
      return Response.json([
        { week: 1_788_048_000, days: [5, 0, 0, 0, 0, 0, 0] },
      ]);
    });
    const data = await fetchGitHub({ repo: 'Aptide-ai' }, withToken);
    // Only the wanted owner's repositories are aggregated.
    expect(data.commitActivity?.repos).toEqual([{ name: 'api', commits: 5 }]);
    vi.unstubAllGlobals();
  });

  it('names which of the four causes it is', () => {
    // A fine-grained token that reads other repositories is scoped wrongly.
    expect(
      describeTokenProblem('Aptide-ai', { scopes: null, seesAnyRepo: true }),
    ).toMatch(/resource owner is most likely a personal account/);
    // One that reads nothing anywhere is usually waiting for approval.
    expect(
      describeTokenProblem('Aptide-ai', { scopes: null, seesAnyRepo: false }),
    ).toMatch(/not approved it yet|Pending requests/);
    // A classic token without the scope cannot read private repositories.
    expect(
      describeTokenProblem('Aptide-ai', {
        scopes: ['read:user'],
        seesAnyRepo: true,
      }),
    ).toMatch(/does not have the "repo" scope/);
    // With the scope, the likely cause is single sign-on.
    expect(
      describeTokenProblem('Aptide-ai', {
        scopes: ['repo'],
        seesAnyRepo: true,
      }),
    ).toMatch(/single sign-on/);
  });

  it('asks what else the token can reach before blaming anything', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      if (url.includes('/orgs/Aptide-ai/repos')) return Response.json([]);
      if (url.includes('/user/repos?affiliation')) return Response.json([]);
      // The diagnostic probe: a fine-grained token that can read something.
      if (url.includes('/user/repos?per_page=1')) {
        return Response.json([{ full_name: 'espen/other' }]);
      }
      return new Response('[]', { status: 404 });
    });
    await expect(fetchGitHub({ repo: 'Aptide-ai' }, withToken)).rejects.toThrow(
      /resource owner is most likely a personal account/,
    );
    // The probe runs only after the ordinary lookups have failed.
    expect(
      calls.filter((url) => url.includes('/user/repos?per_page=1')),
    ).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('reads a classic token\u2019s scopes from the response header', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/orgs/Aptide-ai/repos')) return Response.json([]);
      if (url.includes('/user/repos?affiliation')) return Response.json([]);
      if (url.includes('/user/repos?per_page=1')) {
        return new Response(JSON.stringify([{ full_name: 'espen/other' }]), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-oauth-scopes': 'repo, read:org',
          },
        });
      }
      return new Response('[]', { status: 404 });
    });
    await expect(fetchGitHub({ repo: 'Aptide-ai' }, withToken)).rejects.toThrow(
      /single sign-on/,
    );
    vi.unstubAllGlobals();
  });

  it('explains what a token needs when it can read nothing', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/orgs/Aptide-ai/repos')) return Response.json([]);
      if (url.includes('/user/repos')) return Response.json([]);
      return new Response('[]', { status: 404 });
    });
    await expect(fetchGitHub({ repo: 'Aptide-ai' }, withToken)).rejects.toThrow(
      /fine-grained token can read no repositories at all/,
    );
    vi.unstubAllGlobals();
  });

  it('distinguishes an owner that does not exist at all', async () => {
    vi.stubGlobal('fetch', async () => new Response('[]', { status: 404 }));
    await expect(
      fetchGitHub({ repo: 'nope-not-real' }, context),
    ).rejects.toThrow(/No GitHub account or organisation/);
    vi.unstubAllGlobals();
  });

  it('warns about a field that is neither, and still fetches the user', async () => {
    vi.stubGlobal('fetch', async () => Response.json(eventsFixture));
    const data = await fetchGitHub(
      { user: 'Espen-PublAI', repo: 'a/b/c' },
      context,
    );
    expect(data.events).not.toBeNull();
    expect(data.warnings).toEqual([
      'Repository: "a/b/c" is not a repository as owner/name, nor an account or organisation name.',
    ]);
    vi.unstubAllGlobals();
  });

  it('fails only when no field is usable', async () => {
    await expect(fetchGitHub({ repo: 'a/b/c' }, context)).rejects.toThrow(
      /not a repository as owner\/name/,
    );
    await expect(fetchGitHub({}, context)).rejects.toThrow(
      /Enter a repository/,
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
  const now = new Date('2026-09-04T12:00:00Z');
  const activity = parseCommitActivity(commitActivityFixture, now);

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

  it('counts the seven and twenty-eight days ending today', () => {
    // The fixture's final week starts Sunday 2026-08-30.
    const week = Math.floor(Date.UTC(2026, 7, 30) / 1000);
    const one = parseCommitActivity(
      [
        { week: week - 7 * 86_400, total: 0, days: [1, 1, 1, 1, 1, 1, 1] },
        { week, total: 0, days: [2, 3, 4, 5, 6, 0, 0] },
      ],
      new Date('2026-09-03T12:00:00Z'), // Thursday
    );
    // The window is the 28th to the 3rd inclusive: 1 + 1 from the previous
    // week, then 2 on Sunday and 3, 4, 5, 6 through Thursday.
    expect(one.last7).toBe(1 + 1 + 2 + 3 + 4 + 5 + 6);
    expect(one.last28).toBe(1 * 7 + 2 + 3 + 4 + 5 + 6);
    // Days after today are not counted even though GitHub returns the slots.
    expect(one.total).toBe(1 * 7 + 2 + 3 + 4 + 5 + 6);
  });

  it('ignores day slots later than today', () => {
    // GitHub returns the whole current week, including days not yet reached.
    // A count in one of those must not inflate the trailing windows.
    const week = Math.floor(Date.UTC(2026, 7, 30) / 1000);
    const one = parseCommitActivity(
      [
        { week: week - 7 * 86_400, total: 0, days: [0, 0, 0, 0, 1, 1, 1] },
        { week, total: 0, days: [1, 1, 1, 1, 1, 1, 1] },
      ],
      new Date('2026-09-02T12:00:00Z'), // Wednesday
    );
    // The 27th to the 2nd: three days from the previous week, four from this.
    expect(one.last7).toBe(7);
    // Thursday to Saturday are in the response but still ahead of today.
    expect(one.last28).toBe(3 + 4);
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

describe('how much of the graph is worth drawing', () => {
  const empty = () => [0, 0, 0, 0, 0, 0, 0];

  it('keeps every week when the repository has been busy all year', () => {
    const busyYear = parseCommitActivity(commitActivityFixture, new Date());
    expect(visibleWeeks(busyYear.weeks)).toHaveLength(52);
  });

  it('drops leading blank weeks but never goes below the floor', () => {
    const weeks = Array.from({ length: 52 }, (_, index) =>
      index === 51 ? [0, 0, 0, 0, 14, 12, 0] : empty(),
    );
    // One active week would be a single useless column, so a floor applies.
    expect(visibleWeeks(weeks, 16)).toHaveLength(16);
    expect(visibleWeeks(weeks, 16).at(-1)).toEqual([0, 0, 0, 0, 14, 12, 0]);
  });

  it('trims to the repository life when that is more than the floor', () => {
    const weeks = Array.from({ length: 52 }, (_, index) =>
      index >= 22 ? [1, 0, 0, 0, 0, 0, 0] : empty(),
    );
    expect(visibleWeeks(weeks, 16)).toHaveLength(30);
  });

  it('leaves a fully blank or already-active graph alone', () => {
    const blank = Array.from({ length: 52 }, empty);
    expect(visibleWeeks(blank, 16)).toHaveLength(52);
    const busy = Array.from({ length: 52 }, () => [1, 0, 0, 0, 0, 0, 0]);
    expect(visibleWeeks(busy, 16)).toHaveLength(52);
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
