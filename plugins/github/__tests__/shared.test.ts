import { describe, expect, it } from 'vitest';
import { server } from '../server';

describe('views that share a fetch', () => {
  it('groups the repository views together and the person views apart', () => {
    const key = (view: string) => server.dataKey?.({}, view);
    expect(key('commits')).toBe(key('figures'));
    expect(key('figures')).toBe(key('people'));
    expect(key('people')).toBe(key('repo'));
    expect(key('heatmap')).toBe(key('activity'));
    expect(key('commits')).not.toBe(key('heatmap'));
  });
});
