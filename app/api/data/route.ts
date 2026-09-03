import { loadBlockData } from '@/db/block-data';
import { getMorrowConfig } from '@/db/morrow-config';

/**
 * `GET /api/data` → `{ [blockId]: { data, fetchedAt, error } }` for every block
 * with a data source. Stale poll sources are refreshed on the way. Public, like
 * the configuration: anything here is meant to be shown on a screen.
 */
export async function GET() {
  const config = await getMorrowConfig();
  const data = await loadBlockData(config);
  return Response.json(data, { headers: { 'cache-control': 'no-store' } });
}
