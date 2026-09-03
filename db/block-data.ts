import { waitUntil } from 'cloudflare:workers';

import { database, ensureSchema } from '@/db/schema-runtime';
import { resolveBlockSource } from '@/lib/morrow/block-source';
import { pluginServers } from '@/plugins/server';
import {
  POLL_TIMEOUT_MS,
  blockDataToDrop,
  blocksWithSources,
  isAllowedSourceUrl,
  isStale,
  readBodyWithLimit,
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
  const db = database();
  await ensureSchema(db);
  const { results } = await db
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

export async function writeBlockData(
  blockId: string,
  data: unknown,
  error: string | null = null,
): Promise<BlockData> {
  const db = database();
  await ensureSchema(db);
  const fetchedAt = new Date().toISOString();
  const json = JSON.stringify(data ?? null);
  await db
    .prepare(
      `INSERT INTO morrow_block_data (block_id, data_json, fetched_at, error)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(block_id) DO UPDATE SET
         data_json = excluded.data_json,
         fetched_at = excluded.fetched_at,
         error = excluded.error`,
    )
    .bind(blockId, json, fetchedAt, error)
    .run();
  return { data, fetchedAt, error };
}

/** Delete stored data for the given blocks, in small batches. */
export async function deleteBlockData(blockIds: string[]): Promise<void> {
  if (blockIds.length === 0) return;
  const db = database();
  await ensureSchema(db);
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
  blockId: string,
  previous: BlockData | undefined,
  error: string,
) {
  return writeBlockData(blockId, previous?.data ?? null, error);
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
    env: process.env,
    timeZone: config.timeZone,
    now: new Date(),
  });
}

// One refresh per block per isolate at a time, so a burst of Players does not
// fan out into duplicate fetches.
const inFlight = new Map<string, Promise<BlockData>>();

function refresh(
  block: GlanceBlock,
  previous: BlockData | undefined,
  config: MorrowConfig,
): Promise<BlockData> {
  const source = resolveBlockSource(block);
  if (!source || source.kind === 'webhook')
    return Promise.resolve(previous ?? emptyData());
  const running = inFlight.get(block.id);
  if (running) return running;
  const fetched =
    source.kind === 'poll'
      ? fetchJson(source.url)
      : fetchViaPlugin(block, config);
  const task = fetched
    .then((data) => writeBlockData(block.id, data))
    .catch((cause: unknown) =>
      writeBlockError(
        block.id,
        previous,
        cause instanceof Error ? cause.message : 'Fetch failed.',
      ),
    )
    .finally(() => inFlight.delete(block.id));
  inFlight.set(block.id, task);
  return task;
}

/** Keep a refresh alive past the response when the runtime allows it. */
function inBackground(task: Promise<unknown>): void {
  try {
    waitUntil(task);
  } catch {
    // Outside a request context (tests, scripts): let it run detached.
    void task;
  }
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

  const results = await Promise.all(
    blocks.map(async (block) => {
      const previous = stored[block.id];
      const source = resolveBlockSource(block);
      if (!source || source.kind === 'webhook')
        return [block.id, previous ?? emptyData()] as const;

      const stale = isStale(
        source,
        previous?.fetchedAt ?? null,
        Date.now(),
        Boolean(previous?.error),
      );
      if (!stale) return [block.id, previous ?? emptyData()] as const;
      if (previous?.fetchedAt) {
        inBackground(refresh(block, previous, config));
        return [block.id, previous] as const;
      }
      return [block.id, await refresh(block, previous, config)] as const;
    }),
  );

  return Object.fromEntries(results);
}
