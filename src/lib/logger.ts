import { dbConnect } from '@/lib/mongodb';
import { AppLog } from '@/models/AppLog';

export interface LogEventParams {
  level: 'info' | 'warn' | 'error' | 'success';
  category: 'sms' | 'import' | 'auth' | 'collection' | 'system';
  action: string;
  message: string;
  recipient?: string;
  phone?: string;
  houseNo?: string;
  customerName?: string;
  collectionName?: string;
  collectionId?: string;
  recordId?: string;
  status: 'success' | 'failed' | 'pending';
  gatewayResponse?: string;
  error?: string;
  details?: Record<string, any>;
}

export function formatSmsFriendlyMessage(
  rawError: string | undefined,
  context: { phone?: string; name?: string; houseNo?: string }
): { message: string; isInsufficientCredits: boolean; isInvalidPhone: boolean } {
  const err = String(rawError || '').toLowerCase();
  const name = context.name || 'Customer';
  const house = context.houseNo ? `house #${context.houseNo}` : 'house #N/A';
  const phone = context.phone || 'N/A';

  if (!phone || phone === 'N/A' || err.includes('empty') || err.includes('missing phone')) {
    return {
      message: `Phone number is empty for record ${house} (${name}).`,
      isInsufficientCredits: false,
      isInvalidPhone: true,
    };
  }

  if (
    err.includes('no digits') ||
    err.includes('invalid phone') ||
    err.includes('contains no digits') ||
    err.includes('invalid recipient')
  ) {
    return {
      message: `Invalid phone number "${phone}" for record ${house} (${name}).`,
      isInsufficientCredits: false,
      isInvalidPhone: true,
    };
  }

  if (
    err.includes('insufficient') ||
    err.includes('credit') ||
    err.includes('balance') ||
    err.includes('quota') ||
    err.includes('402') ||
    err.includes('units')
  ) {
    return {
      message: `Insufficient SMS credits for BongaTech gateway. Please recharge account balance.`,
      isInsufficientCredits: true,
      isInvalidPhone: false,
    };
  }

  if (err.includes('missing api key') || err.includes('not configured') || err.includes('missing sender id')) {
    return {
      message: `BongaTech SMS gateway is not properly configured. Check environment credentials.`,
      isInsufficientCredits: false,
      isInvalidPhone: false,
    };
  }

  if (err.includes('rate limit') || err.includes('429') || err.includes('too many requests')) {
    return {
      message: `BongaTech rate limit exceeded (429) for record ${house} (${name}). Throttled by provider.`,
      isInsufficientCredits: false,
      isInvalidPhone: false,
    };
  }

  if (err.includes('timeout') || err.includes('aborted') || err.includes('signal timed out')) {
    return {
      message: `Gateway connection timed out while sending SMS to ${house} (${name}) at ${phone}.`,
      isInsufficientCredits: false,
      isInvalidPhone: false,
    };
  }

  if (err.includes('non-json') || err.includes('500') || err.includes('502') || err.includes('503')) {
    return {
      message: `BongaTech gateway service error while sending SMS to ${house} (${name}).`,
      isInsufficientCredits: false,
      isInvalidPhone: false,
    };
  }

  return {
    message: rawError
      ? `SMS delivery failed for record ${house} (${name}): ${rawError}`
      : `SMS delivery failed for record ${house} (${name}).`,
    isInsufficientCredits: false,
    isInvalidPhone: false,
  };
}

export async function logAppEvent(params: LogEventParams) {
  try {
    await dbConnect();
    await AppLog.create({
      timestamp: new Date(),
      level: params.level,
      category: params.category,
      action: params.action,
      message: params.message,
      recipient: params.recipient || (params.phone ? `${params.phone}${params.customerName ? ` (${params.customerName})` : ''}` : undefined),
      phone: params.phone,
      houseNo: params.houseNo,
      customerName: params.customerName,
      collectionName: params.collectionName,
      collectionId: params.collectionId,
      recordId: params.recordId,
      status: params.status,
      gatewayResponse: params.gatewayResponse,
      error: params.error,
      details: params.details,
    });
  } catch (err) {
    console.error('[AppLog Error] Failed to persist log entry:', err);
  }
}
