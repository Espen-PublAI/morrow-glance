import type { ActivityEvent } from './github';

/**
 * Turn GitHub's event records into short sentences a wall display can carry.
 * Pure functions, tested against captured events.
 */

/** Drop the owner when it is the person whose activity this is. */
export function shortRepo(repo: string, user: string | null): string {
  const [owner, name] = repo.split('/');
  if (user && owner && owner.toLowerCase() === user.toLowerCase() && name) {
    return name;
  }
  return repo;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function describeEvent(
  event: ActivityEvent,
  user: string | null,
): string {
  const repo = shortRepo(event.repo, user);
  const n = event.number !== undefined ? `#${event.number}` : '';
  switch (event.type) {
    case 'PushEvent':
      return event.commits !== undefined
        ? `Pushed ${plural(event.commits, 'commit')} to ${repo}`
        : `Pushed to ${repo}`;
    case 'PullRequestEvent': {
      const verb =
        event.action === 'closed'
          ? event.merged
            ? 'Merged'
            : 'Closed'
          : event.action === 'reopened'
            ? 'Reopened'
            : 'Opened';
      return `${verb} pull request ${n} in ${repo}`.replace('  ', ' ');
    }
    case 'IssuesEvent':
      return `${capitalise(event.action ?? 'updated')} issue ${n} in ${repo}`.replace(
        '  ',
        ' ',
      );
    case 'IssueCommentEvent':
      return `Commented on ${n} in ${repo}`.replace('  ', ' ');
    case 'PullRequestReviewEvent':
      return `Reviewed pull request ${n} in ${repo}`.replace('  ', ' ');
    case 'PullRequestReviewCommentEvent':
      return `Commented on pull request ${n} in ${repo}`.replace('  ', ' ');
    case 'CreateEvent':
      if (event.refType === 'repository') return `Created ${repo}`;
      if (event.refType === 'tag')
        return `Tagged ${event.ref ?? ''} in ${repo}`;
      return `Created branch ${event.ref ?? ''} in ${repo}`;
    case 'DeleteEvent':
      return `Deleted ${event.refType ?? 'branch'} ${event.ref ?? ''} in ${repo}`;
    case 'WatchEvent':
      return `Starred ${repo}`;
    case 'ForkEvent':
      return `Forked ${repo}`;
    case 'ReleaseEvent':
      return `Released ${event.tag ?? ''} in ${repo}`.replace('  ', ' ');
    case 'PublicEvent':
      return `Made ${repo} public`;
    case 'MemberEvent':
      return `Added a collaborator to ${repo}`;
    default:
      return `${event.type.replace(/Event$/, '').replace(/([a-z])([A-Z])/g, '$1 $2')} in ${repo}`;
  }
}

/** Compact relative time for a wall: now, 5m, 2h, 3d, 2w, or a date. */
export function relativeTime(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d`;
  const weeks = Math.round(days / 7);
  if (weeks < 9) return `${weeks}w`;
  return new Date(then).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

/** 1234 → 1,234; 12345 → 12.3k, for figures on a wall. */
export function compactNumber(value: number): string {
  if (value >= 10_000) {
    const k = value / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return value.toLocaleString('en-GB');
}
