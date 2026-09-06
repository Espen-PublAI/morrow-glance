import { readNumberSetting, readStringSetting } from '@/lib/morrow/settings';
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
export interface RepoRef {
  owner: string;
  name: string;
}

export interface RepoCommits {
  name: string;
  commits: number;
}

export interface CommitActivity {
  /** Oldest week first. Seven counts per week, Sunday first. */
  weeks: number[][];
  /** Commits in the whole window GitHub returned, which is 52 weeks. */
  total: number;
  /** Commits in the seven and twenty-eight days ending today. */
  last7: number;
  last28: number;
  from: string;
  to: string;
  /**
   * When the activity covers a whole account or organisation, the busiest
   * repositories in it. Empty for a single repository.
   */
  repos: RepoCommits[];
  /** Repositories whose statistics GitHub had not finished computing. */
  pending: number;
  /** What this covers: one repository, an owner, or everything a token reads. */
  scope: string;
  /**
   * Who has been committing lately, busiest first, counted across every
   * repository covered. Recent rather than all-time, because the question a
   * wall answers is how the team is doing now.
   */
  people: TopContributor[];
  /** The window `people` covers, in days. */
  peopleDays: number;
  /**
   * Whether the figures really cover a year. False when they were counted from
   * the commit list and it ran out of pages, in which case they cover only
   * `from` to `to` and must not be labelled as a year.
   */
  wholeYear: boolean;
  /**
   * Every commit on the default branch, for the whole life of the repository.
   * Null when it could not be determined. Counted exactly, from the last page
   * number of a one-per-page listing, rather than estimated.
   */
  allTime: number | null;
}

export interface TopContributor {
  login: string;
  /** All-time commits to the default branch, which is what GitHub reports. */
  commits: number;
  /**
   * Lines added and removed in the same window as `commits`, when GitHub will
   * report them. Null when it will not. Under squash-merging a commit on the
   * default branch is a whole pull request, so lines say more about volume
   * than a commit count does.
   */
  added?: number;
  removed?: number;
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
  /** Whether a token was supplied, not whether GitHub accepted it. */
  hasToken: boolean;
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

/**
 * A bare account or organisation name, meaning "everything this owner has".
 * `Aptide-ai` is a perfectly reasonable thing to type when you want the
 * organisation rather than one of its repositories.
 */
export function parseOwner(input: string): string | null {
  const trimmed = input
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\/+$/, '');
  return trimmed.includes('/') ? null : normaliseUser(trimmed);
}

export function parseRepoName(input: string): RepoRef | null {
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
/**
 * Add several repositories' weekly arrays together, matched on the week they
 * start rather than on position, so a repository that reports a different
 * number of weeks cannot shift the others.
 */
export function mergeCommitActivity(sources: unknown[]): unknown[] {
  const byWeek = new Map<number, number[]>();
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const raw of source) {
      const week = rec(raw);
      const start = num(week.week, NaN);
      if (!Number.isFinite(start)) continue;
      const days = Array.isArray(week.days) ? week.days : [];
      const row = byWeek.get(start) ?? [0, 0, 0, 0, 0, 0, 0];
      for (let index = 0; index < 7; index += 1) {
        row[index] = (row[index] ?? 0) + num(days[index]);
      }
      byWeek.set(start, row);
    }
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a - b)
    .map(([week, days]) => ({ week, days }));
}

export function parseCommitActivity(
  json: unknown,
  now: Date = new Date(),
): CommitActivity {
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error('GitHub returned no commit activity.');
  }
  const day = (time: number) =>
    new Date(time * 1000).toISOString().slice(0, 10);
  /** Every day slot with its calendar date, so trailing windows are exact. */
  const dated: Array<{ date: string; count: number }> = [];
  let total = 0;
  const weeks = json.map((raw) => {
    const week = rec(raw);
    const days = Array.isArray(week.days) ? week.days : [];
    const row = Array.from({ length: 7 }, (_, index) => num(days[index]));
    total += row.reduce((sum, count) => sum + count, 0);
    // `week` is the Unix timestamp of that week's Sunday.
    const start = num(week.week, NaN);
    if (Number.isFinite(start)) {
      row.forEach((count, index) => {
        dated.push({ date: day(start + index * 86_400), count });
      });
    }
    return row;
  });

  const today = now.toISOString().slice(0, 10);
  const daysAgo = (count: number) =>
    new Date(now.getTime() - count * 86_400_000).toISOString().slice(0, 10);
  const sumSince = (since: string) =>
    dated
      .filter((entry) => entry.date > since && entry.date <= today)
      .reduce((sum, entry) => sum + entry.count, 0);

  const dates = dated.map((entry) => entry.date).sort();
  return {
    weeks,
    total,
    last7: sumSince(daysAgo(7)),
    last28: sumSince(daysAgo(28)),
    from: dates[0] ?? '',
    to: dates[dates.length - 1] ?? '',
    repos: [],
    pending: 0,
    scope: '',
    people: [],
    peopleDays: 0,
    wholeYear: true,
    allTime: null,
  };
}

/**
 * The stretch of the graph worth drawing. A year of columns is the right
 * picture for a repository that has been busy all year, and the wrong one for
 * a repository a week old: 51 of 52 columns are blank and the dots shrink to
 * dust. Leading empty weeks are dropped, never below a floor, so a young
 * repository gets a few wide columns instead of a year of nothing.
 */
export function visibleWeeks(weeks: number[][], minWeeks = 16): number[][] {
  const firstActive = weeks.findIndex((week) =>
    week.some((count) => count > 0),
  );
  if (firstActive <= 0) return weeks;
  const start = Math.min(firstActive, Math.max(0, weeks.length - minWeeks));
  return weeks.slice(start);
}

export interface AuthorLines {
  added: number;
  removed: number;
  commits: number;
}

/**
 * `/stats/contributors` carries, for every author, one bucket per week with
 * lines added, lines removed and commits. Summed over the recent buckets it
 * answers how much code each person actually moved, which a commit count
 * cannot when every pull request is squashed into one commit.
 */
export function parseContributorLines(
  json: unknown,
  since: Date,
): Map<string, AuthorLines> {
  const totals = new Map<string, AuthorLines>();
  if (!Array.isArray(json)) return totals;
  const from = Math.floor(since.getTime() / 1000);
  for (const raw of json) {
    const entry = rec(raw);
    const login = str(rec(entry.author).login);
    const weeks = entry.weeks;
    if (!login || !Array.isArray(weeks)) continue;
    const sum: AuthorLines = { added: 0, removed: 0, commits: 0 };
    for (const rawWeek of weeks) {
      const week = rec(rawWeek);
      // `w` is the week's start; a week that began before the window still
      // counts, since GitHub reports no finer than a week here.
      if (num(week.w, 0) + 6 * 86_400 < from) continue;
      sum.added += num(week.a);
      sum.removed += num(week.d);
      sum.commits += num(week.c);
    }
    if (sum.commits > 0 || sum.added > 0 || sum.removed > 0) {
      totals.set(login, sum);
    }
  }
  return totals;
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

export interface TokenReach {
  /** Classic tokens report their scopes in a header; fine-grained ones do not. */
  scopes: string[] | null;
  /** Whether the token can read any repository at all. */
  seesAnyRepo: boolean;
}

/**
 * Why a token that GitHub accepted can still read nothing in an owner.
 * All four causes look identical from the outside, an empty list, so the one
 * question worth asking is what else the token can reach.
 */
export function describeTokenProblem(owner: string, reach: TokenReach): string {
  const fineGrained = reach.scopes === null;
  if (fineGrained) {
    return reach.seesAnyRepo
      ? `This fine-grained token works but has no grant on ${owner}. Its resource owner is most likely a personal account: create a new one with ${owner} chosen as the resource owner, or use a classic token with the "repo" scope.`
      : `This fine-grained token can read no repositories at all, which usually means an organisation owner has not approved it yet. Check Pending requests in ${owner}'s settings.`;
  }
  const hasRepoScope = reach.scopes?.includes('repo') ?? false;
  if (!hasRepoScope) {
    return `This classic token does not have the "repo" scope, so it cannot read private repositories. Add that scope, or create a new token with it.`;
  }
  return `This classic token has the "repo" scope but no access to ${owner}. If ${owner} uses single sign-on, authorise the token for it in your token list; otherwise check that you are a member with repository access.`;
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
  if (text.trim() === '') return null;
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
  { owner, name }: RepoRef,
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
/** Raised when GitHub never finishes computing a repository's statistics. */
class StatsPendingError extends Error {}

/** How long to wait between attempts while GitHub computes statistics. */
const STATS_BACKOFF_MS = [1200] as const;

async function requestStats(
  url: string,
  token: string | undefined,
): Promise<unknown> {
  for (let attempt = 0; attempt <= STATS_BACKOFF_MS.length; attempt += 1) {
    const response = await request(url, token);
    if (response.status === 404)
      throw new Error('Repository not found on GitHub.');
    // No content: the repository has no commits to report on.
    if (response.status === 204) return [];
    if (response.status === 202) {
      const wait = STATS_BACKOFF_MS[attempt];
      if (wait !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }
      throw new StatsPendingError(
        'GitHub is still working out this repository’s statistics; they appear on the next refresh.',
      );
    }
    if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
    const body = await readJson(response);
    return body;
  }
  throw new Error('GitHub did not return statistics.');
}

async function fetchCommitActivity(
  { owner, name }: RepoRef,
  token: string | undefined,
  now: Date,
): Promise<CommitActivity> {
  let raw: unknown;
  let wholeYear = true;
  try {
    raw = await requestStats(
      `${API}/repos/${owner}/${name}/stats/commit_activity`,
      token,
    );
  } catch {
    // See readCommits: some repositories never get their statistics computed.
    raw = (await readCommits({ owner, name }, token, now)).weeks;
    wholeYear = false;
  }
  const allTime = await fetchTotalCommits({ owner, name }, token).catch(
    () => null,
  );
  return { ...parseCommitActivity(raw, now), wholeYear, allTime };
}

/**
 * The account a token belongs to. With a token there is no need to type a
 * username: GitHub already knows whose it is.
 */
async function fetchViewer(token: string): Promise<string | null> {
  const response = await request(`${API}/user`, token);
  if (!response.ok) return null;
  return str(rec(await readJson(response)).login);
}

/**
 * GitHub computes the statistics endpoints in the background and, for some
 * repositories, never finishes: they answer 202 for ever. Counting commits
 * directly always works, so it is the fallback. It is bounded to a recent
 * window and a few pages, which is what the graph shows anyway.
 */
const FALLBACK_DAYS = 112;
const FALLBACK_PAGES = 6;
const FALLBACK_PER_PAGE = 100;
/** Default window for "who has been committing lately". Set per block. */
export const DEFAULT_WINDOW_DAYS = 28;
export const MIN_WINDOW_DAYS = 1;
export const MAX_WINDOW_DAYS = 365;

/** How far back a block counts people and lines, from its own settings. */
export function windowDays(settings: PluginSettings): number {
  const asked = readNumberSetting(settings, 'windowDays', DEFAULT_WINDOW_DAYS);
  if (!Number.isFinite(asked)) return DEFAULT_WINDOW_DAYS;
  return Math.min(
    MAX_WINDOW_DAYS,
    Math.max(MIN_WINDOW_DAYS, Math.round(asked)),
  );
}

/** The Unix timestamp of the Sunday on or before a moment, at UTC midnight. */
function weekStart(time: number): number {
  const date = new Date(time);
  const sunday = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - date.getUTCDay(),
  );
  return Math.floor(sunday / 1000);
}

/**
 * Commit dates for one repository, bucketed into the weekly shape the
 * statistics endpoint would have returned.
 */
interface RepoActivity {
  /** Weekly buckets in the shape the statistics endpoint returns. */
  weeks: unknown[];
  /** Commits per author within the people window. */
  authors: Map<string, number>;
  /** False when the commit list ran out of pages before the window did. */
  wholeWindow: boolean;
}

/**
 * Commit dates and authors for one repository, in a single pass. Both come
 * from the same pages, so reading them separately would double the cost for
 * no benefit.
 */
async function readCommits(
  { owner, name }: RepoRef,
  token: string | undefined,
  now: Date,
  days = DEFAULT_WINDOW_DAYS,
): Promise<RepoActivity> {
  const since = new Date(
    now.getTime() - Math.max(FALLBACK_DAYS, days) * 86_400_000,
  );
  const peopleSince = new Date(now.getTime() - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const counts = new Map<string, number>();
  const authors = new Map<string, number>();
  let truncated = false;

  for (let page = 1; page <= FALLBACK_PAGES; page += 1) {
    const response = await request(
      `${API}/repos/${owner}/${name}/commits?since=${since.toISOString()}&per_page=${FALLBACK_PER_PAGE}&page=${page}`,
      token,
    );
    // An empty repository answers 409; that is no commits, not a failure.
    if (response.status === 409) break;
    if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
    const body = await readJson(response);
    if (!Array.isArray(body) || body.length === 0) break;
    for (const raw of body) {
      const commit = rec(rec(raw).commit);
      const date =
        str(rec(commit.author).date) ?? str(rec(commit.committer).date);
      if (!date) continue;
      const day = date.slice(0, 10);
      counts.set(day, (counts.get(day) ?? 0) + 1);
      if (day > peopleSince) {
        // Prefer the GitHub account; fall back to the name on the commit so a
        // contributor without a linked account still shows up.
        const login =
          str(rec(rec(raw).author).login) ?? str(rec(commit.author).name);
        if (login) authors.set(login, (authors.get(login) ?? 0) + 1);
      }
    }
    if (body.length < FALLBACK_PER_PAGE) break;
    // A full last page means there is more than this is willing to fetch.
    if (page === FALLBACK_PAGES) truncated = true;
  }

  const weeks: Array<{ week: number; days: number[] }> = [];
  // If the pages ran out, the oldest commit seen is as far back as this can
  // honestly speak for. Claiming the whole window would invent empty weeks and
  // let a truncated count be labelled as a year.
  const oldest = [...counts.keys()].sort()[0];
  const start =
    truncated && oldest ? Date.parse(`${oldest}T00:00:00Z`) : since.getTime();
  const firstWeek = weekStart(start);
  const lastWeek = weekStart(now.getTime());
  for (let week = firstWeek; week <= lastWeek; week += 7 * 86_400) {
    const days = Array.from({ length: 7 }, (_, index) => {
      const day = new Date((week + index * 86_400) * 1000)
        .toISOString()
        .slice(0, 10);
      return counts.get(day) ?? 0;
    });
    weeks.push({ week, days });
  }
  return { weeks, authors, wholeWindow: !truncated };
}

/**
 * Every commit a repository has ever had on its default branch. Asking for one
 * commit per page makes the last page number the exact count, so this is a
 * single request however long the history is.
 */
async function fetchTotalCommits(
  { owner, name }: RepoRef,
  token: string | undefined,
): Promise<number | null> {
  const response = await request(
    `${API}/repos/${owner}/${name}/commits?per_page=1`,
    token,
  );
  // An empty repository answers 409, which is a real zero.
  if (response.status === 409) return 0;
  if (!response.ok) return null;
  const fromLink = parseLastPage(response.headers.get('link'));
  if (fromLink !== null) return fromLink;
  // No link header means a single page, so the count is what came back.
  const body = await readJson(response);
  return Array.isArray(body) ? body.length : null;
}

/**
 * Lines moved per author, from the weekly statistics. This is the endpoint
 * that runs to megabytes on a very large repository, so a response too big to
 * read simply yields nothing rather than failing the block.
 */
async function fetchAuthorLines(
  { owner, name }: RepoRef,
  token: string | undefined,
  since: Date,
): Promise<{ lines: Map<string, AuthorLines>; reason: string | null }> {
  try {
    const raw = await requestStats(
      `${API}/repos/${owner}/${name}/stats/contributors`,
      token,
    );
    // An empty list is GitHub's other way of saying it has not worked this out
    // yet, alongside the 202 it sends the first time.
    if (Array.isArray(raw) && raw.length === 0) {
      return {
        lines: new Map(),
        reason:
          'GitHub has not worked out this repository’s contributor statistics; lines appear once it has.',
      };
    }
    return { lines: parseContributorLines(raw, since), reason: null };
  } catch (cause) {
    return { lines: new Map(), reason: messageOf(cause) };
  }
}

/** How many of an owner's repositories to aggregate, busiest pushed first. */
const OWNER_REPO_LIMIT = 10;

/**
 * An owner's repositories, most recently pushed first. Organisations and
 * personal accounts use different paths, and a token decides whether private
 * repositories are visible at all.
 */
async function listOwnerRepos(
  owner: string,
  token: string | undefined,
): Promise<RepoRef[]> {
  const wanted = owner.toLowerCase();
  const refsFrom = (body: unknown): RepoRef[] =>
    Array.isArray(body)
      ? body
          .map((raw) => str(rec(raw).full_name))
          .filter((full): full is string => full !== null)
          .map((full) => parseRepoName(full))
          .filter((ref): ref is RepoRef => ref !== null)
          .filter((ref) => ref.owner.toLowerCase() === wanted)
      : [];

  let ownerExists = false;
  const query = `?sort=pushed&per_page=${OWNER_REPO_LIMIT}`;
  for (const path of [`orgs/${owner}/repos`, `users/${owner}/repos`]) {
    const response = await request(`${API}/${path}${query}`, token);
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
    ownerExists = true;
    const refs = refsFrom(await readJson(response));
    if (refs.length > 0) return refs;
  }

  // Some grants are only visible through the token's own repository list, so
  // try that before concluding there is nothing to see.
  if (token) {
    const response = await request(
      `${API}/user/repos?affiliation=owner,organization_member&sort=pushed&per_page=100`,
      token,
    );
    if (response.ok) {
      const refs = refsFrom(await readJson(response)).slice(
        0,
        OWNER_REPO_LIMIT,
      );
      if (refs.length > 0) return refs;
    }
  }

  if (!ownerExists) {
    throw new Error(`No GitHub account or organisation called ${owner}.`);
  }
  if (!token) {
    throw new Error(
      `${owner} has no public repositories. Private ones need a token in the block settings.`,
    );
  }
  throw new Error(describeTokenProblem(owner, await tokenReach(token)));
}

/** What else the token can reach, asked once, only on the failure path. */
async function tokenReach(token: string): Promise<TokenReach> {
  try {
    const response = await request(`${API}/user/repos?per_page=1`, token);
    if (!response.ok) return { scopes: null, seesAnyRepo: false };
    // Classic tokens report their scopes here; fine-grained ones send nothing.
    const header = response.headers.get('x-oauth-scopes');
    const body = await readJson(response);
    return {
      scopes:
        header === null
          ? null
          : header
              .split(',')
              .map((scope) => scope.trim())
              .filter(Boolean),
      seesAnyRepo: Array.isArray(body) && body.length > 0,
    };
  } catch {
    return { scopes: null, seesAnyRepo: false };
  }
}

/**
 * Everything the token can read, most recently pushed first. This is the
 * default when no repository or owner is given: a token already says what it
 * has access to, so there is nothing to type.
 */
async function listAccessibleRepos(token: string): Promise<RepoRef[]> {
  const response = await request(
    `${API}/user/repos?affiliation=owner,organization_member&sort=pushed&per_page=${OWNER_REPO_LIMIT}`,
    token,
  );
  if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
  const refs = (await readJson(response)) as unknown;
  const parsed = Array.isArray(refs)
    ? refs
        .map((raw) => str(rec(raw).full_name))
        .filter((full): full is string => full !== null)
        .map((full) => parseRepoName(full))
        .filter((ref): ref is RepoRef => ref !== null)
    : [];
  if (parsed.length === 0) {
    throw new Error(
      describeTokenProblem('this token', await tokenReach(token)),
    );
  }
  return parsed;
}

/**
 * Every repository of one owner, added together. This is the view for "how is
 * our work going" rather than "how is this one repository going", so it costs
 * one request to list the repositories and one per repository after that.
 */
async function fetchOwnerActivity(
  owner: string | null,
  token: string | undefined,
  now: Date,
  days: number,
  warnings: string[] = [],
): Promise<CommitActivity> {
  const repos =
    owner === null
      ? await listAccessibleRepos(token as string)
      : await listOwnerRepos(owner, token);
  const owners = new Set(repos.map((ref) => ref.owner));
  const scope =
    owner ??
    (owners.size === 1
      ? ([...owners][0] ?? '')
      : `${repos.length} repositories`);

  const results = await Promise.all(
    repos.map(async (ref) => {
      // Read the commits once. They give the people either way, and the weekly
      // shape too when GitHub will not compute its own. Keep the failure: when
      // the statistics were merely pending, this is the actionable error.
      const commits = await readCommits(ref, token, now, days).then(
        (value) => ({ value, error: null as unknown }),
        (error: unknown) => ({ value: null, error }),
      );
      try {
        const raw = await requestStats(
          `${API}/repos/${ref.owner}/${ref.name}/stats/commit_activity`,
          token,
        );
        return {
          ref,
          // A repository with no commits reports nothing, not a failure.
          weeks: Array.isArray(raw) ? raw : [],
          authors: commits.value?.authors ?? new Map<string, number>(),
          reason: null,
          wholeYear: true,
        };
      } catch (cause) {
        // GitHub may never finish computing a repository's statistics.
        if (commits.value) {
          return {
            ref,
            weeks: commits.value.weeks,
            authors: commits.value.authors,
            reason: null,
            wholeYear: false,
          };
        }
        // Which error helps depends on the first one. A refusal or a missing
        // repository is the actionable fact; merely waiting on GitHub is not,
        // so there the commit list's failure is what the reader needs.
        const useful =
          cause instanceof StatsPendingError && commits.error
            ? commits.error
            : cause;
        return {
          ref,
          weeks: null,
          authors: new Map<string, number>(),
          reason: messageOf(useful),
          wholeYear: true,
        };
      }
    }),
  );
  const usable = results.filter(
    (
      result,
    ): result is {
      ref: RepoRef;
      weeks: unknown[];
      authors: Map<string, number>;
      reason: null;
      wholeYear: boolean;
    } => result.weeks !== null,
  );
  if (usable.length === 0) {
    // Say what actually went wrong, rather than assuming one cause for all.
    const reasons = [...new Set(results.map((result) => result.reason))];
    throw new Error(
      reasons.filter(Boolean).join(' ') || 'GitHub returned no statistics.',
    );
  }

  const authors = new Map<string, number>();
  for (const result of usable) {
    for (const [login, count] of result.authors) {
      authors.set(login, (authors.get(login) ?? 0) + count);
    }
  }
  // Lines moved, from the weekly statistics, for the same window.
  const peopleSince = new Date(now.getTime() - days * 86_400_000);
  const lineTotals = new Map<string, AuthorLines>();
  const lineFailures: string[] = [];
  await Promise.all(
    usable.map(async (result) => {
      const { lines: found, reason } = token
        ? await fetchAuthorStats(result.ref, token, peopleSince).then(
            (lines) => ({ lines, reason: null as string | null }),
            // The weekly statistics are the fallback, for whatever they hold.
            () => fetchAuthorLines(result.ref, token, peopleSince),
          )
        : await fetchAuthorLines(result.ref, token, peopleSince);
      if (reason) lineFailures.push(reason);
      for (const [login, lines] of found) {
        const running = lineTotals.get(login) ?? {
          added: 0,
          removed: 0,
          commits: 0,
        };
        lineTotals.set(login, {
          added: running.added + lines.added,
          removed: running.removed + lines.removed,
          commits: running.commits + lines.commits,
        });
      }
    }),
  );

  // Say why lines are missing rather than quietly leaving them out.
  if (lineTotals.size === 0 && lineFailures.length > 0) {
    warnings.push(`Lines: ${[...new Set(lineFailures)].join(' ')}`);
  }

  const logins = new Set([...authors.keys(), ...lineTotals.keys()]);
  const people = [...logins]
    .map((login) => {
      const lines = lineTotals.get(login);
      return {
        login,
        // Prefer the commit list, which counts by day rather than by week.
        commits: authors.get(login) ?? lines?.commits ?? 0,
        ...(lines ? { added: lines.added, removed: lines.removed } : {}),
      };
    })
    .filter((person) => person.commits > 0)
    .sort((a, b) => b.commits - a.commits);

  const totals = await Promise.all(
    usable.map(async (result) => {
      try {
        return await fetchTotalCommits(result.ref, token);
      } catch {
        return null;
      }
    }),
  );
  // Only a total if every repository could be counted; a partial sum presented
  // as a total would be worse than none.
  const allTime = totals.every((count) => count !== null)
    ? totals.reduce((sum: number, count) => sum + (count ?? 0), 0)
    : null;

  const weeks = mergeCommitActivity(usable.map((result) => result.weeks));
  // Every repository readable but none with commits: a real answer, not a
  // failure. Report zero rather than throwing.
  const merged =
    weeks.length > 0
      ? parseCommitActivity(weeks, now)
      : {
          weeks: [],
          total: 0,
          last7: 0,
          last28: 0,
          from: '',
          to: '',
          repos: [],
          pending: 0,
          scope: '',
          people: [],
          peopleDays: 0,
          wholeYear: true,
          allTime: null,
        };
  const breakdown = usable
    .map((result) => ({
      name: result.ref.name,
      commits: result.weeks.length
        ? parseCommitActivity(result.weeks, now).total
        : 0,
    }))
    .filter((entry) => entry.commits > 0)
    .sort((a, b) => b.commits - a.commits);
  return {
    ...merged,
    repos: breakdown,
    pending: results.length - usable.length,
    scope,
    people,
    peopleDays: days,
    // Only a year if every repository could give one.
    wholeYear: usable.every((result) => result.wholeYear),
    allTime,
  };
}

/**
 * The top contributors, from the list endpoint rather than
 * `/stats/contributors`: that one carries every contributor's full weekly
 * history and runs to twelve megabytes on a busy repository, for a handful of
 * names and totals.
 */
async function fetchContributors(
  { owner, name }: RepoRef,
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

/**
 * Commits with their line counts, straight from the commit history. This is
 * the only source of per-person lines that does not depend on the statistics
 * GitHub computes lazily and, for some repositories, never finishes. It needs
 * a token, because GraphQL refuses unauthenticated requests.
 */
const AUTHOR_STATS_QUERY = `query($owner: String!, $name: String!, $since: GitTimestamp!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef {
      target {
        ... on Commit {
          history(since: $since, first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              additions
              deletions
              author { user { login } name }
            }
          }
        }
      }
    }
  }
}`;

/** Fold one page of history into the running totals. */
export function foldAuthorStats(
  json: unknown,
  totals: Map<string, AuthorLines>,
): { hasNextPage: boolean; cursor: string | null } {
  const body = rec(json);
  const errors = body.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    throw new Error(str(rec(errors[0]).message) ?? 'GitHub refused the query.');
  }
  const history = rec(
    rec(rec(rec(rec(body.data).repository).defaultBranchRef).target).history,
  );
  const nodes = Array.isArray(history.nodes) ? history.nodes : [];
  for (const raw of nodes) {
    const node = rec(raw);
    const author = rec(node.author);
    // Prefer the GitHub account, and fall back to the name on the commit so a
    // contributor without a linked account is still counted.
    const login = str(rec(author.user).login) ?? str(author.name);
    if (!login) continue;
    const running = totals.get(login) ?? { added: 0, removed: 0, commits: 0 };
    totals.set(login, {
      added: running.added + num(node.additions),
      removed: running.removed + num(node.deletions),
      commits: running.commits + 1,
    });
  }
  const page = rec(history.pageInfo);
  return {
    hasNextPage: page.hasNextPage === true,
    cursor: str(page.endCursor),
  };
}

async function fetchAuthorStats(
  { owner, name }: RepoRef,
  token: string,
  since: Date,
): Promise<Map<string, AuthorLines>> {
  const totals = new Map<string, AuthorLines>();
  let cursor: string | null = null;
  for (let page = 0; page < FALLBACK_PAGES; page += 1) {
    const response = await request(`${API}/graphql`, token, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: AUTHOR_STATS_QUERY,
        variables: { owner, name, since: since.toISOString(), cursor },
      }),
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
    const next = foldAuthorStats(await readJson(response), totals);
    if (!next.hasNextPage || !next.cursor) break;
    cursor = next.cursor;
  }
  return totals;
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
  // A bare name means the whole account or organisation.
  const owner = rawRepo && !repoName ? parseOwner(rawRepo) : null;

  // An unusable entry in one field becomes a warning, not a failure. Both
  // fields are optional and feed different views, so a typo in the repository
  // must not hide the contribution heatmap for a perfectly good username.
  const fieldWarnings: string[] = [];
  if (rawUser && !user) {
    fieldWarnings.push(
      `Activity: "${rawUser}" is not a valid GitHub username.`,
    );
  }
  if (rawRepo && !repoName && !owner) {
    fieldWarnings.push(
      `Repository: "${rawRepo}" is not a repository as owner/name, nor an account or organisation name.`,
    );
  }
  const token =
    context.secrets.token || context.env.MORROW_GITHUB_TOKEN || undefined;

  // With a token neither field is needed: GitHub knows whose token it is and
  // which repositories it can read.
  // Only the person views need a person, and only they justify asking GitHub
  // who the token belongs to.
  const personViews = context.view === 'heatmap' || context.view === 'activity';
  const viewer =
    !user && token && personViews ? await fetchViewer(token) : null;
  const person = user ?? viewer;
  /** No repository or owner named, but a token: cover all it can read. */
  const wholeToken = !rawRepo && Boolean(token);

  const data: GitHubData = {
    user: person,
    repo: null,
    events: null,
    contributions: null,
    commitActivity: null,
    topContributors: null,
    warnings: fieldWarnings,
    hasToken: Boolean(token),
    fetchedAt: context.now.toISOString(),
  };
  const attempt = async (label: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (cause) {
      data.warnings.push(`${label}: ${messageOf(cause)}`);
    }
  };

  if (!person && !repoName && !owner && !wholeToken) {
    throw new Error(
      fieldWarnings[0]?.replace(/^\w+: /, '') ??
        'Add a token, or enter a repository as owner/name, an account or organisation name, or a GitHub username.',
    );
  }

  const tasks: Promise<void>[] = [];
  if (person && personViews) {
    tasks.push(
      attempt('Activity', async () => {
        data.events = await fetchEvents(person, token);
      }),
    );
    if (token) {
      tasks.push(
        attempt('Contributions', async () => {
          data.contributions = await fetchContributions(person, token);
        }),
      );
    }
  }
  const repoViews = ['commits', 'figures', 'people', 'repo'].includes(
    context.view,
  );
  if ((owner || wholeToken) && repoViews) {
    tasks.push(
      attempt('Commit activity', async () => {
        data.commitActivity = await fetchOwnerActivity(
          owner,
          token,
          context.now,
          windowDays(settings),
          data.warnings,
        );
      }),
    );
  }
  if (repoName && repoViews) {
    tasks.push(
      attempt('Repository', async () => {
        data.repo = await fetchRepo(repoName, token);
      }),
      attempt('Commit activity', async () => {
        data.commitActivity = await fetchCommitActivity(
          repoName,
          token,
          context.now,
        );
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
