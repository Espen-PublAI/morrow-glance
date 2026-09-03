import { database, ensureSchema } from '@/db/schema-runtime';

/**
 * Per-block secrets: values a plugin needs on the server that must never be
 * part of the public configuration, such as a published calendar link.
 * Written by Admin through the secrets API, read only by plugin server modules.
 * Admin can see which names are set, never the values.
 */

const SECRET_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/;
export const MAX_SECRET_BYTES = 4096;

export function isValidSecretName(name: string): boolean {
  return SECRET_NAME.test(name);
}

export async function readSecretNames(blockId: string): Promise<string[]> {
  const db = database();
  await ensureSchema(db);
  const { results } = await db
    .prepare('SELECT name FROM morrow_block_secrets WHERE block_id = ?')
    .bind(blockId)
    .all<{ name: string }>();
  return results.map((row) => row.name).sort();
}

/** Server-internal: the values for one block, keyed by name. */
export async function readSecretValues(
  blockId: string,
): Promise<Record<string, string>> {
  const db = database();
  await ensureSchema(db);
  const { results } = await db
    .prepare('SELECT name, value FROM morrow_block_secrets WHERE block_id = ?')
    .bind(blockId)
    .all<{ name: string; value: string }>();
  return Object.fromEntries(results.map((row) => [row.name, row.value]));
}

export async function writeSecret(
  blockId: string,
  name: string,
  value: string,
): Promise<void> {
  const db = database();
  await ensureSchema(db);
  await db
    .prepare(
      `INSERT INTO morrow_block_secrets (block_id, name, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(block_id, name) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
    )
    .bind(blockId, name, value, new Date().toISOString())
    .run();
}

export async function deleteSecret(
  blockId: string,
  name: string,
): Promise<void> {
  const db = database();
  await ensureSchema(db);
  await db
    .prepare('DELETE FROM morrow_block_secrets WHERE block_id = ? AND name = ?')
    .bind(blockId, name)
    .run();
}

/** After a configuration save: forget secrets of blocks that no longer exist. */
export async function pruneSecrets(keepBlockIds: string[]): Promise<void> {
  const db = database();
  await ensureSchema(db);
  const keep = new Set(keepBlockIds);
  const { results } = await db
    .prepare('SELECT DISTINCT block_id FROM morrow_block_secrets')
    .all<{ block_id: string }>();
  const stale = results
    .map((row) => row.block_id)
    .filter((id) => !keep.has(id));
  if (stale.length === 0) return;
  const statement = db.prepare(
    'DELETE FROM morrow_block_secrets WHERE block_id = ?',
  );
  for (let i = 0; i < stale.length; i += 50) {
    await db.batch(stale.slice(i, i + 50).map((id) => statement.bind(id)));
  }
}
