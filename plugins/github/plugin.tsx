import { GitBranch } from 'lucide-react';

import { readStringSetting } from '@/lib/morrow/settings';
import { definePlugin, type PluginViewProps } from '@/lib/morrow/types';

import { compactNumber, describeEvent, relativeTime } from './events';
import {
  contributionLevel,
  isGitHubData,
  visibleWeeks,
  type GitHubData,
} from './github';

import './plugin.css';

/**
 * GitHub activity: a contribution heatmap, a feed of recent events, or the
 * pulse of one repository. Data is fetched by `server.ts`; the token, if any,
 * never reaches a Player.
 */

const EVENT_ROWS = 8;

function readLabels({ settings }: PluginViewProps) {
  const user = readStringSetting(settings, 'user').replace(/^@/, '');
  const repo = readStringSetting(settings, 'repo');
  const label = readStringSetting(settings, 'label');
  return { user, repo, label };
}

/**
 * A year as a grid of dots: 7 rows of weekdays, one column per week, sized by
 * how busy the day was. The same visual language as the world map, and shared
 * by the person's calendar and the repository's commits.
 */
/** Sunday first, matching how the weeks are laid out. Three are enough. */
const WEEKDAYS = ['', 'Mon', '', 'Wed', '', 'Fri', ''] as const;

/* Drawn in one coordinate system so the labels always line up with the
   columns and the dots are always round, whatever shape the block is. */
const CELL = 10;
const GUTTER = 26;
const HEADER = 13;
const RADII = [1, 2.4, 3.1, 3.7, 4.3] as const;
/**
 * How wide the drawing should be relative to its height. Few weeks would
 * otherwise leave a wide block mostly empty, so the columns spread out; the
 * dots keep their size, which is set by the row height, and stay round.
 */
const TARGET_RATIO = 2.9;

/** A short month name above the first column that falls in each month. */
function monthLabels(count: number, from: string | undefined): string[] {
  const start = from ? Date.parse(`${from}T00:00:00Z`) : Number.NaN;
  if (!Number.isFinite(start)) return Array.from({ length: count }, () => '');
  let previous = '';
  return Array.from({ length: count }, (_, week) => {
    const date = new Date(start + week * 7 * 86_400_000);
    const name = date.toLocaleDateString('en-GB', {
      month: 'short',
      timeZone: 'UTC',
    });
    if (name === previous) return '';
    previous = name;
    return name;
  });
}

function DotGrid({ weeks, from }: { weeks: number[][]; from?: string }) {
  const max = Math.max(0, ...weeks.flat());
  const months = monthLabels(weeks.length, from);
  const height = HEADER + 7 * CELL;
  // Never tighter than a square lattice, wider when there is room to spread.
  const pitch = Math.max(
    CELL,
    (TARGET_RATIO * height - GUTTER) / Math.max(1, weeks.length),
  );
  const width = GUTTER + weeks.length * pitch;
  return (
    <div className="github-heatmap">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        focusable="false"
      >
        {months.map((name, week) =>
          name ? (
            <text
              key={`m${week}`}
              className="github-axis"
              x={GUTTER + week * pitch}
              y={HEADER - 5}
            >
              {name}
            </text>
          ) : null,
        )}
        {WEEKDAYS.map((day, row) =>
          day ? (
            <text
              key={`d${row}`}
              className="github-axis"
              x={0}
              y={HEADER + row * CELL + CELL / 2 + 1.4}
            >
              {day}
            </text>
          ) : null,
        )}
        {weeks.map((week, w) =>
          week.map((count, d) => {
            if (count < 0) return null;
            const level = contributionLevel(count, max);
            return (
              <circle
                key={`${w}-${d}`}
                className={`is-l${level}`}
                cx={GUTTER + w * pitch + pitch / 2}
                cy={HEADER + d * CELL + CELL / 2}
                r={RADII[level]}
              />
            );
          }),
        )}
      </svg>
    </div>
  );
}

function Frame({
  label,
  children,
  meta,
}: {
  label: string;
  children: React.ReactNode;
  meta?: string;
}) {
  return (
    <div className="plugin-view github-plugin">
      <span className="plugin-label">{label}</span>
      {children}
      {meta && <span className="plugin-meta">{meta}</span>}
    </div>
  );
}

function State({ label, text }: { label: string; text: string }) {
  return (
    <Frame label={label}>
      <span className="github-state">{text}</span>
    </Frame>
  );
}

function ready(
  props: PluginViewProps,
  fallbackLabel: string,
): { data: GitHubData; label: string } | { state: React.ReactElement } {
  const { label: custom, user, repo } = readLabels(props);
  const label = custom || fallbackLabel;
  const { data } = props;
  // With a token the server resolves both from the token itself, so only say
  // this when nothing was typed and nothing came back either.
  if (!user && !repo && !data) {
    return {
      state: (
        <State
          label={label}
          text="Add a token, or a GitHub username or repository, in the block settings"
        />
      ),
    };
  }
  if (!data || !isGitHubData(data.data)) {
    return {
      state: (
        <State
          label={label}
          text={
            data?.error
              ? `GitHub unavailable · ${data.error}`
              : 'Waiting for GitHub'
          }
        />
      ),
    };
  }
  return { data: data.data, label };
}

function HeatmapView(props: PluginViewProps) {
  const { user } = readLabels(props);
  const result = ready(props, user || 'GitHub');
  if ('state' in result) return result.state;
  const { data, label } = result;
  const calendar = data.contributions;
  if (!calendar) {
    return (
      <State
        label={label}
        text={
          data.hasToken
            ? (data.warnings.find((w) => w.startsWith('Contributions')) ??
              'No contribution data')
            : 'Contributions need a token: add one in the block settings'
        }
      />
    );
  }
  return (
    <Frame
      label={label}
      meta={`${calendar.total.toLocaleString('en-GB')} contributions in the last year`}
    >
      <DotGrid weeks={calendar.weeks} />
    </Frame>
  );
}

function ActivityView(props: PluginViewProps) {
  const { user } = readLabels(props);
  const result = ready(props, user || 'GitHub');
  if ('state' in result) return result.state;
  const { data, label } = result;
  const events = data.events;
  if (!events) {
    return (
      <State
        label={label}
        text={
          data.warnings.find((w) => w.startsWith('Activity')) ??
          'No activity data'
        }
      />
    );
  }
  if (events.length === 0) {
    return <State label={label} text="No recent public activity" />;
  }
  return (
    <Frame
      label={label}
      meta={data.hasToken ? undefined : 'Public activity only'}
    >
      <ol className="github-events">
        {events.slice(0, EVENT_ROWS).map((event) => (
          <li key={event.id}>
            <time dateTime={event.at}>{relativeTime(event.at, props.now)}</time>
            <span>{describeEvent(event, data.user)}</span>
          </li>
        ))}
      </ol>
    </Frame>
  );
}

function RepoView(props: PluginViewProps) {
  const { repo: repoSetting } = readLabels(props);
  const result = ready(props, repoSetting || 'Repository');
  if ('state' in result) return result.state;
  const { data, label } = result;
  const repo = data.repo;
  if (!repo) {
    return (
      <State
        label={label}
        text={
          data.warnings.find((w) => w.startsWith('Repository')) ??
          'Enter a repository as owner/name'
        }
      />
    );
  }
  const pushed = repo.pushedAt ? relativeTime(repo.pushedAt, props.now) : '';
  return (
    <Frame
      label={label === 'Repository' ? repo.fullName : label}
      meta={[
        repo.language ?? '',
        pushed
          ? `last push ${pushed === 'now' ? 'just now' : `${pushed} ago`}`
          : '',
        repo.archived ? 'archived' : '',
      ]
        .filter(Boolean)
        .join(' · ')}
    >
      <div className="github-repo-main">
        <strong>{compactNumber(repo.stars)}</strong>
        <small>stars</small>
      </div>
      <ol className="github-figures">
        <li>
          <strong>{compactNumber(repo.forks)}</strong>
          <small>forks</small>
        </li>
        <li>
          <strong>{compactNumber(repo.openIssues)}</strong>
          <small>open issues</small>
        </li>
        {repo.openPulls !== null && (
          <li>
            <strong>{compactNumber(repo.openPulls)}</strong>
            <small>open pull requests</small>
          </li>
        )}
      </ol>
    </Frame>
  );
}

/** How far back the figures actually reach, when it is not a full year. */
function spanLabel(activity: { from: string; to: string }): string {
  const from = Date.parse(`${activity.from}T00:00:00Z`);
  const to = Date.parse(`${activity.to}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 'counted so far';
  const weeks = Math.max(1, Math.round((to - from) / (7 * 86_400_000)));
  return weeks >= 8
    ? `last ${Math.round(weeks / 4.345)} months`
    : `last ${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
}

/**
 * The repository views. Each shows one thing properly rather than crowding a
 * block: the graph, the figures, or the people. They share the same fetched
 * data, so three blocks side by side cost one fetch between them.
 */
function useRepoActivity(props: PluginViewProps) {
  const { repo: repoSetting, label: custom } = readLabels(props);
  const scope =
    props.data && isGitHubData(props.data.data)
      ? props.data.data.commitActivity?.scope
      : '';
  const result = ready(props, custom || repoSetting || scope || 'Repository');
  if ('state' in result) return result;
  const { data, label } = result;
  const pending = data.warnings.find((warning) =>
    warning.startsWith('Commit activity'),
  );
  if (!data.commitActivity && (data.topContributors?.top.length ?? 0) === 0) {
    return {
      state: (
        <State
          label={label}
          text={pending ?? 'Enter a repository as owner/name'}
        />
      ),
    };
  }
  return { data, label, activity: data.commitActivity };
}

function GraphView(props: PluginViewProps) {
  const result = useRepoActivity(props);
  if ('state' in result) return result.state;
  const { label, activity } = result;
  const weeks = activity ? visibleWeeks(activity.weeks) : [];
  if (weeks.length === 0) {
    return <State label={label} text="No commit graph yet" />;
  }
  return (
    <Frame
      label={label}
      meta={`${weeks.length} weeks left to right, weekdays down`}
    >
      <DotGrid weeks={weeks} from={activity?.from} />
    </Frame>
  );
}

function FiguresView(props: PluginViewProps) {
  const result = useRepoActivity(props);
  if ('state' in result) return result.state;
  const { label, activity, data } = result;
  if (!activity) return <State label={label} text="No commit figures yet" />;
  const repoCount = activity.repos.length;
  return (
    <Frame
      label={label}
      meta={
        repoCount > 1
          ? `across ${repoCount} repositories`
          : data.topContributors?.total
            ? `${compactNumber(data.topContributors.total)} contributors`
            : undefined
      }
    >
      <ol className="github-figures is-roomy">
        <li>
          <strong>{compactNumber(activity.last7)}</strong>
          <small>commits this week</small>
        </li>
        <li>
          <strong>{compactNumber(activity.last28)}</strong>
          <small>last 28 days</small>
        </li>
        <li>
          <strong>{compactNumber(activity.total)}</strong>
          <small>
            {activity.wholeYear ? 'last year' : spanLabel(activity)}
          </small>
        </li>
        {activity.allTime !== null && (
          <li>
            <strong>{compactNumber(activity.allTime)}</strong>
            <small>all time</small>
          </li>
        )}
      </ol>
    </Frame>
  );
}

function PeopleView(props: PluginViewProps) {
  const result = useRepoActivity(props);
  if ('state' in result) return result.state;
  const { label, activity, data } = result;
  const developers = activity?.people ?? [];
  /** People if we know them, otherwise repositories, otherwise contributors. */
  const byline: Array<{
    name: string;
    commits: number;
    added?: number;
    removed?: number;
  }> =
    developers.length > 0
      ? developers.map((person) => ({
          name: person.login,
          commits: person.commits,
          added: person.added,
          removed: person.removed,
        }))
      : activity && activity.repos.length > 0
        ? activity.repos.map((repo) => ({
            name: repo.name,
            commits: repo.commits,
          }))
        : (data.topContributors?.top ?? []).map((person) => ({
            name: person.login,
            commits: person.commits,
          }));
  if (byline.length === 0) {
    return <State label={label} text="No contributors yet" />;
  }
  const days = activity?.peopleDays ?? 0;
  const shown = byline.slice(0, 8);
  /** Only give the lines columns when there are lines to put in them. */
  const showLines = shown.some((entry) => entry.added !== undefined);
  return (
    <Frame
      label={label}
      meta={
        developers.length > 0
          ? `commits and lines written, last ${days} days`
          : 'commits, all time'
      }
    >
      <ol className="github-people">
        {showLines && (
          // Name the columns once, so the figures need no explaining.
          <li className="is-head" aria-hidden="true">
            <span />
            <span>Commits</span>
            <span>Added</span>
            <span>Removed</span>
          </li>
        )}
        {shown.map((entry) => (
          <li key={entry.name}>
            <strong>{entry.name}</strong>
            <span className="github-count">{compactNumber(entry.commits)}</span>
            {showLines && (
              <>
                <span className="github-added">
                  {entry.added === undefined
                    ? ''
                    : `+${compactNumber(entry.added)}`}
                </span>
                <span className="github-removed">
                  {entry.removed === undefined
                    ? ''
                    : `\u2212${compactNumber(entry.removed)}`}
                </span>
              </>
            )}
          </li>
        ))}
      </ol>
    </Frame>
  );
}

export const plugin = definePlugin({
  manifest: {
    id: 'morrow.github',
    name: 'GitHub',
    version: '0.1.0',
    description:
      'A repository\u2019s commit activity and contributors, or one person\u2019s contributions and activity.',
    refreshSeconds: 300,
    views: [
      { id: 'commits', name: 'Repository: commit graph' },
      { id: 'figures', name: 'Repository: figures' },
      { id: 'people', name: 'Repository: people' },
      { id: 'repo', name: 'Repository: stars and open work' },
      { id: 'heatmap', name: 'Person: contributions' },
      { id: 'activity', name: 'Person: activity' },
    ],
    settings: [
      // The token comes first because with one, nothing else is needed.
      {
        id: 'token',
        label: 'Personal access token',
        type: 'secret',
        placeholder: 'Paste a token, then press Save beside this field',
      },
      {
        id: 'repo',
        label: 'Limit to a repository or organisation',
        type: 'text',
        placeholder: 'Optional \u00b7 owner/name, or an organisation',
      },
      {
        id: 'user',
        label: 'Limit to one person',
        type: 'text',
        placeholder: 'Optional \u00b7 a GitHub username',
      },
      {
        id: 'windowDays',
        label: 'Count people and lines over',
        type: 'text',
        placeholder: 'Days \u00b7 28 by default, 1 to 365',
      },
      {
        id: 'label',
        label: 'Label',
        type: 'text',
        placeholder: 'Optional \u00b7 defaults to what is shown',
      },
    ],
    defaultSize: { span: 6, rowSpan: 2 },
    minSize: { span: 2, rowSpan: 1 },
    serverFetch: true,
  },
  icon: GitBranch,
  views: {
    commits: GraphView,
    figures: FiguresView,
    people: PeopleView,
    repo: RepoView,
    heatmap: HeatmapView,
    activity: ActivityView,
  },
});
