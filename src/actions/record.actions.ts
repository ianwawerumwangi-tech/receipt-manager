'use server';

import { revalidatePath } from 'next/cache';
import { dbConnect } from '@/lib/mongodb';
import { Collection } from '@/models/Collection';
import { Record } from '@/models/Record';
import { Field } from '@/models/Field';
import { getSession } from '@/lib/auth';
import { serialize, extractRecordInstallments } from '@/lib/utils';
import { sendSms, buildSmsTemplate, buildWaterBillSmsTemplate } from '@/lib/sms';

function parseMathExpression(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
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

  // Validate each part of the slash-separated receipt numbers
  const parts = val.split('/').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return {
      error: `Receipt number cannot be empty.`,
    };
  }

  for (const part of parts) {
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

  // Validate all drafts before committing
  for (const update of updates) {
    const valRes = await validateAndFormatReceiptNumber(collectionId, update.id, update.data);
    if (valRes.error) {
      return { error: valRes.error };
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

async function buildRecordSmsPayload(
  recordDataObj: Record<string, any>,
  fields: any[],
  collectionName?: string
) {
  // Name
  const nameFieldCandidates = ['NAME', 'CUSTOMER NAME', 'CUSTOMER', 'TENANT', 'CLIENT NAME', 'CLIENT'];
  const nameField = fields.find(f => nameFieldCandidates.includes(f.name.toUpperCase()));
  const name = String(recordDataObj[nameField?.name || ''] || 'Customer').trim();

  // Phone
  const phoneFieldCandidates = ['PHONE NO', 'PHONE', 'PHONE NUMBER', 'MOBILE'];
  const phoneField = fields.find(f => phoneFieldCandidates.includes(f.name.toUpperCase()));
  const phone = String(recordDataObj[phoneField?.name || ''] || '').trim();

  // Check if collection is a Water Bill collection based on fields or name
  const isWaterBill = fields.some(f => 
    ['PREVIOUS', 'PREV', 'CURRENT', 'CURR', 'CONSUMPTION', 'WATER BILL', 'TOTAL BILL'].includes(f.name.toUpperCase())
  ) || (collectionName && collectionName.toUpperCase().includes('WATER'));

  // Month
  const monthFieldCandidates = ['MONTH OF RECEIPT', 'MONTH', 'FOR MONTH', 'FOR THE MONTH OF', 'PERIOD', 'RECEIPT MONTH', 'BILL MONTH'];
  const monthField = fields.find(f => monthFieldCandidates.includes(f.name.toUpperCase()));
  let monthStr = String(recordDataObj[monthField?.name || ''] || '').trim();

  if (!monthStr && collectionName) {
    const months = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const upperColl = collectionName.toUpperCase();
    for (const m of months) {
      if (upperColl.includes(m)) {
        const yearMatch = upperColl.match(/20\d\d/);
        monthStr = yearMatch ? `${m} ${yearMatch[0]}` : m;
        break;
      }
    }
    if (!monthStr) {
      monthStr = collectionName;
    }
  }

  if (!monthStr) {
    const now = new Date();
    monthStr = now.toLocaleString('default', { month: 'long', year: 'numeric' });
  }

  if (isWaterBill) {
    // Previous Amount
    const prevField = fields.find(f => ['PREVIOUS', 'PREV', 'PREVIOUS READING', 'PREV READING', 'PREV READ'].includes(f.name.toUpperCase()));
    const prevVal = prevField ? parseMathExpression(recordDataObj[prevField.name]) : 0;

    // Current Amount
    const currField = fields.find(f => ['CURRENT', 'CURR', 'CURRENT READING', 'CURR READING', 'CURR READ'].includes(f.name.toUpperCase()));
    const currVal = currField ? parseMathExpression(recordDataObj[currField.name]) : 0;

    // Total Amount
    const totalFieldCandidates = ['TOTAL BILL', 'WATER BILL', 'TOTAL', 'TOTAL AMOUNT', 'AMOUNT DUE', 'AMOUNT'];
    let totalField = null;
    for (const cand of totalFieldCandidates) {
      totalField = fields.find(f => f.name.toUpperCase() === cand);
      if (totalField) break;
    }
    const totalVal = totalField ? parseMathExpression(recordDataObj[totalField.name]) : 0;

    // Amount per unit
    const rateFieldCandidates = ['PER UNIT', 'RATE', 'UNIT RATE', 'AMOUNT PER UNIT', 'PRICE PER UNIT'];
    let rateField = null;
    for (const cand of rateFieldCandidates) {
      rateField = fields.find(f => f.name.toUpperCase() === cand);
      if (rateField) break;
    }

    let rateVal = rateField ? parseMathExpression(recordDataObj[rateField.name]) : 0;
    if (!rateVal) {
      const consumptionField = fields.find(f => ['CONSUMPTION', 'UNITS', 'UNITS USED'].includes(f.name.toUpperCase()));
      const consumption = consumptionField ? parseMathExpression(recordDataObj[consumptionField.name]) : (currVal - prevVal);
      if (consumption > 0 && totalVal > 0) {
        rateVal = Math.round(totalVal / consumption);
      } else {
        rateVal = 150; // default rate per unit if non-calculable
      }
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
  const houseField = fields.find(f => houseFieldCandidates.includes(f.name.toUpperCase()));
  const houseNumber = String(recordDataObj[houseField?.name || ''] || 'N/A').trim();

  const installments = extractRecordInstallments(recordDataObj, fields);
  let totalAmount = 0;
  if (installments.length > 0) {
    totalAmount = installments.reduce((sum, inst) => sum + (Number(inst.amount) || 0), 0);
  } else {
    const amountFieldCandidates = ['RENT PAID', 'AMOUNT PAID', 'AMOUNT', 'DEPOSIT PAID', 'PAID', 'TOTAL PAID', 'TOTAL AMOUNT'];
    let amountField = null;
    for (const candidate of amountFieldCandidates) {
      amountField = fields.find(f => f.name.toUpperCase() === candidate);
      if (amountField) break;
    }
    totalAmount = amountField ? parseMathExpression(recordDataObj[amountField.name]) : 0;
  }

  const balanceFieldCandidates = ['BALANCE', 'BAL', 'OUTSTANDING', 'BAL B/F', 'BAL C/F', 'BAL B/D', 'BAL C/D', 'CURRENT BALANCE'];
  const balanceField = fields.find(f => balanceFieldCandidates.includes(f.name.toUpperCase()));
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
  const payload = await buildRecordSmsPayload(recordDataObj, fields, collection?.name);

  if (!payload.phoneFieldFound) {
    return { error: 'Phone number field (e.g. "PHONE NO") not found in collection schema.' };
  }

  if (!payload.phone) {
    return { error: 'Phone number is empty for this record.' };
  }

  const result = await sendSms(payload.phone, payload.message);

  record.data.set(statusFieldName, result.success ? 'sent' : 'failed');
  record.markModified('data');
  await record.save();

  revalidatePath(`/collections/${collectionId}`);
  revalidatePath('/');

  if (!result.success) {
    return { error: result.error || 'Failed to send SMS' };
  }

  return { success: true, count: 1 };
}

export async function sendRecordsSmsBulkAction(recordIds: string[], collectionId: string) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  await dbConnect();

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

  const records = await Record.find({ _id: { $in: recordIds } });
  let successCount = 0;
  let failCount = 0;
  const errors: string[] = [];

  const BATCH_SIZE = 5;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE);

    await Promise.all(
      chunk.map(async (record) => {
        const recordDataObj =
          record.data instanceof Map
            ? Object.fromEntries(record.data)
            : (record.data as Record<string, any>);

        const payload = await buildRecordSmsPayload(recordDataObj, fields, collection?.name);

        if (!payload.phone) {
          record.data.set(statusFieldName, 'failed');
          record.markModified('data');
          await record.save();
          failCount++;
          errors.push(`${payload.name}: Phone number is empty.`);
          return;
        }

        const result = await sendSms(payload.phone, payload.message);

        if (result.success) {
          successCount++;
        } else {
          failCount++;
          errors.push(`${payload.name} (${payload.phone}): ${result.error || 'Unknown error'}`);
        }

        record.data.set(statusFieldName, result.success ? 'sent' : 'failed');
        record.markModified('data');
        await record.save();
      })
    );
  }

  revalidatePath(`/collections/${collectionId}`);
  revalidatePath('/');
  return {
    success: failCount === 0,
    successCount,
    failCount,
    errors: errors.length > 0 ? errors : undefined,
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
