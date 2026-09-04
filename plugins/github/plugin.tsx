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
/** Heatmap geometry in viewBox units. */
const CELL = 10;
const RADII = [0.9, 2.2, 2.9, 3.5, 4.2] as const;

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
function DotGrid({ weeks }: { weeks: number[][] }) {
  const max = Math.max(0, ...weeks.flat());
  const width = weeks.length * CELL;
  const height = 7 * CELL;
  return (
    <div className="github-heatmap">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMinYMid meet"
        aria-hidden="true"
        focusable="false"
      >
        {weeks.map((week, w) =>
          week.map((count, d) => {
            if (count < 0) return null;
            const level = contributionLevel(count, max);
            return (
              <circle
                key={`${w}-${d}`}
                className={`is-l${level}`}
                cx={w * CELL + CELL / 2}
                cy={d * CELL + CELL / 2}
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
  if (!user && !repo) {
    return {
      state: (
        <State
          label={label}
          text="Enter a GitHub username or a repository in the block settings"
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
          data.authenticated
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
      meta={data.authenticated ? undefined : 'Public activity only'}
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

function CommitsView(props: PluginViewProps) {
  const { repo: repoSetting } = readLabels(props);
  const result = ready(props, repoSetting || 'Repository');
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
  const meta = [
    repoCount > 0
      ? `${repoCount} ${repoCount === 1 ? 'repository' : 'repositories'}`
      : people?.total
        ? `${compactNumber(people.total)} contributors`
        : '',
    activity && activity.pending > 0
      ? `${activity.pending} still being computed`
      : '',
    weeks.length > 0 && weeks.length < 52
      ? `graph: last ${weeks.length} weeks`
      : '',
    activity ? '' : 'commit graph on the way',
  ]
    .filter(Boolean)
    .join(' \u00b7 ');

  return (
    <Frame label={label} meta={meta || undefined}>
      {activity && (
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
            <small>last year</small>
          </li>
        </ol>
      )}
      {weeks.length > 0 && <DotGrid weeks={weeks} />}
      {activity && activity.repos.length > 0 ? (
        <ol className="github-top">
          {activity.repos.slice(0, 4).map((repo) => (
            <li key={repo.name}>
              <strong>{repo.name}</strong>
              <span>{compactNumber(repo.commits)}</span>
            </li>
          ))}
        </ol>
      ) : (
        people &&
        people.top.length > 0 && (
          <ol className="github-top">
            {people.top.slice(0, 4).map((person) => (
              <li key={person.login}>
                <strong>{person.login}</strong>
                <span>{compactNumber(person.commits)}</span>
              </li>
            ))}
          </ol>
        )
      )}
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
      {
        id: 'repo',
        label: 'Repository or organisation',
        type: 'text',
        placeholder: 'owner/name, or an organisation name for all of it',
      },
      {
        id: 'user',
        label: 'GitHub username',
        type: 'text',
        placeholder: 'For the two person views',
      },
      {
        id: 'token',
        label: 'Personal access token',
        type: 'secret',
        placeholder: 'Needed for contributions; recommended otherwise',
      },
      {
        id: 'label',
        label: 'Label',
        type: 'text',
        placeholder: 'Defaults to the username or repository',
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
