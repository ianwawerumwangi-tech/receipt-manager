'use server';

import { revalidatePath } from 'next/cache';
import { dbConnect } from '@/lib/mongodb';
import { Collection } from '@/models/Collection';
import { Record } from '@/models/Record';
import { Field } from '@/models/Field';
import { AppLog } from '@/models/AppLog';
import { getSession } from '@/lib/auth';
import { serialize, extractRecordInstallments } from '@/lib/utils';
import { sendSms, sendBatchSms, buildSmsTemplate, buildWaterBillSmsTemplate } from '@/lib/sms';
import { lookupTenantPhone } from '@/actions/customer.actions';
import { logAppEvent, formatSmsFriendlyMessage } from '@/lib/logger';
import {
  getInvoiceTemplate,
  getCurrentInvoiceMonth,
  extractPlotNameFromCollection,
  resolveInvoiceMessage,
} from '@/lib/invoice-templates';
import { resolveCollectionType } from '@/lib/document-classifier';

function parseMathExpression(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'object') {
    if ('result' in val && typeof val.result === 'number') return val.result;
    if ('result' in val && typeof val.result === 'string') return parseMathExpression(val.result);
  }
  const str = String(val).trim();
  if (!str) return 0;
  if (/^\d+(\s*\+\s*\d+)*$/.test(str)) {
    try {
      return str.split('+').reduce((sum, part) => sum + Number(part.trim()), 0);
    } catch {
      return 0;
    }
  }
  const parsed = Number(str);
  return isNaN(parsed) ? 0 : parsed;
}

function findFieldByPriority(fields: any[], candidates: string[]) {
  for (const candidate of candidates) {
    const found = fields.find((f) => f.name.trim().toUpperCase() === candidate.toUpperCase());
    if (found) return found;
  }
  return null;
}

async function validateAndFormatReceiptNumber(
  collectionId: string,
  recordId: string | null,
  fieldData: Record<string, unknown>
): Promise<{ error?: string }> {
  const fields = await Field.find({ collectionId }).lean();
  const rctField = fields.find(
    (f) => f.name.toUpperCase() === 'RCT NO' || f.name.toUpperCase() === 'RECEIPT NUMBER'
  );

  if (!rctField) return {}; // No receipt number field, nothing to validate

  const fieldName = rctField.name;
  let val = String(fieldData[fieldName] || '').trim().toUpperCase();

  // If empty, auto-generate a unique 10-character alphanumeric uppercase code
  if (!val) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let isUnique = false;
    let generated = '';
    while (!isUnique) {
      generated = '';
      for (let i = 0; i < 10; i++) {
        generated += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      const existing = await Record.findOne({
        collectionId,
        [`data.${fieldName}`]: { $regex: new RegExp(`(^|/)${generated}($|/)`) },
      });
      if (!existing) {
        isUnique = true;
      }
    }
    fieldData[fieldName] = generated;
    return {};
  }

  const parts = val.split('/').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return {
      error: `Receipt number cannot be empty.`,
    };
  }

  const EXEMPT_CODES = ['DIRECT', 'CASH', 'BANK', 'MANUAL', 'N/A', 'NA', 'CHEQUE', 'CHECK', 'NONE'];

  // Check if existing record already has this value to avoid blocking edits to other fields
  let existingValParts: string[] = [];
  if (recordId) {
    const existingDoc = await Record.findById(recordId).lean();
    if (existingDoc) {
      const existingData = existingDoc.data instanceof Map
        ? Object.fromEntries(existingDoc.data)
        : (existingDoc.data as Record<string, any>);
      const existingVal = String(existingData[fieldName] || '').toUpperCase();
      existingValParts = existingVal.split('/').map((p) => p.trim());
    }
  }

  for (const part of parts) {
    if (EXEMPT_CODES.includes(part.toUpperCase())) {
      continue;
    }

    if (existingValParts.includes(part)) {
      continue;
    }

    if (part.length !== 10 || !/^[A-Z0-9]+$/.test(part)) {
      return {
        error: `Each transaction ID "${part}" in the receipt must be exactly 10 uppercase alphanumeric characters.`,
      };
    }

    // Validate uniqueness for each transaction ID part
    const query: Record<string, any> = {
      collectionId,
      [`data.${fieldName}`]: { $regex: new RegExp(`(^|/)${part}($|/)`) },
    };
    if (recordId) {
      query._id = { $ne: recordId };
    }

    const existing = await Record.findOne(query);
    if (existing) {
      return {
        error: `Transaction ID "${part}" is already used in another record. It must be unique.`,
      };
    }
  }

  fieldData[fieldName] = val; // save clean trimmed uppercase value
  return {};
}

export async function getRecords(collectionId: string) {
  const session = await getSession();
  if (!session) return [];

  await dbConnect();
  const records = await Record.find({ collectionId })
    .sort({ order: 1, createdAt: 1 })
    .lean();

  return serialize(
    records.map((r) => ({
      ...r,
      _id: r._id.toString(),
      collectionId: r.collectionId.toString(),
      createdBy: r.createdBy.toString(),
      data: r.data instanceof Map ? Object.fromEntries(r.data) : (r.data as Record<string, unknown>),
    }))
  );
}

export async function createRecord(data: {
  collectionId: string;
  fieldData: Record<string, unknown>;
}) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  await dbConnect();

  const valRes = await validateAndFormatReceiptNumber(data.collectionId, null, data.fieldData);
  if (valRes.error) {
    return { error: valRes.error };
  }

  const maxOrderRecord = await Record.findOne({ collectionId: data.collectionId })
    .sort({ order: -1 })
    .select('order')
    .lean();

  const nextOrder = (maxOrderRecord?.order ?? -1) + 1;

  await Record.create({
    collectionId: data.collectionId,
    data: data.fieldData,
    order: nextOrder,
    createdBy: session.userId,
  });

  revalidatePath(`/collections/${data.collectionId}`);
  revalidatePath('/');
  return { success: true };
}

export async function updateRecord(id: string, collectionId: string, fieldData: Record<string, unknown>) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  await dbConnect();

  const valRes = await validateAndFormatReceiptNumber(collectionId, id, fieldData);
  if (valRes.error) {
    return { error: valRes.error };
  }

  const fields = await Field.find({ collectionId }).lean();
  const amountField = findFieldByPriority(fields, ['RENT PAID', 'AMOUNT PAID', 'AMOUNT', 'DEPOSIT PAID']);
  const rctField = findFieldByPriority(fields, ['RCT NO', 'RECEIPT NUMBER', 'RECEIPT NO', 'RECEIPT']);
  if (amountField || rctField) {
    const freshInstallments = extractRecordInstallments(fieldData, fields);
    if (freshInstallments.length > 0) {
      fieldData['_installments'] = freshInstallments;
    } else {
      delete fieldData['_installments'];
    }
  }

  await Record.findByIdAndUpdate(id, { data: fieldData });
  revalidatePath(`/collections/${collectionId}`);
  revalidatePath('/');
  return { success: true };
}

export async function getCollectionRecords(collectionId: string) {
  const session = await getSession();
  if (!session) return [];

  await dbConnect();
  const records = await Record.find({ collectionId })
    .sort({ order: 1, createdAt: 1 })
    .lean();

  return serialize(
    records.map((r) => ({
      _id: r._id.toString(),
      data: r.data instanceof Map ? Object.fromEntries(r.data) : (r.data as Record<string, unknown>),
    }))
  );
}

export async function deleteRecord(id: string, collectionId: string) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  await dbConnect();
  await Record.findByIdAndDelete(id);
  revalidatePath(`/collections/${collectionId}`);
  revalidatePath('/');
  return { success: true };
}

export async function updateRecordsBulk(
  collectionId: string,
  updates: { id: string; data: Record<string, unknown> }[]
) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  await dbConnect();

  const fields = await Field.find({ collectionId }).lean();

  // Validate all drafts before committing and sync installments
  for (const update of updates) {
    const valRes = await validateAndFormatReceiptNumber(collectionId, update.id, update.data);
    if (valRes.error) {
      return { error: valRes.error };
    }

    const amountField = findFieldByPriority(fields, ['RENT PAID', 'AMOUNT PAID', 'AMOUNT', 'DEPOSIT PAID']);
    const rctField = findFieldByPriority(fields, ['RCT NO', 'RECEIPT NUMBER', 'RECEIPT NO', 'RECEIPT']);
    if (amountField || rctField) {
      const freshInstallments = extractRecordInstallments(update.data, fields);
      if (freshInstallments.length > 0) {
        update.data['_installments'] = freshInstallments;
      } else {
        delete update.data['_installments'];
      }
    }
  }

  const operations = updates.map((update) => ({
    updateOne: {
      filter: { _id: update.id },
      update: { $set: { data: update.data } },
    },
  }));

  if (operations.length > 0) {
    await Record.bulkWrite(operations);
  }

  revalidatePath(`/collections/${collectionId}`);
  revalidatePath('/');
  return { success: true };
}

export async function buildRecordSmsPayload(
  recordDataObj: Record<string, any>,
  fields: any[],
  collectionName?: string,
  collectionId?: string,
  cachedRate?: number,
  explicitCollectionType?: string,
  selectedInstallment?: { amount: number; rct: string }
) {
  // Name
  const nameFieldCandidates = ['NAME', 'CUSTOMER NAME', 'CUSTOMER', 'TENANT', 'CLIENT NAME', 'CLIENT'];
  const nameField = findFieldByPriority(fields, nameFieldCandidates);
  const name = String(recordDataObj[nameField?.name || ''] || 'Customer').trim();

  // Phone
  const phoneFieldCandidates = ['PHONE NO', 'PHONE', 'PHONE NUMBER', 'MOBILE'];
  const phoneField = findFieldByPriority(fields, phoneFieldCandidates);
  let phone = String(recordDataObj[phoneField?.name || ''] || '').trim();

  // Automatic lookup fallback if phone is empty
  if (!phone && name && name !== 'Customer') {
    const houseField = findFieldByPriority(fields, ['HSE NO', 'HOUSE NO', 'HOUSE', 'HSE', 'UNIT NO']);
    const houseNo = houseField ? String(recordDataObj[houseField.name] || '').trim() : undefined;
    const lookedUpPhone = await lookupTenantPhone(name, houseNo);
    if (lookedUpPhone) {
      phone = lookedUpPhone;
    }
  }

  // Determine if collection is a Water Bill collection based on explicit type or robust schema detection
  let collDoc: any = null;
  if (collectionId) {
    collDoc = await Collection.findById(collectionId).lean();
  } else if (collectionName) {
    collDoc = typeof collectionName === 'object' && collectionName !== null
      ? collectionName
      : { name: String(collectionName) };
  }
  const effectiveCollectionName = typeof collectionName === 'object' && collectionName !== null
    ? (collectionName as any).name
    : collectionName || collDoc?.name;
  const resolvedType = explicitCollectionType || (typeof collectionName === 'object' && (collectionName as any)?.type) || resolveCollectionType(collDoc, fields);
  const isWaterBill = resolvedType === 'water_bill';

  // Month
  const monthFieldCandidates = ['MONTH OF RECEIPT', 'PERIOD', 'MONTH', 'FOR MONTH', 'FOR THE MONTH OF', 'RECEIPT MONTH', 'BILL MONTH'];
  const monthField = findFieldByPriority(fields, monthFieldCandidates);
  let monthStr = String(recordDataObj[monthField?.name || ''] || '').trim();

  if (!monthStr && effectiveCollectionName) {
    const months = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const upperColl = effectiveCollectionName.toUpperCase();
    for (const m of months) {
      if (upperColl.includes(m)) {
        const yearMatch = upperColl.match(/20\d\d/);
        monthStr = yearMatch ? `${m} ${yearMatch[0]}` : m;
        break;
      }
    }
    if (!monthStr) {
      monthStr = effectiveCollectionName;
    }
  }

  if (!monthStr) {
    const now = new Date();
    monthStr = now.toLocaleString('default', { month: 'long', year: 'numeric' });
  }

  if (isWaterBill) {
    // Previous Amount / Reading
    const prevField = findFieldByPriority(fields, ['PREVIOUS', 'PREV', 'PREVIOUS READING', 'PREV READING', 'PREV READ']);
    const prevVal = prevField ? parseMathExpression(recordDataObj[prevField.name]) : 0;

    // Current Amount / Reading
    const currField = findFieldByPriority(fields, ['CURRENT', 'CURR', 'CURRENT READING', 'CURR READING', 'CURR READ']);
    const currVal = currField ? parseMathExpression(recordDataObj[currField.name]) : 0;

    // Consumption / Units
    const consumptionField = findFieldByPriority(fields, ['CONSUMPTION', 'UNITS', 'UNITS USED']);
    const recordedConsumption = consumptionField ? parseMathExpression(recordDataObj[consumptionField.name]) : null;
    const consumption = (recordedConsumption !== null && recordedConsumption > 0)
      ? recordedConsumption
      : Math.max(0, currVal - prevVal);

    const totalFieldCandidates = ['TOTAL BILL', 'WATER BILL', 'TOTAL', 'TOTAL AMOUNT', 'AMOUNT DUE', 'AMOUNT'];
    const totalField = findFieldByPriority(fields, totalFieldCandidates);
    const recordedTotal = totalField ? parseMathExpression(recordDataObj[totalField.name]) : 0;

    // Dynamic rate per unit from document formulae, fields, this record, or sibling records
    let rateVal = 0;

    // 1. Explicit rate field in schema (e.g. 'PER UNIT', 'RATE', 'UNIT RATE')
    const rateField = findFieldByPriority(fields, ['PER UNIT', 'RATE', 'UNIT RATE', 'AMOUNT PER UNIT', 'PRICE PER UNIT']);
    if (rateField && parseMathExpression(recordDataObj[rateField.name]) > 0) {
      rateVal = parseMathExpression(recordDataObj[rateField.name]);
    }

    // 2. Cached unit rate stored during Excel import on this record
    if (!rateVal && typeof recordDataObj._unitRate === 'number' && recordDataObj._unitRate > 0) {
      rateVal = recordDataObj._unitRate;
    }

    // 3. From cachedRate passed from collection context
    if (!rateVal && typeof cachedRate === 'number' && cachedRate > 0) {
      rateVal = cachedRate;
    }

    // 4. Calculate from this record if it has usage and recorded total/bill
    if (!rateVal && consumption > 0 && recordedTotal > 0) {
      rateVal = Math.round(recordedTotal / consumption);
    }

    // 5. Look up sibling records in the same collection if collectionId is available
    if (!rateVal && collectionId) {
      const siblingRecords = await Record.find({ collectionId }).limit(30).lean();
      for (const sib of siblingRecords) {
        const sibData = sib.data instanceof Map ? Object.fromEntries(sib.data) : (sib.data as Record<string, any>);
        if (typeof sibData._unitRate === 'number' && sibData._unitRate > 0) {
          rateVal = sibData._unitRate;
          break;
        }
        const sibPrev = prevField ? parseMathExpression(sibData[prevField.name]) : 0;
        const sibCurr = currField ? parseMathExpression(sibData[currField.name]) : 0;
        const sibCons = consumptionField ? parseMathExpression(sibData[consumptionField.name]) : Math.max(0, sibCurr - sibPrev);
        const sibTot = totalField ? parseMathExpression(sibData[totalField.name]) : 0;
        if (sibCons > 0 && sibTot > 0) {
          rateVal = Math.round(sibTot / sibCons);
          if (rateVal > 0) break;
        }
      }
    }

    // 6. Default fallback
    if (!rateVal || rateVal <= 0) {
      rateVal = 150;
    }

    // When previous and current readings are the same (or current <= previous),
    // there was no water usage, so total must strictly be 0 (no charge).
    let totalVal = 0;
    const isZeroUsage = (prevField && currField)
      ? currVal <= prevVal
      : (recordedConsumption !== null ? recordedConsumption <= 0 : false);

    if (isZeroUsage) {
      totalVal = 0;
    } else {
      totalVal = recordedTotal > 0 ? recordedTotal : consumption * rateVal;
    }

    const message = buildWaterBillSmsTemplate({
      customerName: name,
      month: monthStr,
      previousAmount: prevVal,
      currentAmount: currVal,
      amountPerUnit: rateVal,
      totalAmount: totalVal,
    });

    return {
      phone,
      name,
      message,
      phoneFieldFound: !!phoneField,
    };
  }

  // Payment receipt template
  const houseFieldCandidates = ['HSE NO', 'HOUSE NO', 'HOUSE', 'HSE', 'HOUSE NUMBER', 'UNIT NO', 'UNIT', 'FLAT NO', 'ROOM NO', 'HSE/ROOM', 'HOUSE/ROOM'];
  const houseField = findFieldByPriority(fields, houseFieldCandidates);
  const houseNumber = String(recordDataObj[houseField?.name || ''] || 'N/A').trim();

  const installments = extractRecordInstallments(recordDataObj, fields);
  let totalAmount = 0;

  // Strict primary candidate list: rent & general payments take absolute precedence over deposits
  const amountFieldCandidates = [
    'RENT PAID',
    'AMOUNT PAID',
    'TOTAL PAID',
    'PAID',
    'AMOUNT',
    'TOTAL AMOUNT',
    'MONTHLY RENT',
  ];
  let amountField = findFieldByPriority(fields, amountFieldCandidates);
  if (!amountField) {
    // Only fall back to deposit columns if NO rent or payment columns exist in the collection schema
    amountField = findFieldByPriority(fields, ['DEPOSIT PAID', 'DEPOSIT']);
  }
  const authoritativeAmount = amountField ? parseMathExpression(recordDataObj[amountField.name]) : 0;

  if (selectedInstallment && typeof selectedInstallment.amount === 'number' && selectedInstallment.amount > 0) {
    totalAmount = selectedInstallment.amount;
  } else if (installments.length > 0) {
    const instSum = installments.reduce((sum, inst) => sum + (Number(inst.amount) || 0), 0);
    // If the sum of installments diverges from the actual amount field in the table,
    // the table's amount field is authoritative to prevent doubling or stale installments
    if (authoritativeAmount > 0 && Math.abs(instSum - authoritativeAmount) > 0.01) {
      totalAmount = authoritativeAmount;
    } else {
      totalAmount = instSum > 0 ? instSum : authoritativeAmount;
    }
  } else {
    totalAmount = authoritativeAmount;
  }

  // Actual Balance column lookup:
  // Must prioritize actual balance columns (e.g. BALANCE, CURRENT BALANCE, CLOSING BALANCE)
  // and NEVER use BAL B/D (Balance Brought Down) or BAL B/F (Balance Brought Forward), which are opening balances.
  const balanceFieldCandidates = [
    'BALANCE',
    'CURRENT BALANCE',
    'ACTUAL BALANCE',
    'CLOSING BALANCE',
    'NET BALANCE',
    'TOTAL BALANCE',
    'BAL',
    'OUTSTANDING BALANCE',
    'OUTSTANDING',
    'BAL C/D',
    'BAL C/F',
  ];
  let balanceField = findFieldByPriority(fields, balanceFieldCandidates);
  if (!balanceField) {
    // Fallback: look for a field containing BALANCE or ending with BAL,
    // strictly avoiding any brought-forward balances (B/D, B/F, BROUGHT)
    balanceField = fields.find((f) => {
      const upper = f.name.trim().toUpperCase();
      return (
        (upper.includes('BALANCE') || upper.endsWith(' BAL')) &&
        !upper.includes('B/D') &&
        !upper.includes('B/F') &&
        !upper.includes('BROUGHT')
      );
    });
  }

  const balanceVal = balanceField ? recordDataObj[balanceField.name] : null;
  const rawBal = (balanceVal !== undefined && balanceVal !== null && balanceVal !== '') ? parseMathExpression(balanceVal) : null;
  const balance = rawBal !== null ? Math.max(0, rawBal) : 0;

  const message = buildSmsTemplate({
    customerName: name,
    totalAmount,
    houseNumber,
    monthOfReceipt: monthStr,
    balance,
  });

  return {
    phone,
    name,
    message,
    phoneFieldFound: !!phoneField,
  };
}

export async function sendRecordSmsAction(
  recordId: string,
  collectionId: string,
  installment?: { amount: number; rct: string }
) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  await dbConnect();
  
  const record = await Record.findById(recordId);
  if (!record) return { error: 'Record not found' };

  const collection = await Collection.findById(collectionId).lean();
  const fields = await Field.find({ collectionId }).lean();

  const smsStatusField = fields.find(f => ['SMS STATUS', 'SMS_STATUS'].includes(f.name.toUpperCase()));
  let statusFieldName = 'SMS Status';
  if (!smsStatusField) {
    await Field.create({
      collectionId,
      name: 'SMS Status',
      type: 'text',
      required: false
    });
  } else {
    statusFieldName = smsStatusField.name;
  }

  const recordDataObj = record.data instanceof Map ? Object.fromEntries(record.data) : (record.data as Record<string, any>);
  const houseField = findFieldByPriority(fields, ['HSE NO', 'HOUSE NO', 'HOUSE', 'HSE', 'UNIT NO', 'HOUSE NUMBER']);
  const houseNo = houseField ? String(recordDataObj[houseField.name] || '').trim() : undefined;

  const payload = await buildRecordSmsPayload(
    recordDataObj,
    fields,
    collection?.name,
    collectionId,
    undefined,
    undefined,
    installment
  );

  if (!payload.phoneFieldFound) {
    await logAppEvent({
      level: 'error',
      category: 'sms',
      action: 'Send SMS',
      message: `Phone number field not found in collection schema for record ${houseNo ? `house #${houseNo}` : ''} (${payload.name}).`,
      houseNo,
      customerName: payload.name,
      collectionName: collection?.name,
      collectionId,
      recordId,
      status: 'failed',
      error: 'Phone field not found in schema',
    });
    return { error: 'Phone number field (e.g. "PHONE NO") not found in collection schema.' };
  }

  if (!payload.phone) {
    const formatted = formatSmsFriendlyMessage('Empty phone number', {
      phone: '',
      name: payload.name,
      houseNo,
    });
    await logAppEvent({
      level: 'error',
      category: 'sms',
      action: 'Send SMS',
      message: formatted.message,
      phone: '',
      houseNo,
      customerName: payload.name,
      collectionName: collection?.name,
      collectionId,
      recordId,
      status: 'failed',
      error: 'Phone number is empty',
      details: { isInvalidPhone: true },
    });
    return { error: formatted.message };
  }

  const result = await sendSms(payload.phone, payload.message);

  record.data.set(statusFieldName, result.success ? 'sent' : 'failed');
  record.markModified('data');
  await record.save();

  if (result.success) {
    await logAppEvent({
      level: 'success',
      category: 'sms',
      action: 'Send SMS',
      message: `SMS sent successfully to ${payload.phone} for house #${houseNo || 'N/A'} (${payload.name}).`,
      phone: payload.phone,
      houseNo,
      customerName: payload.name,
      collectionName: collection?.name,
      collectionId,
      recordId,
      status: 'success',
      details: { messageId: result.messageId, message: payload.message },
    });
  } else {
    const formatted = formatSmsFriendlyMessage(result.error, {
      phone: payload.phone,
      name: payload.name,
      houseNo,
    });
    await logAppEvent({
      level: 'error',
      category: 'sms',
      action: 'Send SMS',
      message: formatted.message,
      phone: payload.phone,
      houseNo,
      customerName: payload.name,
      collectionName: collection?.name,
      collectionId,
      recordId,
      status: 'failed',
      error: result.error,
      details: {
        rawError: result.error,
        isInsufficientCredits: formatted.isInsufficientCredits,
        isInvalidPhone: formatted.isInvalidPhone,
        message: payload.message,
      },
    });
  }

  revalidatePath(`/collections/${collectionId}`);
  revalidatePath('/logs');
  revalidatePath('/');

  if (!result.success) {
    const formatted = formatSmsFriendlyMessage(result.error, {
      phone: payload.phone,
      name: payload.name,
      houseNo,
    });
    return { error: formatted.message };
  }

  return { success: true, count: 1 };
}

export async function sendRecordsSmsChunkAction(recordIds: string[], collectionId: string) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized', successCount: 0, failCount: recordIds.length };

  await dbConnect();

  const collection = await Collection.findById(collectionId).lean();
  const fields = await Field.find({ collectionId }).lean();
  const smsStatusField = fields.find((f) => ['SMS STATUS', 'SMS_STATUS'].includes(f.name.toUpperCase()));

  let statusFieldName = 'SMS Status';
  if (!smsStatusField) {
    await Field.create({
      collectionId,
      name: 'SMS Status',
      type: 'text',
      required: false,
    });
  } else {
    statusFieldName = smsStatusField.name;
  }

  // Pre-resolve water unit rate for water bill collections
  let cachedRate: number | undefined;
  const resolvedType = resolveCollectionType(collection, fields);
  const isWaterBill = resolvedType === 'water_bill';

  if (isWaterBill) {
    const sampleRecord = await Record.findOne({
      collectionId,
      $or: [
        { 'data._unitRate': { $exists: true, $gt: 0 } },
        { 'data.WATER BILL': { $gt: 0 } },
        { 'data.TOTAL BILL': { $gt: 0 } },
      ],
    }).lean();

    if (sampleRecord) {
      const sData =
        sampleRecord.data instanceof Map
          ? Object.fromEntries(sampleRecord.data)
          : (sampleRecord.data as Record<string, any>);
      if (typeof sData._unitRate === 'number' && sData._unitRate > 0) {
        cachedRate = sData._unitRate;
      } else {
        const prevF = findFieldByPriority(fields, ['PREVIOUS', 'PREV', 'PREVIOUS READING', 'PREV READING']);
        const currF = findFieldByPriority(fields, ['CURRENT', 'CURR', 'CURRENT READING', 'CURR READING']);
        const consF = findFieldByPriority(fields, ['CONSUMPTION', 'UNITS', 'UNITS USED']);
        const totF = findFieldByPriority(fields, ['TOTAL BILL', 'WATER BILL', 'TOTAL']);
        const p = prevF ? parseMathExpression(sData[prevF.name]) : 0;
        const c = currF ? parseMathExpression(sData[currF.name]) : 0;
        const cons = consF ? parseMathExpression(sData[consF.name]) : Math.max(0, c - p);
        const tot = totF ? parseMathExpression(sData[totF.name]) : 0;
        if (cons > 0 && tot > 0) {
          cachedRate = Math.round(tot / cons);
        }
      }
    }
  }

  const records = await Record.find({ _id: { $in: recordIds } });
  const prepared: {
    recordId: string;
    phone: string;
    name: string;
    houseNo?: string;
    message: string;
  }[] = [];

  for (const record of records) {
    const recordDataObj =
      record.data instanceof Map ? Object.fromEntries(record.data) : (record.data as Record<string, any>);

    const houseField = findFieldByPriority(fields, ['HSE NO', 'HOUSE NO', 'HOUSE', 'HSE', 'UNIT NO', 'HOUSE NUMBER']);
    const houseNo = houseField ? String(recordDataObj[houseField.name] || '').trim() : undefined;

    const payload = await buildRecordSmsPayload(recordDataObj, fields, collection?.name, collectionId, cachedRate);
    prepared.push({
      recordId: record._id.toString(),
      phone: payload.phone,
      name: payload.name,
      houseNo,
      message: payload.message,
    });
  }

  const batchResults = await sendBatchSms(
    prepared.map((p) => ({
      correlator: p.recordId,
      phone: p.phone,
      message: p.message,
    }))
  );

  const resultMap = new Map(batchResults.map((r) => [r.correlator, r]));

  let successCount = 0;
  let failCount = 0;
  const errors: string[] = [];
  const bulkOps: any[] = [];
  const logEntries: any[] = [];

  for (const p of prepared) {
    const res = resultMap.get(p.recordId) || { success: false, error: 'Unknown delivery response' };
    const isSuccess = res.success;

    if (isSuccess) {
      successCount++;
      logEntries.push({
        timestamp: new Date(),
        level: 'success',
        category: 'sms',
        action: 'Bulk SMS Send',
        message: `SMS delivered successfully to ${p.phone} for house #${p.houseNo || 'N/A'} (${p.name}).`,
        phone: p.phone,
        houseNo: p.houseNo,
        customerName: p.name,
        collectionName: collection?.name,
        collectionId,
        recordId: p.recordId,
        status: 'success',
        details: { messageId: res.messageId, message: p.message },
      });
    } else {
      failCount++;
      const formatted = formatSmsFriendlyMessage(res.error, {
        phone: p.phone,
        name: p.name,
        houseNo: p.houseNo,
      });
      errors.push(formatted.message);
      logEntries.push({
        timestamp: new Date(),
        level: 'error',
        category: 'sms',
        action: 'Bulk SMS Send',
        message: formatted.message,
        phone: p.phone,
        houseNo: p.houseNo,
        customerName: p.name,
        collectionName: collection?.name,
        collectionId,
        recordId: p.recordId,
        status: 'failed',
        error: res.error,
        details: {
          rawError: res.error,
          isInsufficientCredits: formatted.isInsufficientCredits,
          isInvalidPhone: formatted.isInvalidPhone,
          message: p.message,
        },
      });
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: p.recordId },
        update: { $set: { [`data.${statusFieldName}`]: isSuccess ? 'sent' : 'failed' } },
      },
    });
  }

  if (bulkOps.length > 0) {
    await Record.bulkWrite(bulkOps);
  }
  if (logEntries.length > 0) {
    await AppLog.insertMany(logEntries);
  }

  revalidatePath(`/collections/${collectionId}`);
  revalidatePath('/logs');
  revalidatePath('/');

  return {
    success: failCount === 0,
    successCount,
    failCount,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export async function sendRecordsSmsBulkAction(recordIds: string[], collectionId: string) {
  const CHUNK_SIZE = 10;
  let totalSuccess = 0;
  let totalFail = 0;
  const allErrors: string[] = [];

  for (let i = 0; i < recordIds.length; i += CHUNK_SIZE) {
    const chunk = recordIds.slice(i, i + CHUNK_SIZE);
    const res = await sendRecordsSmsChunkAction(chunk, collectionId);
    if ('error' in res && res.error && !res.successCount) {
      totalFail += chunk.length;
      allErrors.push(res.error);
    } else {
      totalSuccess += res.successCount || 0;
      totalFail += res.failCount || 0;
      if (res.errors) allErrors.push(...res.errors);
    }
  }

  return {
    success: totalFail === 0,
    successCount: totalSuccess,
    failCount: totalFail,
    errors: allErrors.length > 0 ? allErrors : undefined,
  };
}

export async function createRecordsBulk(
  collectionId: string,
  recordsData: Record<string, unknown>[]
) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  await dbConnect();

  // Validate all records before committing
  for (const fieldData of recordsData) {
    const valRes = await validateAndFormatReceiptNumber(collectionId, null, fieldData);
    if (valRes.error) {
      return { error: valRes.error };
    }
  }

  const maxOrderRecord = await Record.findOne({ collectionId })
    .sort({ order: -1 })
    .select('order')
    .lean();

  let startOrder = (maxOrderRecord?.order ?? -1) + 1;

  // Insert all records
  const newRecords = recordsData.map((fieldData, index) => ({
    collectionId,
    data: fieldData,
    order: startOrder + index,
    createdBy: session.userId,
  }));

  if (newRecords.length > 0) {
    await Record.insertMany(newRecords);
  }

  revalidatePath(`/collections/${collectionId}`);
  revalidatePath('/');
  return { success: true };
}

export async function buildRecordInvoiceSmsPayload(
  recordDataObj: Record<string, any>,
  fields: any[],
  collectionName?: string,
  templateId?: string,
  explicitPlotName?: string,
  explicitMonth?: string,
  customMessage?: string
) {
  // Name
  const nameFieldCandidates = ['NAME', 'CUSTOMER NAME', 'CUSTOMER', 'TENANT', 'CLIENT NAME', 'CLIENT'];
  const nameField = findFieldByPriority(fields, nameFieldCandidates);
  const name = String(recordDataObj[nameField?.name || ''] || 'Tenant').trim();

  // House No
  const houseFieldCandidates = ['HSE NO', 'HOUSE NO', 'HOUSE', 'HSE', 'UNIT NO', 'HOUSE NUMBER', 'ROOM NO', 'HSE/ROOM', 'HOUSE/ROOM'];
  const houseField = findFieldByPriority(fields, houseFieldCandidates);
  const houseNo = houseField ? String(recordDataObj[houseField.name] || '').trim() : undefined;

  // Phone
  const phoneFieldCandidates = ['PHONE NO', 'PHONE', 'PHONE NUMBER', 'MOBILE'];
  const phoneField = findFieldByPriority(fields, phoneFieldCandidates);
  let phone = String(recordDataObj[phoneField?.name || ''] || '').trim();

  // Automatic lookup fallback if phone is empty
  if (!phone && name && name !== 'Tenant') {
    const lookedUpPhone = await lookupTenantPhone(name, houseNo);
    if (lookedUpPhone) {
      phone = lookedUpPhone;
    }
  }

  // Balance
  const balanceFieldCandidates = ['BALANCE', 'CURRENT BALANCE', 'ACTUAL BALANCE', 'CLOSING BALANCE', 'BAL'];
  const balanceField = findFieldByPriority(fields, balanceFieldCandidates);
  const balanceVal = balanceField ? parseMathExpression(recordDataObj[balanceField.name]) : 0;
  const balanceStr = balanceVal ? balanceVal.toLocaleString() : '0';

  // Plot Name
  const plotName = explicitPlotName !== undefined ? explicitPlotName.trim() : extractPlotNameFromCollection(collectionName || '');

  // Month
  const month = explicitMonth?.trim() || getCurrentInvoiceMonth();

  const template = getInvoiceTemplate(templateId);

  let message = '';
  if (customMessage && customMessage.trim()) {
    message = resolveInvoiceMessage(customMessage.trim(), {
      houseNo,
      name,
      month,
      plotName,
      balance: balanceStr,
    });
  } else {
    message = template.buildMessage({ month, houseNo, plotName });
  }

  return {
    phone,
    name,
    houseNo,
    month,
    plotName,
    message,
    template,
    phoneFieldFound: !!phoneField,
  };
}

export async function sendRecordInvoiceSmsAction(params: {
  recordId: string;
  collectionId: string;
  templateId?: string;
  plotName?: string;
  month?: string;
  customMessage?: string;
}) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  await dbConnect();

  const record = await Record.findById(params.recordId);
  if (!record) return { error: 'Record not found' };

  const collection = await Collection.findById(params.collectionId).lean();
  const fields = await Field.find({ collectionId: params.collectionId }).lean();

  const invoiceStatusField = fields.find(f => ['INVOICE STATUS', 'INVOICE_STATUS'].includes(f.name.toUpperCase()));
  let statusFieldName = 'Invoice Status';
  if (!invoiceStatusField) {
    await Field.create({
      collectionId: params.collectionId,
      name: 'Invoice Status',
      type: 'text',
      required: false,
    });
  } else {
    statusFieldName = invoiceStatusField.name;
  }

  const recordDataObj = record.data instanceof Map ? Object.fromEntries(record.data) : (record.data as Record<string, any>);
  const effectiveTemplateId = params.templateId || (collection as any)?.defaultInvoiceTemplateId;
  const effectivePlotName = params.plotName || (collection as any)?.plotName;

  const payload = await buildRecordInvoiceSmsPayload(
    recordDataObj,
    fields,
    collection?.name,
    effectiveTemplateId,
    effectivePlotName,
    params.month,
    params.customMessage
  );

  const finalMessage = payload.message;

  if (!payload.phone) {
    const formatted = formatSmsFriendlyMessage('Empty phone number', {
      phone: '',
      name: payload.name,
      houseNo: payload.houseNo,
    });
    await logAppEvent({
      level: 'error',
      category: 'sms',
      action: 'Send Invoice SMS',
      message: formatted.message,
      phone: '',
      houseNo: payload.houseNo,
      customerName: payload.name,
      collectionName: collection?.name,
      collectionId: params.collectionId,
      recordId: params.recordId,
      status: 'failed',
      error: 'Phone number is empty',
      details: { isInvalidPhone: true, templateId: payload.template.id, templateName: payload.template.name },
    });
    return { error: formatted.message };
  }

  const result = await sendSms(payload.phone, finalMessage);

  record.data.set(statusFieldName, result.success ? 'sent' : 'failed');
  record.markModified('data');
  await record.save();

  if (result.success) {
    await logAppEvent({
      level: 'success',
      category: 'sms',
      action: 'Send Invoice SMS',
      message: `Invoice SMS sent successfully to ${payload.phone} for house #${payload.houseNo || 'N/A'} (${payload.name}) [${payload.template.name}].`,
      phone: payload.phone,
      houseNo: payload.houseNo,
      customerName: payload.name,
      collectionName: collection?.name,
      collectionId: params.collectionId,
      recordId: params.recordId,
      status: 'success',
      details: { messageId: result.messageId, message: finalMessage, templateId: payload.template.id, templateName: payload.template.name },
    });
  } else {
    const formatted = formatSmsFriendlyMessage(result.error, {
      phone: payload.phone,
      name: payload.name,
      houseNo: payload.houseNo,
    });
    await logAppEvent({
      level: 'error',
      category: 'sms',
      action: 'Send Invoice SMS',
      message: formatted.message,
      phone: payload.phone,
      houseNo: payload.houseNo,
      customerName: payload.name,
      collectionName: collection?.name,
      collectionId: params.collectionId,
      recordId: params.recordId,
      status: 'failed',
      error: result.error,
      details: {
        rawError: result.error,
        isInsufficientCredits: formatted.isInsufficientCredits,
        isInvalidPhone: formatted.isInvalidPhone,
        message: finalMessage,
        templateId: payload.template.id,
      },
    });
    return { error: formatted.message };
  }

  revalidatePath(`/collections/${params.collectionId}`);
  revalidatePath('/logs');
  revalidatePath('/');

  return { success: true };
}

export async function sendRecordsInvoiceSmsChunkAction(params: {
  recordIds: string[];
  collectionId: string;
  templateId?: string;
  plotName?: string;
  month?: string;
  customMessage?: string;
}) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized', successCount: 0, failCount: params.recordIds.length };

  await dbConnect();

  const collection = await Collection.findById(params.collectionId).lean();
  const fields = await Field.find({ collectionId: params.collectionId }).lean();

  const invoiceStatusField = fields.find((f) => ['INVOICE STATUS', 'INVOICE_STATUS'].includes(f.name.toUpperCase()));
  let statusFieldName = 'Invoice Status';
  if (!invoiceStatusField) {
    await Field.create({
      collectionId: params.collectionId,
      name: 'Invoice Status',
      type: 'text',
      required: false,
    });
  } else {
    statusFieldName = invoiceStatusField.name;
  }

  const effectiveTemplateId = params.templateId || (collection as any)?.defaultInvoiceTemplateId;
  const effectivePlotName = params.plotName || (collection as any)?.plotName;

  const records = await Record.find({ _id: { $in: params.recordIds } });
  const prepared: {
    recordId: string;
    phone: string;
    name: string;
    houseNo?: string;
    message: string;
    template: any;
  }[] = [];

  for (const record of records) {
    const recordDataObj =
      record.data instanceof Map ? Object.fromEntries(record.data) : (record.data as Record<string, any>);

    const payload = await buildRecordInvoiceSmsPayload(
      recordDataObj,
      fields,
      collection?.name,
      effectiveTemplateId,
      effectivePlotName,
      params.month,
      params.customMessage
    );

    const message = payload.message;

    prepared.push({
      recordId: record._id.toString(),
      phone: payload.phone,
      name: payload.name,
      houseNo: payload.houseNo,
      message,
      template: payload.template,
    });
  }

  const batchResults = await sendBatchSms(
    prepared.map((p) => ({
      correlator: p.recordId,
      phone: p.phone,
      message: p.message,
    }))
  );

  const resultMap = new Map(batchResults.map((r) => [r.correlator, r]));

  let successCount = 0;
  let failCount = 0;
  const errors: string[] = [];
  const bulkOps: any[] = [];
  const logEntries: any[] = [];

  for (const p of prepared) {
    const res = resultMap.get(p.recordId) || { success: false, error: 'Unknown delivery response' };
    const isSuccess = res.success;

    if (isSuccess) {
      successCount++;
      logEntries.push({
        timestamp: new Date(),
        level: 'success',
        category: 'sms',
        action: 'Bulk Invoice SMS',
        message: `Invoice SMS sent successfully to ${p.phone} for house #${p.houseNo || 'N/A'} (${p.name}) [${p.template.name}].`,
        phone: p.phone,
        houseNo: p.houseNo,
        customerName: p.name,
        collectionName: collection?.name,
        collectionId: params.collectionId,
        recordId: p.recordId,
        status: 'success',
        details: { messageId: res.messageId, message: p.message, templateId: p.template.id, templateName: p.template.name },
      });
    } else {
      failCount++;
      const formatted = formatSmsFriendlyMessage(res.error, {
        phone: p.phone,
        name: p.name,
        houseNo: p.houseNo,
      });
      errors.push(formatted.message);
      logEntries.push({
        timestamp: new Date(),
        level: 'error',
        category: 'sms',
        action: 'Bulk Invoice SMS',
        message: formatted.message,
        phone: p.phone,
        houseNo: p.houseNo,
        customerName: p.name,
        collectionName: collection?.name,
        collectionId: params.collectionId,
        recordId: p.recordId,
        status: 'failed',
        error: res.error,
        details: {
          rawError: res.error,
          isInsufficientCredits: formatted.isInsufficientCredits,
          isInvalidPhone: formatted.isInvalidPhone,
          message: p.message,
          templateId: p.template.id,
        },
      });
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: p.recordId },
        update: { $set: { [`data.${statusFieldName}`]: isSuccess ? 'sent' : 'failed' } },
      },
    });
  }

  if (bulkOps.length > 0) {
    await Record.bulkWrite(bulkOps);
  }
  if (logEntries.length > 0) {
    await AppLog.insertMany(logEntries);
  }

  revalidatePath(`/collections/${params.collectionId}`);
  revalidatePath('/logs');
  revalidatePath('/');

  return {
    success: failCount === 0,
    successCount,
    failCount,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export async function sendRecordsInvoiceSmsBulkAction(params: {
  recordIds: string[];
  collectionId: string;
  templateId?: string;
  plotName?: string;
  month?: string;
  customMessage?: string;
}) {
  const CHUNK_SIZE = 10;
  let totalSuccess = 0;
  let totalFail = 0;
  const allErrors: string[] = [];

  for (let i = 0; i < params.recordIds.length; i += CHUNK_SIZE) {
    const chunkIds = params.recordIds.slice(i, i + CHUNK_SIZE);
    const res = await sendRecordsInvoiceSmsChunkAction({
      recordIds: chunkIds,
      collectionId: params.collectionId,
      templateId: params.templateId,
      plotName: params.plotName,
      month: params.month,
      customMessage: params.customMessage,
    });

    if ('error' in res && res.error && !res.successCount) {
      totalFail += chunkIds.length;
      allErrors.push(res.error);
    } else {
      totalSuccess += res.successCount || 0;
      totalFail += res.failCount || 0;
      if (res.errors) allErrors.push(...res.errors);
    }
  }

  const collection = await Collection.findById(params.collectionId).lean();
  const effectiveTemplateId = params.templateId || (collection as any)?.defaultInvoiceTemplateId;
  const template = getInvoiceTemplate(effectiveTemplateId);

  await logAppEvent({
    level: totalFail === 0 ? 'success' : (totalSuccess > 0 ? 'warn' : 'error'),
    category: 'sms',
    action: 'Bulk Invoice SMS Summary',
    message: `Bulk Invoice SMS run completed for "${collection?.name || 'Collection'}": ${totalSuccess} sent, ${totalFail} failed. [${template.name}]`,
    collectionName: collection?.name,
    collectionId: params.collectionId,
    status: totalFail === 0 ? 'success' : 'failed',
    details: {
      totalAttempted: params.recordIds.length,
      successCount: totalSuccess,
      failCount: totalFail,
      templateId: template.id,
      templateName: template.name,
      sampleErrors: allErrors.slice(0, 5),
    },
  });

  return {
    success: totalFail === 0,
    successCount: totalSuccess,
    failCount: totalFail,
    errors: allErrors.length > 0 ? allErrors : undefined,
  };
}
