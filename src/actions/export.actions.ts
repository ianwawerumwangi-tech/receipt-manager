'use server';

import { getSession } from '@/lib/auth';
import { exportPaymentsToExcel } from '@/services/export.service';

export async function downloadPaymentsExcel() {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  return exportPaymentsToExcel();
}
