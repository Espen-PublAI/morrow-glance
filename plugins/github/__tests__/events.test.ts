import { describe, expect, it } from 'vitest';

import eventsFixture from './events.json';
import {
  compactNumber,
  describeEvent,
  relativeTime,
  shortRepo,
} from '../events';
import { parseEvents, type ActivityEvent } from '../github';

const at = '2026-09-04T10:00:00Z';
const event = (over: Partial<ActivityEvent>): ActivityEvent => ({
  id: '1',
  type: 'PushEvent',
  repo: 'espen/morrow-glance',
  at,
  ...over,
});

describe('sentences', () => {
  it('drops the owner when it is the person on display', () => {
    expect(shortRepo('Espen-PublAI/morrow-glance', 'espen-publai')).toBe(
      'morrow-glance',
    );
    expect(shortRepo('github/docs', 'espen')).toBe('github/docs');
    expect(shortRepo('github/docs', null)).toBe('github/docs');
  });

  it('describes pushes with a commit count', () => {
    expect(describeEvent(event({ commits: 3 }), 'espen')).toBe(
      'Pushed 3 commits to morrow-glance',
    );
    expect(describeEvent(event({ commits: 1 }), 'espen')).toBe(
      'Pushed 1 commit to morrow-glance',
    );
    expect(describeEvent(event({}), null)).toBe(
      'Pushed to espen/morrow-glance',
    );
  });

  it('tells merged from closed pull requests', () => {
    const pr = { type: 'PullRequestEvent', number: 12 };
    expect(describeEvent(event({ ...pr, action: 'opened' }), 'espen')).toBe(
      'Opened pull request #12 in morrow-glance',
    );
    expect(
      describeEvent(event({ ...pr, action: 'closed', merged: true }), 'espen'),
    ).toBe('Merged pull request #12 in morrow-glance');
    expect(describeEvent(event({ ...pr, action: 'closed' }), 'espen')).toBe(
      'Closed pull request #12 in morrow-glance',
    );
  });

  it('covers issues, comments, reviews, stars, forks, releases, and branches', () => {
    const cases: Array<[Partial<ActivityEvent>, string]> = [
      [
        { type: 'IssuesEvent', action: 'opened', number: 4 },
        'Opened issue #4 in morrow-glance',
      ],
      [
        { type: 'IssueCommentEvent', number: 4 },
        'Commented on #4 in morrow-glance',
      ],
      [
        { type: 'PullRequestReviewEvent', number: 9 },
        'Reviewed pull request #9 in morrow-glance',
      ],
      [{ type: 'WatchEvent' }, 'Starred morrow-glance'],
      [{ type: 'ForkEvent' }, 'Forked morrow-glance'],
      [
        { type: 'ReleaseEvent', tag: 'v1.2.0' },
        'Released v1.2.0 in morrow-glance',
      ],
      [{ type: 'CreateEvent', refType: 'repository' }, 'Created morrow-glance'],
      [
        { type: 'CreateEvent', refType: 'branch', ref: 'feature' },
        'Created branch feature in morrow-glance',
      ],
      [
        { type: 'CreateEvent', refType: 'tag', ref: 'v1' },
        'Tagged v1 in morrow-glance',
      ],
      [
        { type: 'DeleteEvent', refType: 'branch', ref: 'old' },
        'Deleted branch old in morrow-glance',
      ],
      [{ type: 'PublicEvent' }, 'Made morrow-glance public'],
    ];
    for (const [over, expected] of cases) {
      expect(describeEvent(event(over), 'espen')).toBe(expected);
    }
  });

  it('degrades gracefully for a type it has never seen', () => {
    expect(describeEvent(event({ type: 'GollumEvent' }), 'espen')).toBe(
      'Gollum in morrow-glance',
    );
    expect(describeEvent(event({ type: 'CommitCommentEvent' }), 'espen')).toBe(
      'Commit Comment in morrow-glance',
    );
  });

  it('produces a sentence for every captured event, with no double spaces', () => {
    for (const parsed of parseEvents(eventsFixture)) {
      const text = describeEvent(parsed, null);
      expect(text.length).toBeGreaterThan(8);
      expect(text).not.toMatch(/ {2}/);
      expect(text).not.toMatch(/undefined|null/);
    }
  });
});

describe('relative time', () => {
  const now = new Date('2026-09-04T12:00:00Z');
  it('is compact, as a wall needs', () => {
    expect(relativeTime('2026-09-04T11:59:40Z', now)).toBe('now');
    expect(relativeTime('2026-09-04T11:55:00Z', now)).toBe('5m');
    expect(relativeTime('2026-09-04T09:30:00Z', now)).toBe('3h');
    expect(relativeTime('2026-09-01T12:00:00Z', now)).toBe('3d');
    expect(relativeTime('2026-08-14T12:00:00Z', now)).toBe('3w');
    expect(relativeTime('2026-05-01T12:00:00Z', now)).toBe('1 May');
  });

  it('never goes negative and survives garbage', () => {
    expect(relativeTime('2027-01-01T00:00:00Z', now)).toBe('now');
    expect(relativeTime('not a date', now)).toBe('');
  });
});

describe('compact numbers', () => {
  it('keeps small numbers exact and shortens large ones', () => {
    expect(compactNumber(0)).toBe('0');
    expect(compactNumber(1234)).toBe('1,234');
    expect(compactNumber(9999)).toBe('9,999');
    expect(compactNumber(20778)).toBe('20.8k');
    expect(compactNumber(68557)).toBe('68.6k');
    expect(compactNumber(120000)).toBe('120k');
  });
});
