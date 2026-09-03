import {
  MAX_SECRET_BYTES,
  deleteSecret,
  isValidSecretName,
  readSecretNames,
  writeSecret,
} from '@/db/block-secrets';
import { authorizeConfigWrite } from '@/lib/morrow/server-auth';

/**
 * Per-block secrets for plugin server modules.
 *
 *   GET    /api/blocks/:blockId/secrets            → { names: string[] }
 *   PUT    /api/blocks/:blockId/secrets  { name, value }
 *   DELETE /api/blocks/:blockId/secrets?name=...
 *
 * All gated like a configuration write. Values are never returned.
 */

interface RouteContext {
  params: Promise<{ blockId: string }>;
}

const BLOCK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function deny(request: Request) {
  const authorization = authorizeConfigWrite(request);
  return authorization.ok
    ? null
    : Response.json(
        { error: authorization.message },
        { status: authorization.status },
      );
}

export async function GET(request: Request, context: RouteContext) {
  const denied = deny(request);
  if (denied) return denied;
  const { blockId } = await context.params;
  if (!BLOCK_ID.test(blockId))
    return Response.json({ error: 'Invalid block id.' }, { status: 400 });
  return Response.json(
    { names: await readSecretNames(blockId) },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function PUT(request: Request, context: RouteContext) {
  const denied = deny(request);
  if (denied) return denied;
  const { blockId } = await context.params;
  if (!BLOCK_ID.test(blockId))
    return Response.json({ error: 'Invalid block id.' }, { status: 400 });

  let body: { name?: unknown; value?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; value?: unknown };
  } catch {
    return Response.json(
      { error: 'Request body must be JSON.' },
      { status: 400 },
    );
  }
  const { name, value } = body;
  if (typeof name !== 'string' || !isValidSecretName(name)) {
    return Response.json({ error: 'Invalid secret name.' }, { status: 400 });
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return Response.json(
      { error: 'Secret value is required.' },
      { status: 400 },
    );
  }
  if (value.length > MAX_SECRET_BYTES) {
    return Response.json(
      { error: 'Secret value is too long.' },
      { status: 413 },
    );
  }
  await writeSecret(blockId, name, value.trim());
  return Response.json({ ok: true, names: await readSecretNames(blockId) });
}

export async function DELETE(request: Request, context: RouteContext) {
  const denied = deny(request);
  if (denied) return denied;
  const { blockId } = await context.params;
  const name = new URL(request.url).searchParams.get('name') ?? '';
  if (!BLOCK_ID.test(blockId) || !isValidSecretName(name)) {
    return Response.json(
      { error: 'Invalid block id or secret name.' },
      { status: 400 },
    );
  }
  await deleteSecret(blockId, name);
  return Response.json({ ok: true, names: await readSecretNames(blockId) });
}
