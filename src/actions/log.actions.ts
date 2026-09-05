'use server';

import { revalidatePath } from 'next/cache';
import { dbConnect } from '@/lib/mongodb';
import { AppLog } from '@/models/AppLog';
import { getSession } from '@/lib/auth';
import { serialize } from '@/lib/utils';
import { logAppEvent, LogEventParams } from '@/lib/logger';

export interface LogFilterParams {
  category?: string;
  level?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export async function getAppLogsAction(params: LogFilterParams = {}) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized', logs: [], total: 0, page: 1, totalPages: 1, stats: null };

  await dbConnect();

  const {
    category = 'all',
    level = 'all',
    status = 'all',
    search = '',
    page = 1,
    limit = 25,
  } = params;

  const query: Record<string, any> = {};

  if (category && category !== 'all') {
    query.category = category;
  }

  if (level && level !== 'all') {
    query.level = level;
  }

  if (status && status !== 'all') {
    query.status = status;
  }

  if (search && search.trim()) {
    const s = search.trim();
    const regex = new RegExp(s, 'i');
    query.$or = [
      { message: { $regex: regex } },
      { recipient: { $regex: regex } },
      { phone: { $regex: regex } },
      { customerName: { $regex: regex } },
      { houseNo: { $regex: regex } },
      { collectionName: { $regex: regex } },
      { action: { $regex: regex } },
      { error: { $regex: regex } },
    ];
  }

  const skip = (Math.max(1, page) - 1) * limit;

  const [logs, total, statsAggregation] = await Promise.all([
    AppLog.find(query)
      .sort({ timestamp: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AppLog.countDocuments(query),
    AppLog.aggregate([
      {
        $facet: {
          totalLogs: [{ $count: 'count' }],
          totalErrors: [{ $match: { level: 'error' } }, { $count: 'count' }],
          smsTotal: [{ $match: { category: 'sms' } }, { $count: 'count' }],
          smsFailed: [{ $match: { category: 'sms', status: 'failed' } }, { $count: 'count' }],
          smsDelivered: [{ $match: { category: 'sms', status: 'success' } }, { $count: 'count' }],
          importTotal: [{ $match: { category: 'import' } }, { $count: 'count' }],
        },
      },
    ]),
  ]);

  const facet = statsAggregation[0] || {};
  const stats = {
    totalLogs: facet.totalLogs?.[0]?.count || 0,
    totalErrors: facet.totalErrors?.[0]?.count || 0,
    smsTotal: facet.smsTotal?.[0]?.count || 0,
    smsFailed: facet.smsFailed?.[0]?.count || 0,
    smsDelivered: facet.smsDelivered?.[0]?.count || 0,
    importTotal: facet.importTotal?.[0]?.count || 0,
  };

  return serialize({
    logs: logs.map((l: any) => ({
      ...l,
      _id: l._id.toString(),
      collectionId: l.collectionId ? l.collectionId.toString() : undefined,
      recordId: l.recordId ? l.recordId.toString() : undefined,
      timestamp: l.timestamp ? new Date(l.timestamp).toISOString() : new Date().toISOString(),
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit) || 1,
    stats,
  });
}

export async function clearAppLogsAction(category?: string) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  await dbConnect();

  const query: Record<string, any> = {};
  if (category && category !== 'all') {
    query.category = category;
  }

  await AppLog.deleteMany(query);

  revalidatePath('/logs');
  return { success: true };
}

export async function logEventAction(params: LogEventParams) {
  await logAppEvent(params);
  return { success: true };
}
