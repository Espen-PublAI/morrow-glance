import { GitBranch } from 'lucide-react';
import type { CSSProperties } from 'react';

import { readBooleanSetting, readStringSetting } from '@/lib/morrow/settings';
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

function readParts({ settings }: PluginViewProps) {
  return {
    figures: readBooleanSetting(settings, 'showFigures', true),
    graph: readBooleanSetting(settings, 'showGraph', true),
    people: readBooleanSetting(settings, 'showPeople', true),
  };
}

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
/** Sunday first, matching how the weeks are laid out. */
const WEEKDAYS = ['', 'Mon', '', 'Wed', '', 'Fri', ''] as const;

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
  // A CSS grid rather than an SVG: the cells take their size from the block, so
  // the dots fill whatever shape the block is instead of sitting in a band of
  // empty space inside a box of the wrong proportions.
  const style = { '--weeks': weeks.length } as CSSProperties;
  return (
    <div className="github-graph">
      {/* Which way the grid runs is not obvious from dots alone: months across
          the top, weekdays down the side. */}
      <span />
      <ol className="github-months" style={style} aria-hidden="true">
        {monthLabels(weeks.length, from).map((name, index) => (
          <li key={index}>{name}</li>
        ))}
      </ol>
      <ol className="github-weekdays" aria-hidden="true">
        {WEEKDAYS.map((day, index) => (
          <li key={index}>{day}</li>
        ))}
      </ol>
      <div className="github-heatmap" style={style} aria-hidden="true">
        {weeks.map((week, w) =>
          week.map((count, d) => (
            <span
              key={`${w}-${d}`}
              className={
                count < 0 ? 'is-blank' : `is-l${contributionLevel(count, max)}`
              }
            />
          )),
        )}
      </div>
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

function CommitsView(props: PluginViewProps) {
  const { repo: repoSetting, label: custom } = readLabels(props);
  const parts = readParts(props);
  const scope =
    props.data && isGitHubData(props.data.data)
      ? props.data.data.commitActivity?.scope
      : '';
  const result = ready(props, custom || repoSetting || scope || 'Repository');
  if ('state' in result) return result.state;
  const { data, label } = result;
  const activity = data.commitActivity;
  const people = data.topContributors;
  const pending = data.warnings.find((warning) =>
    warning.startsWith('Commit activity'),
  );

  // Show whatever arrived. GitHub computes these statistics lazily, so the
  // graph and the contributors can turn up on different polls, and a block
  // that blanked itself until both were ready would look broken for minutes.
  if (!activity && (!people || people.top.length === 0)) {
    return (
      <State
        label={label}
        text={pending ?? 'Enter a repository as owner/name'}
      />
    );
  }

  const weeks = activity ? visibleWeeks(activity.weeks) : [];
  const repoCount = activity?.repos.length ?? 0;
  const developers = activity?.people ?? [];
  /** People if we know them, otherwise repositories, otherwise contributors. */
  const byline =
    developers.length > 0
      ? developers.map((person) => ({
          name: person.login,
          commits: person.commits,
        }))
      : activity && activity.repos.length > 0
        ? activity.repos.map((repo) => ({
            name: repo.name,
            commits: repo.commits,
          }))
        : (people?.top ?? []).map((person) => ({
            name: person.login,
            commits: person.commits,
          }));
  const meta = [
    developers.length > 0
      ? `${developers.length} ${developers.length === 1 ? 'person' : 'people'} in ${activity?.peopleDays ?? 28} days`
      : repoCount > 0
        ? `${repoCount} ${repoCount === 1 ? 'repository' : 'repositories'}`
        : people?.total
          ? `${compactNumber(people.total)} contributors`
          : '',
    developers.length > 0 && repoCount > 0
      ? `${repoCount} ${repoCount === 1 ? 'repository' : 'repositories'}`
      : '',
    activity && activity.pending > 0
      ? `${activity.pending} still being computed`
      : '',
    weeks.length > 0 && parts.graph
      ? `${weeks.length} weeks left to right, weekdays down`
      : '',
    activity ? '' : 'commit graph on the way',
  ]
    .filter(Boolean)
    .join(' \u00b7 ');

  return (
    <Frame label={label} meta={meta || undefined}>
      {activity &&
        parts.figures && (
          // Figures first: they stay readable however quiet the repository is,
          // where a mostly empty grid does not.
          <ol className="github-figures">
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
              {/* Only call it a year when the data really covers one. */}
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
        )}
      <div className="github-body">
        {weeks.length > 0 && parts.graph && (
          <DotGrid weeks={weeks} from={activity?.from} />
        )}
        {/* Who has been committing answers "how is the team doing" better than
            which repository they committed to. Repositories are the fallback. */}
        {byline.length > 0 && parts.people && (
          <ol className="github-top">
            {byline.slice(0, 5).map((entry) => (
              <li key={entry.name}>
                <strong>{entry.name}</strong>
                <span>{compactNumber(entry.commits)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
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
      { id: 'commits', name: 'Repository: commit activity' },
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
        id: 'label',
        label: 'Label',
        type: 'text',
        placeholder: 'Optional \u00b7 defaults to what is shown',
      },
      // Tick what this block shows, so one can be the graph alone and another
      // the figures and the people.
      {
        id: 'showFigures',
        label: 'Show the figures',
        type: 'boolean',
        defaultValue: true,
      },
      {
        id: 'showGraph',
        label: 'Show the graph',
        type: 'boolean',
        defaultValue: true,
      },
      {
        id: 'showPeople',
        label: 'Show the people',
        type: 'boolean',
        defaultValue: true,
      },
    ],
    defaultSize: { span: 6, rowSpan: 2 },
    minSize: { span: 2, rowSpan: 1 },
    serverFetch: true,
  },
  icon: GitBranch,
  views: {
    commits: CommitsView,
    repo: RepoView,
    heatmap: HeatmapView,
    activity: ActivityView,
  },
});
