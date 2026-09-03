import { describe, expect, it } from 'vitest';

import {
  blockDataToDrop,
  blocksWithSources,
  formatValue,
  isAllowedSourceUrl,
  isStale,
  readBodyWithLimit,
  readPath,
  sourceKey,
} from '@/lib/morrow/sources';
import { morrowConfig } from '@/morrow.config';

describe('isAllowedSourceUrl', () => {
  it('allows public https URLs only', () => {
    expect(
      isAllowedSourceUrl(
        'https://api.met.no/weatherapi/locationforecast/2.0/compact',
      ),
    ).toBe(true);
    expect(isAllowedSourceUrl('http://api.example.com/data')).toBe(false);
    expect(isAllowedSourceUrl('ftp://example.com/x')).toBe(false);
    expect(isAllowedSourceUrl('not a url')).toBe(false);
    expect(isAllowedSourceUrl('https://user:pw@example.com/')).toBe(false);
  });

  it('refuses loopback, private, link-local, and internal names', () => {
    for (const bad of [
      'https://localhost/x',
      'https://127.0.0.1/x',
      'https://10.0.0.5/x',
      'https://172.16.4.4/x',
      'https://192.168.1.1/x',
      'https://169.254.169.254/latest/meta-data',
      'https://100.64.0.1/x',
      'https://[::1]/x',
      'https://[fd00::1]/x',
      'https://intranet/x',
      'https://files.internal/x',
      'https://printer.local/x',
      'https://metadata.google.internal/x',
    ]) {
      expect(isAllowedSourceUrl(bad), bad).toBe(false);
    }
  });
});

describe('isStale', () => {
  const source = {
    kind: 'poll' as const,
    url: 'https://example.com/',
    intervalSeconds: 300,
  };
  const now = Date.parse('2026-09-03T12:00:00.000Z');

  it('is stale when never fetched, unparsable, or past the interval', () => {
    expect(isStale(source, null, now)).toBe(true);
    expect(isStale(source, 'garbage', now)).toBe(true);
    expect(isStale(source, '2026-09-03T11:54:59.000Z', now)).toBe(true);
    expect(isStale(source, '2026-09-03T11:55:01.000Z', now)).toBe(false);
  });

  it('retries a failed fetch after a minute instead of the full interval', () => {
    expect(isStale(source, '2026-09-03T11:58:30.000Z', now, true)).toBe(true);
    expect(isStale(source, '2026-09-03T11:59:30.000Z', now, true)).toBe(false);
  });
});

describe('readPath', () => {
  const data = {
    main: { temp: 21.456 },
    items: [{ name: 'a' }, { name: 'b' }],
    ok: true,
  };

  it('walks dotted paths and array indexes', () => {
    expect(readPath(data, 'main.temp')).toBe(21.456);
    expect(readPath(data, 'items[1].name')).toBe('b');
    expect(readPath(data, 'items.0.name')).toBe('a');
    expect(readPath(data, '')).toBe(data);
  });

  it('returns undefined for missing steps without throwing', () => {
    expect(readPath(data, 'main.humidity')).toBeUndefined();
    expect(readPath(data, 'items[9].name')).toBeUndefined();
    expect(readPath(data, 'ok.deeper')).toBeUndefined();
    expect(readPath(null, 'x')).toBeUndefined();
  });
});

describe('formatValue', () => {
  it('prints numbers compactly and other values sensibly', () => {
    expect(formatValue(21.456)).toBe('21.5');
    expect(formatValue(21)).toBe('21');
    expect(formatValue(3.0)).toBe('3');
    expect(formatValue(true)).toBe('Yes');
    expect(formatValue('hi')).toBe('hi');
    expect(formatValue(null)).toBe('');
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe('readBodyWithLimit', () => {
  it('returns small bodies and refuses large ones, declared or streamed', async () => {
    expect(await readBodyWithLimit(new Response('{"ok":true}'), 1024)).toBe(
      '{"ok":true}',
    );
    await expect(
      readBodyWithLimit(
        new Response('x', { headers: { 'content-length': '5000' } }),
        1024,
      ),
    ).rejects.toThrow(/larger than 1 KB/);
    await expect(
      readBodyWithLimit(new Response('y'.repeat(2048)), 1024),
    ).rejects.toThrow(/larger than 1 KB/);
    expect(await readBodyWithLimit(new Response(null), 1024)).toBe('');
  });
});

describe('sourceKey and blockDataToDrop', () => {
  const block = (id: string, data?: Record<string, unknown>) => ({
    id,
    plugin: 'morrow.value',
    view: 'big',
    column: 1,
    span: 1,
    row: 1,
    rowSpan: 1,
    ...(data ? { data } : {}),
  });
  const withBlocks = (...blocks: ReturnType<typeof block>[]) =>
    ({
      ...morrowConfig,
      pages: [{ ...morrowConfig.pages[0], blocks }],
    }) as typeof morrowConfig;
  const poll = (url: string) => ({ kind: 'poll', url, intervalSeconds: 300 });

  it('identifies sources by kind and url', () => {
    expect(sourceKey(undefined)).toBeNull();
    expect(sourceKey({ kind: 'webhook' })).toBe('webhook');
    expect(
      sourceKey({ kind: 'poll', url: 'https://a/', intervalSeconds: 60 }),
    ).toBe('poll:https://a/');
  });

  it('drops data for removed blocks and changed sources only', () => {
    const before = withBlocks(
      block('same', poll('https://a/')),
      block('changed', poll('https://a/')),
      block('gone', { kind: 'webhook' }),
      block('nosource'),
    );
    const after = withBlocks(
      block('same', poll('https://a/')),
      block('changed', poll('https://b/')),
      block('nosource'),
      block('new', { kind: 'webhook' }),
    );
    expect(blockDataToDrop(before, after).sort()).toEqual(['changed', 'gone']);
    expect(blockDataToDrop(after, after)).toEqual([]);
  });
});

describe('blocksWithSources with a resolver', () => {
  it('includes blocks whose plugin derives a source from settings', () => {
    const derived = {
      kind: 'poll' as const,
      url: 'https://api.met.no/x',
      intervalSeconds: 3600,
    };
    const resolve = (block: { id: string; data?: unknown }) =>
      block.id === 'weather'
        ? derived
        : (block.data as typeof derived | undefined);
    const blocks = [
      {
        id: 'weather',
        plugin: 'morrow.weather',
        view: 'now',
        column: 1,
        span: 4,
        row: 1,
        rowSpan: 2,
      },
      {
        id: 'plain',
        plugin: 'morrow.text',
        view: 'note',
        column: 5,
        span: 4,
        row: 1,
        rowSpan: 2,
      },
    ];
    const config = {
      ...morrowConfig,
      pages: [{ ...morrowConfig.pages[0], blocks }],
    } as typeof morrowConfig;
    const empty = {
      ...config,
      pages: [{ ...config.pages[0], blocks: [] }],
    } as typeof morrowConfig;
    expect(blocksWithSources(config).map((b) => b.id)).toEqual([]);
    expect(blocksWithSources(config, resolve).map((b) => b.id)).toEqual([
      'weather',
    ]);
    expect(blockDataToDrop(config, empty, resolve)).toEqual(['weather']);
  });
});
