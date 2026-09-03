import type {
  BlockDataSource,
  GlanceBlock,
  MorrowConfig,
} from '@/lib/morrow/types';

/**
 * Rules for block data sources. Pure functions; the fetching itself lives in
 * `db/block-data.ts` and the API routes.
 */

/** Largest JSON body accepted from a poll response or a webhook, in bytes. */
export const MAX_DATA_BYTES = 64 * 1024;

/** How long a poll request may take before it is abandoned. */
export const POLL_TIMEOUT_MS = 8_000;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
]);
const BLOCKED_SUFFIXES = [
  '.local',
  '.internal',
  '.localhost',
  '.lan',
  '.home.arpa',
];

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  ) {
    return false;
  }
  const [a = 0, b = 0] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isPrivateIpv6(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    bare === '::1' ||
    bare === '::' ||
    bare.startsWith('fc') ||
    bare.startsWith('fd') ||
    bare.startsWith('fe80') ||
    bare.startsWith('::ffff:')
  );
}

/**
 * Whether Morrow Server may fetch this URL. Public HTTPS only: loopback, link
 * local, private ranges, and internal-looking names are refused so a poll
 * source cannot be pointed at the network the server runs in. Hostname checks
 * cannot stop DNS rebinding; on Cloudflare Workers egress leaves from
 * Cloudflare, which is the primary protection. Self-hosters should run the
 * server in a network segment without sensitive neighbours.
 */
export function isAllowedSourceUrl(input: string): boolean {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) return false;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  if (!host.includes('.') && !host.includes(':')) return false;
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) return false;
  return true;
}

/** How soon a failed poll is retried, regardless of the configured interval. */
export const RETRY_AFTER_ERROR_SECONDS = 60;

/**
 * True when a poll source has never been fetched or its interval has elapsed.
 * After a failed fetch the wait is the shorter of the interval and one minute,
 * so a transient outage does not blank a screen for an hour.
 */
export function isStale(
  source: Extract<BlockDataSource, { kind: 'poll' }>,
  fetchedAt: string | null,
  now = Date.now(),
  hadError = false,
): boolean {
  if (!fetchedAt) return true;
  const last = Date.parse(fetchedAt);
  if (!Number.isFinite(last)) return true;
  const waitSeconds = hadError
    ? Math.min(source.intervalSeconds, RETRY_AFTER_ERROR_SECONDS)
    : source.intervalSeconds;
  return now - last >= waitSeconds * 1000;
}

/**
 * Read a response body without letting it grow past `max` bytes. The body is
 * streamed and the connection is cancelled as soon as the cap is exceeded, so a
 * broken or hostile source cannot push megabytes through the server.
 */
export async function readBodyWithLimit(
  response: Response,
  max = MAX_DATA_BYTES,
): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    await response.body?.cancel();
    throw new Error(`Response is larger than ${Math.round(max / 1024)} KB.`);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > max) {
      await reader.cancel();
      throw new Error(`Response is larger than ${Math.round(max / 1024)} KB.`);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/**
 * Identity of a block's source. When it changes, stored data belongs to the
 * old source and must not be shown against the new one.
 */
export function sourceKey(source: BlockDataSource | undefined): string | null {
  if (!source) return null;
  return source.kind === 'webhook' ? 'webhook' : `poll:${source.url}`;
}

/**
 * Block ids whose stored data should be dropped when moving from one
 * configuration to the next: blocks that disappeared or changed source.
 */
export function blockDataToDrop(
  previous: MorrowConfig,
  next: MorrowConfig,
): string[] {
  const nextKeys = new Map(
    blocksWithSources(next).map(
      (block) => [block.id, sourceKey(block.data)] as const,
    ),
  );
  return blocksWithSources(previous)
    .filter((block) => nextKeys.get(block.id) !== sourceKey(block.data))
    .map((block) => block.id);
}

/** Every block in the configuration that has a data source, across all pages. */
export function blocksWithSources(config: MorrowConfig): GlanceBlock[] {
  return config.pages.flatMap((page) =>
    page.blocks.filter((block) => block.data),
  );
}

/**
 * Read a dotted path such as `main.temp` or `items[0].name` from JSON data.
 * Returns undefined when any step is missing. Used by views to pick a value.
 */
export function readPath(data: unknown, path: string): unknown {
  if (!path.trim()) return data;
  const steps = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let current: unknown = data;
  for (const step of steps) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(step);
      current = Number.isInteger(index) ? current[index] : undefined;
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[step];
    } else {
      return undefined;
    }
  }
  return current;
}

/** Turn a JSON value into something a view can print. */
export function formatValue(value: unknown, fractionDigits = 1): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? String(value)
      : value.toFixed(fractionDigits).replace(/\.?0+$/, '');
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
