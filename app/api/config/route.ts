import { reconcileBlockData } from '@/db/block-data';
import { pruneSecrets } from '@/db/block-secrets';
import {
  loadMorrowConfig,
  saveMorrowConfig,
  type StoredConfig,
} from '@/db/morrow-config';
import { BUILD_HEADER, serverBuildId } from '@/lib/morrow/build';
import { MorrowConfigError, parseMorrowConfig } from '@/lib/morrow/config';
import { authorizeConfigWrite } from '@/lib/morrow/server-auth';

/** Largest configuration body accepted, in bytes. */
const MAX_BODY_BYTES = 512 * 1024;

/** Carries the stored version stamp; send it back as `If-Match` when saving. */
export const UPDATED_AT_HEADER = 'x-morrow-updated-at';

function respond(stored: StoredConfig, status = 200) {
  const headers: Record<string, string> = {
    'cache-control': 'no-store',
    [BUILD_HEADER]: serverBuildId(),
  };
  if (stored.updatedAt) headers[UPDATED_AT_HEADER] = stored.updatedAt;
  return Response.json(stored.config, { status, headers });
}

export async function GET() {
  return respond(await loadMorrowConfig());
}

export async function PUT(request: Request) {
  const authorization = authorizeConfigWrite(request);
  if (!authorization.ok) {
    return Response.json(
      { error: authorization.message },
      { status: authorization.status },
    );
  }

  const declaredLength = Number(request.headers.get('content-length'));
  if (declaredLength > MAX_BODY_BYTES) {
    return Response.json(
      { error: 'Configuration is too large.' },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return Response.json(
        { error: 'Configuration is too large.' },
        { status: 413 },
      );
    }
    body = JSON.parse(raw);
  } catch {
    return Response.json(
      { error: 'Request body must be JSON.' },
      { status: 400 },
    );
  }

  try {
    const config = parseMorrowConfig(body);
    const expected = request.headers.get('if-match')?.trim() || null;
    const before = await loadMorrowConfig();
    const result = await saveMorrowConfig(config, expected);
    if (result.status === 'conflict') {
      return Response.json(
        {
          error:
            'Someone else saved changes since you loaded this page. Reload to see them.',
        },
        { status: 409 },
      );
    }
    // Stored data for removed or re-pointed blocks must not outlive the save.
    await reconcileBlockData(before.config, result.stored.config);
    await pruneSecrets(
      result.stored.config.pages.flatMap((page) =>
        page.blocks.map((b) => b.id),
      ),
    );
    return respond(result.stored);
  } catch (error) {
    if (error instanceof MorrowConfigError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error('Could not save Morrow configuration.', error);
    return Response.json(
      { error: 'Could not save configuration.' },
      { status: 500 },
    );
  }
}
