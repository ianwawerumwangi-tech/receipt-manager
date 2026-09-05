import { getAppLogsAction } from '@/actions/log.actions';
import { LogsViewClient } from './LogsViewClient';

export const dynamic = 'force-dynamic';

export default async function LogsPage() {
  const initialData = await getAppLogsAction({ page: 1, limit: 30 });

  const safeData = {
    logs: initialData.logs || [],
    total: initialData.total || 0,
    page: initialData.page || 1,
    totalPages: initialData.totalPages || 1,
    stats: initialData.stats || null,
  };

  return (
    <div className="space-y-6">
      <LogsViewClient initialData={safeData} />
    </div>
  );
}
