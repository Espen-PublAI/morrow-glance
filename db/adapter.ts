/**
 * The database surface Morrow needs, and nothing more: prepared statements
 * with positional parameters, plus a batch for grouped writes. Two adapters
 * implement it, Cloudflare D1 and Node with SQLite, so the rest of `db/` is
 * the same code on either runtime.
 */

export type SqlValue = string | number | null;

export interface BoundStatement {
  /** Number of rows changed, used to detect a lost race on a conditional write. */
  run(): Promise<{ changes: number }>;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<T[]>;
}

export interface Statement extends BoundStatement {
  bind(...values: SqlValue[]): BoundStatement;
}

export interface MorrowDatabase {
  prepare(sql: string): Statement;
  /**
   * Run statements as one unit. Atomic where the driver supports it, in order
   * otherwise. Statements must come from this database's `prepare`.
   */
  batch(statements: BoundStatement[]): Promise<void>;
  /**
   * Keep work alive past the current response, where the runtime requires it.
   * Absent on a long-lived server, where a detached promise simply continues.
   */
  runInBackground?: (task: Promise<unknown>) => void;
  /** For diagnostics and the README's deployment section. */
  readonly kind: 'd1' | 'sqlite';
}
