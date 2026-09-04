import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `lib/morrow` is the leaf of the project: contracts and pure functions that
 * depend on nothing else here. That is what lets it be tested without a
 * database, a browser, or the plugin registry, and it is easy to lose by
 * accident, so it is asserted rather than merely documented.
 */

const LIB = join(process.cwd(), 'lib/morrow');
const FORBIDDEN = ['@/plugins', '@/db', '@/components', '@/app'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === '__tests__' ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

describe('lib/morrow stays a leaf', () => {
  const files = sourceFiles(LIB);

  it('finds the library to check', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(FORBIDDEN)('imports nothing from %s', (prefix) => {
    const offenders = files.filter((file) =>
      readFileSync(file, 'utf8').includes(`from '${prefix}`),
    );
    expect(
      offenders.map((file) => file.replace(`${process.cwd()}/`, '')),
    ).toEqual([]);
  });

  it('imports morrow.config.ts only where a fallback is genuinely needed', () => {
    // The clean-install fallback is the one exception, and only the browser
    // client needs it, for when the server cannot be reached.
    const offenders = files
      .filter((file) =>
        readFileSync(file, 'utf8').includes("from '@/morrow.config'"),
      )
      .map((file) => file.replace(`${LIB}/`, ''));
    expect(offenders.sort()).toEqual(['client.ts']);
  });
});
