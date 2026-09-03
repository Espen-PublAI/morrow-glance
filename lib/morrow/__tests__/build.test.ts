import { describe, expect, it } from 'vitest';

import { createBuildTracker } from '@/lib/morrow/build';

describe('createBuildTracker', () => {
  it('ignores unknown ids and never reloads on the first build it sees', () => {
    const tracker = createBuildTracker();
    expect(tracker.observe(null)).toBe(false);
    expect(tracker.observe('unknown')).toBe(false);
    expect(tracker.observe('a')).toBe(false);
    expect(tracker.observe('a')).toBe(false);
  });

  it('reloads only after the same new id is seen on consecutive polls', () => {
    const tracker = createBuildTracker();
    tracker.observe('a');
    expect(tracker.observe('b')).toBe(false);
    expect(tracker.observe('b')).toBe(true);
  });

  it('does not flap during a gradual rollout', () => {
    const tracker = createBuildTracker();
    tracker.observe('a');
    expect(tracker.observe('b')).toBe(false);
    expect(tracker.observe('a')).toBe(false);
    expect(tracker.observe('b')).toBe(false);
    expect(tracker.observe('a')).toBe(false);
    // Once the old build stops answering, two b's in a row trigger the reload.
    expect(tracker.observe('b')).toBe(false);
    expect(tracker.observe('b')).toBe(true);
  });
});
