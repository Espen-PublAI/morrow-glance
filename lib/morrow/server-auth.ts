/**
 * Access checks for API routes.
 *
 * Admin writes require `MORROW_ADMIN_TOKEN` as a Bearer token. In development,
 * requests addressed to localhost may write without a token so a fresh
 * checkout is usable immediately. In production a missing token disables
 * writes outright: the hostname comes from the `Host` header, which a proxy
 * may forward, so "is this localhost" is not a safe production check.
 */

type Env = Record<string, string | undefined>;

export type WriteAuthorization =
  | { ok: true }
  | { ok: false; status: 401 | 503; message: string };

function bearerToken(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  return header.replace(/^Bearer\s+/i, '').trim();
}

/** Compare secrets without leaking their length or prefix through timing. */
export function secretsMatch(supplied: string, expected: string): boolean {
  const a = new TextEncoder().encode(supplied);
  const b = new TextEncoder().encode(expected);
  let mismatch = a.length === b.length ? 0 : 1;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return mismatch === 0;
}

export function isLocalRequest(request: Request): boolean {
  const { hostname } = new URL(request.url);
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  );
}

export function authorizeConfigWrite(
  request: Request,
  env: Env = process.env,
): WriteAuthorization {
  const expected = env.MORROW_ADMIN_TOKEN?.trim();
  if (expected) {
    return secretsMatch(bearerToken(request), expected)
      ? { ok: true }
      : { ok: false, status: 401, message: 'Admin authorization is required.' };
  }
  if (env.NODE_ENV === 'production') {
    return {
      ok: false,
      status: 503,
      message:
        'Saving is disabled until MORROW_ADMIN_TOKEN is configured on the server.',
    };
  }
  return isLocalRequest(request)
    ? { ok: true }
    : { ok: false, status: 401, message: 'Admin authorization is required.' };
}

/** Convenience for callers that only need yes/no. */
export function canWriteConfiguration(
  request: Request,
  env: Env = process.env,
): boolean {
  return authorizeConfigWrite(request, env).ok;
}

/**
 * Webhook deliveries authenticate with `MORROW_WEBHOOK_TOKEN`, sent as a
 * Bearer token or in an `x-morrow-token` header. Without the variable the
 * endpoint is disabled rather than open.
 */
export function authorizeWebhook(
  request: Request,
  env: Env = process.env,
): WriteAuthorization {
  const expected = env.MORROW_WEBHOOK_TOKEN?.trim();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      message:
        'Webhooks are disabled until MORROW_WEBHOOK_TOKEN is configured on the server.',
    };
  }
  const supplied =
    request.headers.get('x-morrow-token')?.trim() || bearerToken(request);
  return secretsMatch(supplied, expected)
    ? { ok: true }
    : { ok: false, status: 401, message: 'Webhook token is missing or wrong.' };
}
