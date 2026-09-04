import type { MorrowDatabase } from '@/db/adapter';
import { schemaStatements } from '@/db/schema';

/**
 * Opens the right database for the runtime and applies the schema once.
 *
 * Cloudflare Workers get D1 through the `DB` binding; anywhere else gets
 * SQLite on Node. The adapters are loaded on demand so neither runtime has to
 * resolve the other's imports.
 */

function onWorkers(): boolean {
  const agent = (globalThis as { navigator?: { userAgent?: string } }).navigator
    ?.userAgent;
  return agent === 'Cloudflare-Workers';
}

let opening: Promise<MorrowDatabase> | undefined;

async function open(): Promise<MorrowDatabase> {
  const db = onWorkers()
    ? (await import('@/db/adapters/d1')).openD1()
    : (await import('@/db/adapters/sqlite')).openSqlite();
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
  return db;
}

/** The database, opened and migrated on first use. */
export function database(): Promise<MorrowDatabase> {
  opening ??= open().catch((error: unknown) => {
    opening = undefined;
    throw error;
  });
  return opening;
}

/**
 * Run a task that may outlive the response. Workers need to be told; a
 * long-lived server does not, so the promise simply continues there.
 */
export function runInBackground(
  db: MorrowDatabase,
  task: Promise<unknown>,
): void {
  if (db.runInBackground) db.runInBackground(task);
  else void task;
}
