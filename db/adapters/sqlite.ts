import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type {
  BoundStatement,
  MorrowDatabase,
  SqlValue,
  Statement,
} from '@/db/adapter';

/**
 * SQLite on Node, for self-hosting. Uses the runtime's own SQLite, so there is
 * nothing to compile and no dependency to keep current. The driver is
 * synchronous underneath; the adapter presents the same promise-based surface
 * as D1 so callers cannot tell the two apart.
 */

/** Where the database file lives. Point `MORROW_SQLITE_PATH` at a volume. */
export const DEFAULT_SQLITE_PATH = './data/morrow.db';

type Row = Record<string, unknown>;

/** D1 tolerates undefined; node:sqlite refuses it. */
function bindable(values: SqlValue[]): SqlValue[] {
  return values.map((value) => value ?? null);
}

/** Rows arrive with a null prototype; hand back ordinary objects. */
function plain<T>(row: unknown): T {
  return { ...(row as Row) } as T;
}

export function openSqlite(
  path = process.env.MORROW_SQLITE_PATH || DEFAULT_SQLITE_PATH,
): MorrowDatabase {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // Write-ahead logging lets a reading Player and a saving Admin overlap.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');

  /** Each statement carries its SQL and parameters so `batch` can replay it. */
  const parts = new WeakMap<
    BoundStatement,
    { sql: string; params: SqlValue[] }
  >();

  const wrap = (sql: string, params: SqlValue[]): Statement => {
    const statement: Statement = {
      bind: (...values: SqlValue[]) => wrap(sql, values),
      async run() {
        const { changes } = db.prepare(sql).run(...bindable(params));
        return { changes: Number(changes) };
      },
      async first<T>() {
        const row = db.prepare(sql).get(...bindable(params));
        return row === undefined ? null : plain<T>(row);
      },
      async all<T>() {
        return db
          .prepare(sql)
          .all(...bindable(params))
          .map((row) => plain<T>(row));
      },
    };
    parts.set(statement, { sql, params });
    return statement;
  };

  return {
    kind: 'sqlite',
    prepare: (sql) => wrap(sql, []),
    async batch(statements) {
      const work = statements
        .map((statement) => parts.get(statement))
        .filter(
          (part): part is { sql: string; params: SqlValue[] } =>
            part !== undefined,
        );
      if (work.length === 0) return;
      db.exec('BEGIN');
      try {
        for (const { sql, params } of work)
          db.prepare(sql).run(...bindable(params));
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
