import { readSecretValues } from '@/db/block-secrets';
import { database, runInBackground } from '@/db/database';
import { resolveBlockSource } from '@/db/block-source';
import { pluginServers } from '@/plugins/server';
import {
  POLL_TIMEOUT_MS,
  blockDataToDrop,
  blocksWithSources,
  isAllowedSourceUrl,
  isStale,
  readBodyWithLimit,
  sourceKey,
} from '@/lib/morrow/sources';
import type { BlockData, GlanceBlock, MorrowConfig } from '@/lib/morrow/types';

const SOURCE_USER_AGENT =
  'Morrow Glance (+https://github.com/Espen-PublAI/morrow-glance)';

/**
 * Per-block data: what a poll fetched or a webhook delivered. One row per
 * block. Poll sources refresh lazily when a Player asks for data and the
 * interval has elapsed, so no scheduler is needed and data stays fresh exactly
 * while someone is looking. Once a block has data, refreshes run in the
 * background and the request returns what is stored, so a slow source never
 * stalls a screen.
 */

interface Row {
  block_id: string;
  data_json: string;
  fetched_at: string;
  error: string | null;
}

function rowToData(row: Row): BlockData {
  let data: unknown = null;
  try {
    data = JSON.parse(row.data_json);
  } catch {
    data = null;
  }
  return { data, fetchedAt: row.fetched_at, error: row.error };
}

function emptyData(): BlockData {
  return { data: null, fetchedAt: null, error: null };
}

/**
 * Stored data for the given blocks. The table holds one row per block that
 * ever had a source, so it is read whole and filtered here rather than with an
 * `IN (...)` list: D1 allows at most 100 bound parameters per statement.
 */
export async function readBlockData(
  blockIds: string[],
): Promise<Record<string, BlockData>> {
  if (blockIds.length === 0) return {};
  const wanted = new Set(blockIds);
  const db = await database();
  const results = await db
    .prepare(
      'SELECT block_id, data_json, fetched_at, error FROM morrow_block_data',
    )
    .all<Row>();
  return Object.fromEntries(
    results
      .filter((row) => wanted.has(row.block_id))
      .map((row) => [row.block_id, rowToData(row)]),
  );
}

/** Store one fetch against every block that shares it. */
export async function writeBlockData(
  blockIds: string | string[],
  data: unknown,
  error: string | null = null,
): Promise<BlockData> {
  const ids = typeof blockIds === 'string' ? [blockIds] : blockIds;
  const db = await database();
  const fetchedAt = new Date().toISOString();
  const json = JSON.stringify(data ?? null);
  const statement = db.prepare(
    `INSERT INTO morrow_block_data (block_id, data_json, fetched_at, error)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(block_id) DO UPDATE SET
         data_json = excluded.data_json,
         fetched_at = excluded.fetched_at,
         error = excluded.error`,
  );
  // D1 caps the parameters in one statement, so write in modest batches.
  for (let index = 0; index < ids.length; index += 20) {
    await db.batch(
      ids
        .slice(index, index + 20)
        .map((id) => statement.bind(id, json, fetchedAt, error)),
    );
  }
  return { data, fetchedAt, error };
}

/** Delete stored data for the given blocks, in small batches. */
export async function deleteBlockData(blockIds: string[]): Promise<void> {
  if (blockIds.length === 0) return;
  const db = await database();
  const statement = db.prepare(
    'DELETE FROM morrow_block_data WHERE block_id = ?',
  );
  for (let i = 0; i < blockIds.length; i += 50) {
    await db.batch(blockIds.slice(i, i + 50).map((id) => statement.bind(id)));
  }
}

/**
 * After a configuration save: drop data for blocks that were removed or whose
 * source changed, so a screen never shows the previous source's values.
 */
export async function reconcileBlockData(
  previous: MorrowConfig,
  next: MorrowConfig,
): Promise<void> {
  await deleteBlockData(blockDataToDrop(previous, next, resolveBlockSource));
}

/** Record a failed fetch without discarding the last good data. */
async function writeBlockError(
  blockIds: string[],
  previous: BlockData | undefined,
  error: string,
) {
  return writeBlockData(blockIds, previous?.data ?? null, error);
}

async function fetchJson(url: string): Promise<unknown> {
  if (!isAllowedSourceUrl(url))
    throw new Error('URL is not a public https address.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      // Public data APIs such as MET Norway require an identifying User-Agent.
      headers: { accept: 'application/json', 'user-agent': SOURCE_USER_AGENT },
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error('Redirects are not followed; use the final URL.');
    }
    if (!response.ok) throw new Error(`Source answered ${response.status}.`);
    const text = await readBodyWithLimit(response);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error('Response is not JSON.');
    }
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw new Error('Source did not answer within 8 seconds.');
    }
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}

/** Let the plugin's server module fetch with its own credentials. */
async function fetchViaPlugin(
  block: GlanceBlock,
  config: MorrowConfig,
): Promise<unknown> {
  const server = pluginServers[block.plugin];
  if (!server) throw new Error('This plugin has no server module.');
  return server.fetch(block.settings ?? {}, {
    view: block.view,
    env: process.env,
    timeZone: config.timeZone,
    now: new Date(),
    secrets: await readSecretValues(block.id),
  });
}

// One refresh per block per isolate at a time, so a burst of Players does not
// fan out into duplicate fetches.
const inFlight = new Map<string, Promise<BlockData>>();

/**
 * What a block's data is fetched from, at the granularity a fetch happens.
 * Blocks that agree on this want the same bytes: a plugin can say that several
 * of its views share one fetch, and otherwise views are kept apart.
 */
function fetchKey(block: GlanceBlock): string {
  const source = resolveBlockSource(block);
  const base = sourceKey(source, block.settings ?? {}, block.plugin);
  if (!source || base === null) return `block:${block.id}`;
  if (source.kind !== 'plugin') return base;
  const server = pluginServers[block.plugin];
  const view =
    server?.dataKey?.(block.settings ?? {}, block.view) ?? block.view;
  return `${base}|${view}`;
}

/**
 * Fetch once and store the result against every block that shares the fetch,
 * so putting three views of one repository on a page costs one call, not
 * three.
 */
function refresh(
  block: GlanceBlock,
  previous: BlockData | undefined,
  config: MorrowConfig,
  shareWith: string[] = [block.id],
): Promise<BlockData> {
  const source = resolveBlockSource(block);
  if (!source || source.kind === 'webhook')
    return Promise.resolve(previous ?? emptyData());
  const key = fetchKey(block);
  const running = inFlight.get(key);
  if (running) return running;
  const fetched =
    source.kind === 'poll'
      ? fetchJson(source.url)
      : fetchViaPlugin(block, config);
  const task = fetched
    .then((data) => writeBlockData(shareWith, data))
    .catch((cause: unknown) =>
      writeBlockError(
        shareWith,
        previous,
        cause instanceof Error ? cause.message : 'Fetch failed.',
      ),
    )
    .finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}

/**
 * Data for every block with a source. Stale poll sources with existing data
 * refresh in the background and return what is stored; sources that have
 * never produced data are fetched before answering, so the first paint is not
 * empty. Blocks with nothing stored are included with nulls so views can show
 * a waiting state.
 */
export async function loadBlockData(
  config: MorrowConfig,
): Promise<Record<string, BlockData>> {
  const blocks = blocksWithSources(config, resolveBlockSource);
  const stored = await readBlockData(blocks.map((block) => block.id));

  // Blocks that fetch the same thing are refreshed together, so three views of
  // one repository cost one call rather than three.
  const groups = new Map<string, GlanceBlock[]>();
  for (const block of blocks) {
    const key = fetchKey(block);
    groups.set(key, [...(groups.get(key) ?? []), block]);
  }

  const results: Array<readonly [string, BlockData]> = [];
  await Promise.all(
    [...groups.values()].map(async (group) => {
      const lead = group[0];
      if (!lead) return;
      const ids = group.map((block) => block.id);
      const keep = (data: BlockData) => {
        for (const id of ids) results.push([id, stored[id] ?? data] as const);
      };
      const source = resolveBlockSource(lead);
      if (!source || source.kind === 'webhook') {
        keep(emptyData());
        return;
      }
      // Judge staleness on the freshest of the group: one of them having
      // fetched recently means the shared data is recent.
      const previous = ids
        .map((id) => stored[id])
        .filter((data): data is BlockData => data !== undefined)
        .sort((a, b) =>
          (b.fetchedAt ?? '').localeCompare(a.fetchedAt ?? ''),
        )[0];
      const stale = isStale(
        source,
        previous?.fetchedAt ?? null,
        Date.now(),
        Boolean(previous?.error),
      );
      if (!stale) {
        keep(previous ?? emptyData());
        return;
      }
      if (previous?.fetchedAt) {
        runInBackground(await database(), refresh(lead, previous, config, ids));
        keep(previous);
        return;
      }
      const data = await refresh(lead, previous, config, ids);
      for (const id of ids) results.push([id, data] as const);
    }),
  );

  return Object.fromEntries(results);
}
