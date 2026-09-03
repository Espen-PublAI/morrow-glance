import { database, ensureSchema } from '@/db/schema-runtime';
import { parseMorrowConfig } from '@/lib/morrow/config';
import type { MorrowConfig } from '@/lib/morrow/types';
import { morrowConfig } from '@/morrow.config';

/** Morrow Server persistence: one configuration row in Cloudflare D1. */

const CONFIG_ROW_ID = 'default';

/** A configuration together with the version stamp used for conflict checks. */
export interface StoredConfig {
  config: MorrowConfig;
  /** ISO timestamp of the last save, or null when nothing has been saved yet. */
  updatedAt: string | null;
}

export type SaveResult =
  | { status: 'saved'; stored: StoredConfig }
  | { status: 'conflict' };

export async function loadMorrowConfig(): Promise<StoredConfig> {
  const db = database();
  await ensureSchema(db);
  const row = await db
    .prepare('SELECT config_json, updated_at FROM morrow_config WHERE id = ?')
    .bind(CONFIG_ROW_ID)
    .first<{ config_json: string; updated_at: string }>();

  if (!row) return { config: morrowConfig, updatedAt: null };
  try {
    return {
      config: parseMorrowConfig(JSON.parse(row.config_json)),
      updatedAt: row.updated_at,
    };
  } catch (error) {
    console.warn(
      'Stored Morrow configuration is invalid; serving the fallback.',
      error,
    );
    return { config: morrowConfig, updatedAt: row.updated_at };
  }
}

/** For server-rendered pages: never fail the page because storage is down. */
export async function loadMorrowConfigOrFallback(): Promise<StoredConfig> {
  try {
    return await loadMorrowConfig();
  } catch (error) {
    console.error(
      'Could not load Morrow configuration; rendering the fallback.',
      error,
    );
    return { config: morrowConfig, updatedAt: null };
  }
}

export async function getMorrowConfig(): Promise<MorrowConfig> {
  return (await loadMorrowConfig()).config;
}

/**
 * Save the configuration. When `expectedUpdatedAt` is given, the write only
 * succeeds if the stored row still carries that stamp, so two admins cannot
 * silently overwrite each other. The check and the write are one statement.
 */
export async function saveMorrowConfig(
  config: MorrowConfig,
  expectedUpdatedAt?: string | null,
): Promise<SaveResult> {
  const validConfig = parseMorrowConfig(config);
  const db = database();
  await ensureSchema(db);
  const now = new Date().toISOString();
  const json = JSON.stringify(validConfig);

  if (expectedUpdatedAt) {
    const result = await db
      .prepare(
        'UPDATE morrow_config SET config_json = ?, updated_at = ? WHERE id = ? AND updated_at = ?',
      )
      .bind(json, now, CONFIG_ROW_ID, expectedUpdatedAt)
      .run();
    if ((result.meta.changes ?? 0) === 0) return { status: 'conflict' };
    return { status: 'saved', stored: { config: validConfig, updatedAt: now } };
  }

  await db
    .prepare(
      `INSERT INTO morrow_config (id, config_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         config_json = excluded.config_json,
         updated_at = excluded.updated_at`,
    )
    .bind(CONFIG_ROW_ID, json, now)
    .run();

  return { status: 'saved', stored: { config: validConfig, updatedAt: now } };
}
