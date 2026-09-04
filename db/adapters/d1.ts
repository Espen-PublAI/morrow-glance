import { env, waitUntil } from 'cloudflare:workers';

import type {
  BoundStatement,
  MorrowDatabase,
  SqlValue,
  Statement,
} from '@/db/adapter';

/**
 * Cloudflare D1. Its API is already the shape the adapter describes, so this
 * is a thin translation: `all` unwraps `{ results }` and `run` unwraps
 * `{ meta: { changes } }`.
 */

interface MorrowBindings {
  DB?: D1Database;
}

/** The prepared statement behind each wrapper, so `batch` can reach it. */
const native = new WeakMap<BoundStatement, D1PreparedStatement>();

function wrap(statement: D1PreparedStatement): Statement {
  const wrapped: Statement = {
    bind: (...values: SqlValue[]) => wrap(statement.bind(...values)),
    async run() {
      const result = await statement.run();
      return { changes: result.meta.changes ?? 0 };
    },
    first<T>() {
      return statement.first<T>();
    },
    async all<T>() {
      const { results } = await statement.all<T>();
      return results;
    },
  };
  native.set(wrapped, statement);
  return wrapped;
}

export function openD1(): MorrowDatabase {
  const db = (env as unknown as MorrowBindings).DB;
  if (!db) {
    throw new Error(
      'The D1 binding "DB" is missing. Check wrangler configuration and .openai/hosting.json.',
    );
  }

  return {
    kind: 'd1',
    prepare: (sql) => wrap(db.prepare(sql)),
    async batch(statements) {
      const prepared = statements
        .map((statement) => native.get(statement))
        .filter(
          (statement): statement is D1PreparedStatement =>
            statement !== undefined,
        );
      if (prepared.length > 0) await db.batch(prepared);
    },
    runInBackground: (task) => {
      waitUntil(task);
    },
  };
}
