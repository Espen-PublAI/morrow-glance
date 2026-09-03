import { env } from 'cloudflare:workers';

import { schemaStatements } from '@/db/schema';

/** Shared D1 access: the binding and a once-per-isolate schema bootstrap. */

interface MorrowBindings {
  DB?: D1Database;
}

export function database(): D1Database {
  const db = (env as unknown as MorrowBindings).DB;
  if (!db) {
    throw new Error(
      'The D1 binding "DB" is missing. Check wrangler configuration and .openai/hosting.json.',
    );
  }
  return db;
}

// `CREATE TABLE IF NOT EXISTS` is cheap but not free; run it once per isolate.
let schemaReady: Promise<void> | undefined;

export function ensureSchema(db: D1Database): Promise<void> {
  schemaReady ??= db
    .batch(schemaStatements.map((statement) => db.prepare(statement)))
    .then(() => undefined)
    .catch((error: unknown) => {
      schemaReady = undefined;
      throw error;
    });
  return schemaReady;
}
