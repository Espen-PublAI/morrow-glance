import { describe, expect, it } from 'vitest';

import { sourceKey } from '@/lib/morrow/sources';

/**
 * Blocks that fetch the same thing should cost one call between them. The
 * grouping is keyed on what a fetch depends on, so this pins the parts of that
 * key that are easy to get wrong.
 */

describe('what a fetch is keyed on', () => {
  const settings = { repo: 'Aptide-ai' };
  const plugin = { kind: 'plugin' as const, intervalSeconds: 300 };

  it('separates two plugins that happen to share settings', () => {
    expect(sourceKey(plugin, settings, 'morrow.github')).not.toBe(
      sourceKey(plugin, settings, 'morrow.weather'),
    );
  });

  it('separates different settings and joins identical ones', () => {
    expect(sourceKey(plugin, settings, 'morrow.github')).toBe(
      sourceKey(plugin, { repo: 'Aptide-ai' }, 'morrow.github'),
    );
    expect(sourceKey(plugin, settings, 'morrow.github')).not.toBe(
      sourceKey(plugin, { repo: 'other' }, 'morrow.github'),
    );
  });

  it('keys a poll on its address alone, since that is all it depends on', () => {
    const poll = {
      kind: 'poll' as const,
      url: 'https://a/',
      intervalSeconds: 60,
    };
    expect(sourceKey(poll, { a: 1 }, 'x')).toBe(sourceKey(poll, { b: 2 }, 'y'));
  });
});
