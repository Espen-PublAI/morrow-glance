import { describe, expect, it } from 'vitest';

import type { MorrowDatabase } from '@/db/adapter';
import { openSqlite } from '@/db/adapters/sqlite';
import { schemaStatements } from '@/db/schema';

/**
 * The adapter is the one place where self-hosting and Cloudflare could drift,
 * so it is tested against the real schema and the exact call shapes `db/` uses.
 */

async function freshDatabase(): Promise<MorrowDatabase> {
  const db = openSqlite(':memory:');
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
  return db;
}

describe('sqlite adapter', () => {
  it('applies the schema and reports its kind', async () => {
    const db = await freshDatabase();
    expect(db.kind).toBe('sqlite');
    const tables = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all<{ name: string }>();
    expect(tables.map((row) => row.name)).toEqual([
      'morrow_block_data',
      'morrow_block_secrets',
      'morrow_config',
    ]);
  });

  it('is idempotent when the schema is applied twice', async () => {
    const db = await freshDatabase();
    await expect(
      db.batch(schemaStatements.map((statement) => db.prepare(statement))),
    ).resolves.toBeUndefined();
  });

  it('upserts and reads a row back', async () => {
    const db = await freshDatabase();
    const upsert = db.prepare(
      `INSERT INTO morrow_config (id, config_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         config_json = excluded.config_json,
         updated_at = excluded.updated_at`,
    );
    expect((await upsert.bind('default', '{"a":1}', 't0').run()).changes).toBe(
      1,
    );
    expect((await upsert.bind('default', '{"a":2}', 't1').run()).changes).toBe(
      1,
    );
    const row = await db
      .prepare('SELECT config_json, updated_at FROM morrow_config WHERE id = ?')
      .bind('default')
      .first<{ config_json: string; updated_at: string }>();
    expect(row).toEqual({ config_json: '{"a":2}', updated_at: 't1' });
  });

  it('reports zero changes when a conditional write loses the race', async () => {
    const db = await freshDatabase();
    await db
      .prepare(
        'INSERT INTO morrow_config (id, config_json, updated_at) VALUES (?, ?, ?)',
      )
      .bind('default', '{}', 't1')
      .run();
    const update = db.prepare(
      'UPDATE morrow_config SET config_json = ?, updated_at = ? WHERE id = ? AND updated_at = ?',
    );
    expect(
      (await update.bind('{"n":1}', 't2', 'default', 'STALE').run()).changes,
    ).toBe(0);
    expect(
      (await update.bind('{"n":1}', 't2', 'default', 't1').run()).changes,
    ).toBe(1);
  });

  it('returns null for a missing row and an empty array for no rows', async () => {
    const db = await freshDatabase();
    expect(
      await db
        .prepare('SELECT * FROM morrow_config WHERE id = ?')
        .bind('nope')
        .first(),
    ).toBeNull();
    expect(await db.prepare('SELECT * FROM morrow_config').all()).toEqual([]);
  });

  it('stores null in a nullable column and reads it back', async () => {
    const db = await freshDatabase();
    await db
      .prepare(
        'INSERT INTO morrow_block_data (block_id, data_json, fetched_at, error) VALUES (?, ?, ?, ?)',
      )
      .bind('b1', 'null', 't0', null)
      .run();
    const row = await db
      .prepare('SELECT error FROM morrow_block_data WHERE block_id = ?')
      .bind('b1')
      .first<{ error: string | null }>();
    expect(row?.error).toBeNull();
  });

  it('applies a batch atomically and rolls back on failure', async () => {
    const db = await freshDatabase();
    const insert = db.prepare(
      'INSERT INTO morrow_block_secrets (block_id, name, value, updated_at) VALUES (?, ?, ?, ?)',
    );
    await db.batch([
      insert.bind('b1', 'icsUrl', 'https://example.org/a.ics', 't0'),
      insert.bind('b2', 'icsUrl', 'https://example.org/b.ics', 't0'),
    ]);
    expect(
      (await db.prepare('SELECT block_id FROM morrow_block_secrets').all())
        .length,
    ).toBe(2);

    // The second statement violates the primary key, so neither should land.
    await expect(
      db.batch([
        insert.bind('b3', 'icsUrl', 'https://example.org/c.ics', 't1'),
        insert.bind('b1', 'icsUrl', 'duplicate', 't1'),
      ]),
    ).rejects.toThrow();
    const rows = await db
      .prepare('SELECT block_id FROM morrow_block_secrets ORDER BY block_id')
      .all<{
        block_id: string;
      }>();
    expect(rows.map((row) => row.block_id)).toEqual(['b1', 'b2']);
  });

  it('returns plain objects, so spreading and JSON round-trips work', async () => {
    const db = await freshDatabase();
    await db
      .prepare(
        'INSERT INTO morrow_config (id, config_json, updated_at) VALUES (?, ?, ?)',
      )
      .bind('default', '{}', 't0')
      .run();
    const row = await db
      .prepare('SELECT * FROM morrow_config')
      .first<Record<string, unknown>>();
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    expect({ ...row }).toMatchObject({ id: 'default' });
  });

  it('leaves background work to the runtime when it has no hook', async () => {
    const db = await freshDatabase();
    expect(db.runInBackground).toBeUndefined();
  });
});
