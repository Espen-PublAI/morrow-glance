import { MorrowDisplay } from '@/components/morrow-display';
import { loadMorrowConfigOrFallback } from '@/db/morrow-config';

// The configuration lives in D1 and changes at runtime; never prerender.
export const dynamic = 'force-dynamic';

export default async function Home() {
  const { config } = await loadMorrowConfigOrFallback();
  return <MorrowDisplay initialConfig={config} />;
}
