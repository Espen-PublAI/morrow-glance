import { readStringSetting } from '@/lib/morrow/settings';
import { readBodyWithLimit } from '@/lib/morrow/sources';
import type { PluginServerContext, PluginSettings } from '@/lib/morrow/types';

/**
 * GitHub client and parsers. The parsers are pure and tested against captured
 * API responses; `fetchGitHub` is the only function that talks to the network
 * and runs in Morrow Server only.
 *
 * Stored data is kept deliberately small. Contributions are 53 weeks of seven
 * integers rather than dated objects, and events keep only the fields a
 * sentence needs, so a year of activity fits in a few kilobytes.
 */

export const API = 'https://api.github.com';
const TIMEOUT_MS = 10_000;
/** Raw event payloads are large; the parser slims them before storage. */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const EVENTS_PER_PAGE = 30;

export interface RepoPulse {
  fullName: string;
  description: string | null;
  stars: number;
  forks: number;
  /** Issues only; GitHub's `open_issues_count` includes pull requests. */
  openIssues: number;
  /** Null when the count could not be determined. */
  openPulls: number | null;
  pushedAt: string;
  language: string | null;
  archived: boolean;
}

export interface ActivityEvent {
  id: string;
  type: string;
  /** `owner/name` */
  repo: string;
  at: string;
  action?: string;
  number?: number;
  merged?: boolean;
  ref?: string;
  refType?: string;
  commits?: number;
  tag?: string;
}

/** The repository's own week-by-week commits, every contributor included. */
export interface CommitActivity {
  /** Oldest week first. Seven counts per week, Sunday first. */
  weeks: number[][];
  total: number;
  from: string;
  to: string;
}

export interface TopContributor {
  login: string;
  /** All-time commits to the default branch, which is what GitHub reports. */
  commits: number;
}

export interface RepoContributors {
  /** Null when the count could not be determined. */
  total: number | null;
  top: TopContributor[];
}

export interface Contributions {
  total: number;
  /** Oldest week first. Seven counts per week, Sunday first; -1 = outside the range. */
  weeks: number[][];
  from: string;
  to: string;
}

export interface GitHubData {
  user: string | null;
  repo: RepoPulse | null;
  events: ActivityEvent[] | null;
  /** One person's contribution calendar. Needs a token. */
  contributions: Contributions | null;
  /** The repository's commits by week, all contributors. No token needed. */
  commitActivity: CommitActivity | null;
  topContributors: RepoContributors | null;
  /** Parts that were asked for but could not be fetched, in plain language. */
  warnings: string[];
  authenticated: boolean;
  fetchedAt: string;
}

type Json = Record<string, unknown>;

function rec(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
}
function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/* Settings ----------------------------------------------------------------- */

/** GitHub usernames: letters, digits, single hyphens, at most 39 characters. */
const USERNAME = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
const REPO_PART = /^[\w.-]+$/;

export function normaliseUser(input: string): string | null {
  const trimmed = input.trim().replace(/^@/, '');
  return USERNAME.test(trimmed) ? trimmed : null;
}

export function parseRepoName(
  input: string,
): { owner: string; name: string } | null {
  const trimmed = input
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
  const [owner, name, ...rest] = trimmed.split('/');
  if (!owner || !name || rest.length > 0) return null;
  if (!REPO_PART.test(owner) || !REPO_PART.test(name)) return null;
  return { owner, name };
}

/* Parsers ------------------------------------------------------------------ */

/** The `page` number of the `rel="last"` link, which with per_page=1 is a count. */
export function parseLastPage(link: string | null): number | null {
  if (!link) return null;
  const match = /<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

export function parseRepo(json: unknown, openPulls: number | null): RepoPulse {
  const source = rec(json);
  const fullName = str(source.full_name);
  if (!fullName) throw new Error('GitHub returned an unexpected repository.');
  const openAll = num(source.open_issues_count);
  return {
    fullName,
    description: str(source.description),
    stars: num(source.stargazers_count),
    forks: num(source.forks_count),
    openIssues: openPulls === null ? openAll : Math.max(0, openAll - openPulls),
    openPulls,
    pushedAt: str(source.pushed_at) ?? '',
    language: str(source.language),
    archived: source.archived === true,
  };
}

export function parseEvents(json: unknown): ActivityEvent[] {
  if (!Array.isArray(json))
    throw new Error('GitHub returned unexpected events.');
  const events: ActivityEvent[] = [];
  for (const raw of json) {
    const source = rec(raw);
    const id = str(source.id);
    const type = str(source.type);
    const repo = str(rec(source.repo).name);
    const at = str(source.created_at);
    if (!id || !type || !repo || !at) continue;
    const payload = rec(source.payload);
    const event: ActivityEvent = { id, type, repo, at };
    const action = str(payload.action);
    if (action) event.action = action;
    const pull = rec(payload.pull_request);
    const issue = rec(payload.issue);
    const number = num(pull.number, NaN) || num(issue.number, NaN);
    if (Number.isFinite(number)) event.number = number;
    if (pull.merged === true) event.merged = true;
    const ref = str(payload.ref);
    if (ref) event.ref = ref.replace(/^refs\/heads\//, '');
    const refType = str(payload.ref_type);
    if (refType) event.refType = refType;
    if (type === 'PushEvent') {
      // GitHub caps the commits array at 20 and sometimes omits it; the size
      // fields are the authoritative count.
      const commits =
        num(payload.distinct_size, NaN) ||
        num(payload.size, NaN) ||
        // An empty array means GitHub withheld the details, not zero commits.
        (Array.isArray(payload.commits) ? payload.commits.length || NaN : NaN);
      if (Number.isFinite(commits)) event.commits = commits;
    }
    const tag = str(rec(payload.release).tag_name);
    if (tag) event.tag = tag;
    events.push(event);
  }
  return events;
}

/**
 * `/stats/commit_activity` gives the last 52 weeks as `{ week, total, days }`
 * with `days` running Sunday to Saturday, which is already the shape the dot
 * grid wants.
 */
export function parseCommitActivity(json: unknown): CommitActivity {
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error('GitHub returned no commit activity.');
  }
  let total = 0;
  let from = '';
  let to = '';
  const weeks = json.map((raw) => {
    const week = rec(raw);
    const days = Array.isArray(week.days) ? week.days : [];
    const row = Array.from({ length: 7 }, (_, day) => num(days[day]));
    total += row.reduce((sum, count) => sum + count, 0);
    // `week` is the Unix timestamp of that week's Sunday.
    const start = num(week.week, NaN);
    if (Number.isFinite(start)) {
      const sunday = new Date(start * 1000);
      const saturday = new Date((start + 6 * 86_400) * 1000);
      const iso = (date: Date) => date.toISOString().slice(0, 10);
      if (!from || iso(sunday) < from) from = iso(sunday);
      if (!to || iso(saturday) > to) to = iso(saturday);
    }
    return row;
  });
  return { weeks, total, from, to };
}

/** `/contributors` is ordered by commits, so the first entries are the top. */
export function parseContributors(
  json: unknown,
  total: number | null,
): RepoContributors {
  if (!Array.isArray(json)) {
    throw new Error('GitHub returned unexpected contributors.');
  }
  const top: TopContributor[] = [];
  for (const raw of json) {
    const source = rec(raw);
    const login = str(source.login);
    if (!login) continue;
    top.push({ login, commits: num(source.contributions) });
  }
  return { total: total ?? (top.length > 0 ? top.length : null), top };
}

export function parseContributions(json: unknown): Contributions {
  const body = rec(json);
  const errors = body.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    throw new Error(str(rec(errors[0]).message) ?? 'GitHub refused the query.');
  }
  const user = rec(body.data).user;
  if (user === null) throw new Error('GitHub user not found.');
  const calendar = rec(
    rec(rec(user).contributionsCollection).contributionCalendar,
  );
  const rawWeeks = calendar.weeks;
  if (!Array.isArray(rawWeeks) || rawWeeks.length === 0) {
    throw new Error('GitHub returned no contribution calendar.');
  }
  let from = '';
  let to = '';
  const weeks = rawWeeks.map((rawWeek) => {
    const row = [-1, -1, -1, -1, -1, -1, -1];
    const days = rec(rawWeek).contributionDays;
    if (!Array.isArray(days)) return row;
    for (const rawDay of days) {
      const day = rec(rawDay);
      const weekday = num(day.weekday, -1);
      const date = str(day.date);
      if (weekday < 0 || weekday > 6 || !date) continue;
      row[weekday] = num(day.contributionCount);
      if (!from || date < from) from = date;
      if (!to || date > to) to = date;
    }
    return row;
  });
  return { total: num(calendar.totalContributions), weeks, from, to };
}

/** GitHub's own scale: four quartiles of the busiest day, and zero. */
export function contributionLevel(
  count: number,
  max: number,
): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  const level = Math.ceil((count / max) * 4);
  return Math.min(4, Math.max(1, level)) as 1 | 2 | 3 | 4;
}

export function isGitHubData(value: unknown): value is GitHubData {
  const source = rec(value);
  return (
    Array.isArray(source.warnings) &&
    typeof source.fetchedAt === 'string' &&
    'repo' in source &&
    'events' in source &&
    'contributions' in source
  );
}

/* Network (Morrow Server only) --------------------------------------------- */

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Unknown error.';
}

async function request(
  url: string,
  token: string | undefined,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent':
          'Morrow Glance (+https://github.com/Espen-PublAI/morrow-glance)',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (response.status === 401) {
      throw new Error('GitHub rejected the token.');
    }
    if (
      (response.status === 403 || response.status === 429) &&
      response.headers.get('x-ratelimit-remaining') === '0'
    ) {
      throw new Error(
        token
          ? 'GitHub rate limit reached; it resets within the hour.'
          : 'GitHub rate limit reached: 60 requests an hour without a token, shared by everyone on this address. Add a token in the block settings.',
      );
    }
    return response;
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw new Error('GitHub did not answer within 10 seconds.');
    }
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await readBodyWithLimit(response, MAX_RESPONSE_BYTES);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('GitHub did not return JSON.');
  }
}

async function fetchEvents(
  user: string,
  token: string | undefined,
): Promise<ActivityEvent[]> {
  // With a token the feed includes activity the token may see privately.
  const path = token ? `users/${user}/events` : `users/${user}/events/public`;
  const response = await request(
    `${API}/${path}?per_page=${EVENTS_PER_PAGE}`,
    token,
  );
  if (response.status === 404)
    throw new Error(`GitHub user "${user}" not found.`);
  if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
  return parseEvents(await readJson(response));
}

async function fetchRepo(
  { owner, name }: { owner: string; name: string },
  token: string | undefined,
): Promise<RepoPulse> {
  const base = `${API}/repos/${owner}/${name}`;
  const [repoResponse, pullsResponse] = await Promise.all([
    request(base, token),
    // per_page=1 makes the last page number the count of open pull requests.
    request(`${base}/pulls?state=open&per_page=1`, token),
  ]);
  if (repoResponse.status === 404) {
    throw new Error(`Repository ${owner}/${name} not found on GitHub.`);
  }
  if (!repoResponse.ok)
    throw new Error(`GitHub answered ${repoResponse.status}.`);
  let openPulls: number | null = null;
  if (pullsResponse.ok) {
    const fromLink = parseLastPage(pullsResponse.headers.get('link'));
    const body = await readJson(pullsResponse);
    openPulls = fromLink ?? (Array.isArray(body) ? body.length : null);
  }
  return parseRepo(await readJson(repoResponse), openPulls);
}

/**
 * The statistics endpoints answer 202 with an empty body while GitHub computes
 * them in the background, which happens on the first request for a repository.
 * One retry covers the common case; beyond that the next poll will get it,
 * five minutes being sooner than it is worth blocking a fetch for.
 */
async function requestStats(
  url: string,
  token: string | undefined,
): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request(url, token);
    if (response.status === 404)
      throw new Error('Repository not found on GitHub.');
    if (response.status === 202) {
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      throw new Error(
        'GitHub is still working out this repository’s statistics; they appear on the next refresh.',
      );
    }
    if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
    return readJson(response);
  }
  throw new Error('GitHub did not return statistics.');
}

async function fetchCommitActivity(
  { owner, name }: { owner: string; name: string },
  token: string | undefined,
): Promise<CommitActivity> {
  return parseCommitActivity(
    await requestStats(
      `${API}/repos/${owner}/${name}/stats/commit_activity`,
      token,
    ),
  );
}

/**
 * The top contributors, from the list endpoint rather than
 * `/stats/contributors`: that one carries every contributor's full weekly
 * history and runs to twelve megabytes on a busy repository, for a handful of
 * names and totals.
 */
async function fetchContributors(
  { owner, name }: { owner: string; name: string },
  token: string | undefined,
): Promise<RepoContributors> {
  const base = `${API}/repos/${owner}/${name}/contributors`;
  const [listResponse, countResponse] = await Promise.all([
    request(`${base}?per_page=5`, token),
    request(`${base}?per_page=1`, token),
  ]);
  if (listResponse.status === 204) return { total: 0, top: [] };
  if (!listResponse.ok)
    throw new Error(`GitHub answered ${listResponse.status}.`);
  const total = countResponse.ok
    ? parseLastPage(countResponse.headers.get('link'))
    : null;
  return parseContributors(await readJson(listResponse), total);
}

const CONTRIBUTIONS_QUERY = `query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount weekday } }
      }
    }
  }
}`;

async function fetchContributions(
  user: string,
  token: string,
): Promise<Contributions> {
  const response = await request(`${API}/graphql`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: CONTRIBUTIONS_QUERY,
      variables: { login: user },
    }),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
  return parseContributions(await readJson(response));
}

/**
 * Fetch whatever the settings ask for. Each part is independent: a token that
 * cannot read contributions must not hide the activity feed. The fetch fails
 * only when nothing at all came back.
 */
export async function fetchGitHub(
  settings: PluginSettings,
  context: PluginServerContext,
): Promise<GitHubData> {
  const rawUser = readStringSetting(settings, 'user');
  const rawRepo = readStringSetting(settings, 'repo');
  const user = rawUser ? normaliseUser(rawUser) : null;
  const repoName = rawRepo ? parseRepoName(rawRepo) : null;

  // An unusable entry in one field becomes a warning, not a failure. Both
  // fields are optional and feed different views, so a typo in the repository
  // must not hide the contribution heatmap for a perfectly good username.
  const fieldWarnings: string[] = [];
  if (rawUser && !user) {
    fieldWarnings.push(
      `Activity: "${rawUser}" is not a valid GitHub username.`,
    );
  }
  if (rawRepo && !repoName) {
    fieldWarnings.push(
      `Repository: "${rawRepo}" needs an owner, as in ${user ?? 'owner'}/${rawRepo}.`,
    );
  }
  if (!user && !repoName) {
    throw new Error(
      fieldWarnings[0]?.replace(/^\w+: /, '') ??
        'Enter a GitHub username, a repository as owner/name, or both.',
    );
  }
  const token =
    context.secrets.token || context.env.MORROW_GITHUB_TOKEN || undefined;

  const data: GitHubData = {
    user,
    repo: null,
    events: null,
    contributions: null,
    commitActivity: null,
    topContributors: null,
    warnings: fieldWarnings,
    authenticated: Boolean(token),
    fetchedAt: context.now.toISOString(),
  };
  const attempt = async (label: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (cause) {
      data.warnings.push(`${label}: ${messageOf(cause)}`);
    }
  };

  const tasks: Promise<void>[] = [];
  if (user) {
    tasks.push(
      attempt('Activity', async () => {
        data.events = await fetchEvents(user, token);
      }),
    );
    if (token) {
      tasks.push(
        attempt('Contributions', async () => {
          data.contributions = await fetchContributions(user, token);
        }),
      );
    }
  }
  if (repoName) {
    tasks.push(
      attempt('Repository', async () => {
        data.repo = await fetchRepo(repoName, token);
      }),
      attempt('Commit activity', async () => {
        data.commitActivity = await fetchCommitActivity(repoName, token);
      }),
      attempt('Contributors', async () => {
        data.topContributors = await fetchContributors(repoName, token);
      }),
    );
  }
  await Promise.all(tasks);

  if (
    !data.events &&
    !data.contributions &&
    !data.repo &&
    !data.commitActivity &&
    !data.topContributors
  ) {
    const first = data.warnings[0] ?? 'GitHub returned nothing.';
    throw new Error(first.replace(/^[A-Za-z]+: /, ''));
  }
  return data;
}
