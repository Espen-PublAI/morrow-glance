import { writeBlockData } from '@/db/block-data';
import { getMorrowConfig } from '@/db/morrow-config';
import { authorizeWebhook } from '@/lib/morrow/server-auth';
import { resolveBlockSource } from '@/lib/morrow/block-source';
import { MAX_DATA_BYTES, blocksWithSources } from '@/lib/morrow/sources';

/**
 * `POST /api/webhooks/:blockId` with a JSON body replaces that block's data.
 * The block must exist and use the `webhook` strategy. Authenticate with
 * `MORROW_WEBHOOK_TOKEN` as `Authorization: Bearer …` or `x-morrow-token`.
 */

interface RouteContext {
  params: Promise<{ blockId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const authorization = authorizeWebhook(request);
  if (!authorization.ok) {
    return Response.json(
      { error: authorization.message },
      { status: authorization.status },
    );
  }

  const { blockId } = await context.params;
  const config = await getMorrowConfig();
  const block = blocksWithSources(config, resolveBlockSource).find(
    (candidate) =>
      candidate.id === blockId &&
      resolveBlockSource(candidate)?.kind === 'webhook',
  );
  if (!block) {
    return Response.json(
      { error: 'No webhook block with this id.' },
      { status: 404 },
    );
  }

  const declaredLength = Number(request.headers.get('content-length'));
  if (declaredLength > MAX_DATA_BYTES) {
    return Response.json(
      { error: 'Payload is larger than 64 KB.' },
      { status: 413 },
    );
  }

  let data: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_DATA_BYTES) {
      return Response.json(
        { error: 'Payload is larger than 64 KB.' },
        { status: 413 },
      );
    }
    data = JSON.parse(raw);
  } catch {
    return Response.json(
      { error: 'Request body must be JSON.' },
      { status: 400 },
    );
  }

  const stored = await writeBlockData(block.id, data);
  return Response.json(
    { ok: true, blockId: block.id, fetchedAt: stored.fetchedAt },
    { headers: { 'cache-control': 'no-store' } },
  );
}
