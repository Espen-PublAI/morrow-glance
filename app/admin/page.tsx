import { AdminMount } from '@/components/admin/admin-mount';
import { loadMorrowConfigOrFallback } from '@/db/morrow-config';
import './admin.css';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const { config, updatedAt } = await loadMorrowConfigOrFallback();
  return <AdminMount initialConfig={config} initialUpdatedAt={updatedAt} />;
}
