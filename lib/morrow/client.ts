import { BUILD_HEADER, createBuildTracker } from '@/lib/morrow/build';
import { parseMorrowConfig } from '@/lib/morrow/config';
import type { BlockData, MorrowConfig } from '@/lib/morrow/types';
import { morrowConfig } from '@/morrow.config';

/**
 * Browser-side access to the configuration: the Morrow Server API plus a
 * localStorage copy that keeps a screen useful while the server is away.
 */

export const MORROW_CONFIG_KEY = 'morrow.config.v1';
export const MORROW_CONFIG_EVENT = 'morrow:config-changed';
export const MORROW_ADMIN_TOKEN_KEY = 'morrow.admin-token';
const MORROW_LAST_RELOAD_KEY = 'morrow.last-reload';
const UPDATED_AT_HEADER = 'x-morrow-updated-at';

/** Minimum gap between self-reloads, so a bad rollout cannot make a screen loop. */
export const RELOAD_COOLDOWN_MS = 10 * 60 * 1000;

export function readStoredMorrowConfig(): MorrowConfig {
  if (typeof window === 'undefined') return morrowConfig;
  try {
    const stored = window.localStorage.getItem(MORROW_CONFIG_KEY);
    return stored ? parseMorrowConfig(JSON.parse(stored)) : morrowConfig;
  } catch {
    return morrowConfig;
  }
}

/** Keep a local copy without telling other tabs; used by the Player on every poll. */
export function cacheMorrowConfig(config: MorrowConfig): void {
  try {
    window.localStorage.setItem(MORROW_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Storage may be full or disabled; the server copy is authoritative.
  }
}

/** Store and announce a change; used by Admin after a successful save. */
export function writeStoredMorrowConfig(config: MorrowConfig): void {
  cacheMorrowConfig(config);
  try {
    window.dispatchEvent(new CustomEvent(MORROW_CONFIG_EVENT));
  } catch {
    // Announcing is best effort.
  }
}

export function readStoredAdminToken(): string {
  try {
    return window.sessionStorage.getItem(MORROW_ADMIN_TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeStoredAdminToken(token: string): void {
  try {
    if (token) window.sessionStorage.setItem(MORROW_ADMIN_TOKEN_KEY, token);
    else window.sessionStorage.removeItem(MORROW_ADMIN_TOKEN_KEY);
  } catch {
    // Session storage is a convenience only.
  }
}

async function errorMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error) return body.error;
  } catch {
    // Non-JSON error body.
  }
  return fallback;
}

export class SaveConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveConflictError';
  }
}

const buildTracker = createBuildTracker();

/**
 * Whether the page may reload itself now. Reloads are rate limited per tab so
 * a misbehaving deploy can never turn a wall screen into a reload loop.
 */
export function reloadAllowed(now = Date.now()): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(MORROW_LAST_RELOAD_KEY));
    if (Number.isFinite(last) && now - last < RELOAD_COOLDOWN_MS) return false;
    window.sessionStorage.setItem(MORROW_LAST_RELOAD_KEY, String(now));
    return true;
  } catch {
    return true;
  }
}

export interface RemoteConfigResult {
  config: MorrowConfig;
  /** Version stamp to send back as `If-Match` when saving. */
  updatedAt: string | null;
  /** The server build has changed and stayed changed; this page's assets are stale. */
  staleClient: boolean;
}

export async function fetchRemoteMorrowConfig(): Promise<RemoteConfigResult> {
  const response = await fetch('/api/config', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(
      await errorMessage(
        response,
        'Could not load Morrow Server configuration.',
      ),
    );
  }
  return {
    config: parseMorrowConfig(await response.json()),
    updatedAt: response.headers.get(UPDATED_AT_HEADER),
    staleClient: buildTracker.observe(response.headers.get(BUILD_HEADER)),
  };
}

export async function readRemoteMorrowConfig(): Promise<MorrowConfig> {
  return (await fetchRemoteMorrowConfig()).config;
}

export async function writeRemoteMorrowConfig(
  config: MorrowConfig,
  adminToken = '',
  expectedUpdatedAt: string | null = null,
): Promise<RemoteConfigResult> {
  const response = await fetch('/api/config', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
      ...(expectedUpdatedAt ? { 'if-match': expectedUpdatedAt } : {}),
    },
    body: JSON.stringify(parseMorrowConfig(config)),
  });
  if (response.status === 409) {
    throw new SaveConflictError(
      await errorMessage(
        response,
        'Someone else saved changes since you loaded this page.',
      ),
    );
  }
  if (!response.ok) {
    throw new Error(
      await errorMessage(response, 'Could not save to Morrow Server.'),
    );
  }
  return {
    config: parseMorrowConfig(await response.json()),
    updatedAt: response.headers.get(UPDATED_AT_HEADER),
    staleClient: false,
  };
}

/** Latest data for every block with a source, keyed by block id. */
export async function fetchBlockData(): Promise<Record<string, BlockData>> {
  const response = await fetch('/api/data', { cache: 'no-store' });
  if (!response.ok)
    throw new Error(await errorMessage(response, 'Could not load block data.'));
  const body = (await response.json()) as unknown;
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    return {};
  return body as Record<string, BlockData>;
}
