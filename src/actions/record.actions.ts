'use server';

import { revalidatePath } from 'next/cache';
import { dbConnect } from '@/lib/mongodb';
import { Record } from '@/models/Record';
import { Field } from '@/models/Field';
import { getSession } from '@/lib/auth';
import { serialize, extractRecordInstallments } from '@/lib/utils';
import { sendSms } from '@/lib/sms';

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
  return { success: true };
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

  const fields = await Field.find({ collectionId }).lean();
  
  const nameField = fields.find(f => ['NAME', 'CUSTOMER NAME', 'CUSTOMER'].includes(f.name.toUpperCase()));
  const phoneField = fields.find(f => ['PHONE NO', 'PHONE', 'PHONE NUMBER', 'MOBILE'].includes(f.name.toUpperCase()));
  
  const amountFieldCandidates = ['RENT PAID', 'AMOUNT PAID', 'AMOUNT', 'DEPOSIT PAID'];
  let amountField = null;
  for (const candidate of amountFieldCandidates) {
    amountField = fields.find(f => f.name.toUpperCase() === candidate);
    if (amountField) break;
  }

  const rctField = fields.find(f => ['RCT NO', 'RECEIPT NUMBER', 'RECEIPT NO', 'RECEIPT'].includes(f.name.toUpperCase()));
  const balanceField = fields.find(f => ['BALANCE', 'BAL', 'OUTSTANDING'].includes(f.name.toUpperCase()));
  const smsStatusField = fields.find(f => ['SMS STATUS', 'SMS_STATUS'].includes(f.name.toUpperCase()));

  if (!phoneField) {
    return { error: 'Phone number field (e.g. "PHONE NO") not found in collection schema.' };
  }

  const recordDataObj = record.data instanceof Map ? Object.fromEntries(record.data) : (record.data as Record<string, any>);
  const phone = String(recordDataObj[phoneField.name] || '').trim();
  const name = String(recordDataObj[nameField?.name || ''] || 'Customer').trim();
  
  if (!phone) {
    return { error: 'Phone number is empty for this record.' };
  }

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

  const balanceVal = balanceField ? recordDataObj[balanceField.name] : null;
  const rawBal = (balanceVal !== undefined && balanceVal !== null && balanceVal !== '') ? parseMathExpression(balanceVal) : null;
  const displayBal = rawBal !== null ? Math.max(0, rawBal) : null;
  const balanceStr = displayBal !== null
    ? ` Your current balance is KES ${displayBal.toLocaleString()}.`
    : '';

  let installmentsToSend: { amount: number; rct: string }[] = [];
  if (installment) {
    installmentsToSend = [installment];
  } else {
    installmentsToSend = extractRecordInstallments(recordDataObj, fields);
    if (installmentsToSend.length === 0) {
      const defaultAmount = amountField ? parseMathExpression(recordDataObj[amountField.name]) : 0;
      const defaultRct = String(rctField ? recordDataObj[rctField.name] || '' : '').trim();
      installmentsToSend = [{ amount: defaultAmount, rct: defaultRct }];
    }
  }

  let allSuccess = true;
  let lastError = '';

  for (const inst of installmentsToSend) {
    const message = `Dear ${name}, We have received your payment of KES ${inst.amount.toLocaleString()}. Receipt No: ${inst.rct}.${balanceStr} Thank you.`;
    const result = await sendSms(phone, message);
    if (!result.success) {
      allSuccess = false;
      lastError = result.error || 'Failed to send SMS';
    }
  }

  record.data.set(statusFieldName, allSuccess ? 'sent' : 'failed');
  record.markModified('data');
  await record.save();

  revalidatePath(`/collections/${collectionId}`);

  if (!allSuccess) {
    return { error: lastError || 'Failed to send SMS' };
  }

  return { success: true, count: installmentsToSend.length };
}

export async function sendRecordsSmsBulkAction(recordIds: string[], collectionId: string) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  await dbConnect();

  const fields = await Field.find({ collectionId }).lean();
  const nameField = fields.find(f => ['NAME', 'CUSTOMER NAME', 'CUSTOMER'].includes(f.name.toUpperCase()));
  const phoneField = fields.find(f => ['PHONE NO', 'PHONE', 'PHONE NUMBER', 'MOBILE'].includes(f.name.toUpperCase()));
  
  const amountFieldCandidates = ['RENT PAID', 'AMOUNT PAID', 'AMOUNT', 'DEPOSIT PAID'];
  let amountField = null;
  for (const candidate of amountFieldCandidates) {
    amountField = fields.find(f => f.name.toUpperCase() === candidate);
    if (amountField) break;
  }

  const rctField = fields.find(f => ['RCT NO', 'RECEIPT NUMBER', 'RECEIPT NO', 'RECEIPT'].includes(f.name.toUpperCase()));
  const balanceField = fields.find(f => ['BALANCE', 'BAL', 'OUTSTANDING'].includes(f.name.toUpperCase()));
  const smsStatusField = fields.find(f => ['SMS STATUS', 'SMS_STATUS'].includes(f.name.toUpperCase()));

  if (!phoneField) {
    return { error: 'Phone number field (e.g. "PHONE NO") not found in collection schema.' };
  }

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

  // Process in concurrent batches of 5 to avoid Vercel timeouts & speed up requests
  const BATCH_SIZE = 5;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE);

    await Promise.all(
      chunk.map(async (record) => {
        const recordDataObj =
          record.data instanceof Map
            ? Object.fromEntries(record.data)
            : (record.data as Record<string, any>);

        const phone = String(recordDataObj[phoneField.name] || '').trim();
        const name = String(recordDataObj[nameField?.name || ''] || 'Customer').trim();

        if (!phone) {
          record.data.set(statusFieldName, 'failed');
          record.markModified('data');
          await record.save();
          failCount++;
          errors.push(`${name}: Phone number is empty.`);
          return;
        }

        let installments = extractRecordInstallments(recordDataObj, fields);

        if (installments.length === 0) {
          const defaultAmount = amountField ? parseMathExpression(recordDataObj[amountField.name]) : 0;
          const defaultRct = String(rctField ? recordDataObj[rctField.name] || '' : '').trim();
          installments = [{ amount: defaultAmount, rct: defaultRct }];
        }

        const balanceVal = balanceField ? recordDataObj[balanceField.name] : null;
        const rawBal =
          balanceVal !== undefined && balanceVal !== null && balanceVal !== ''
            ? parseMathExpression(balanceVal)
            : null;
        const displayBal = rawBal !== null ? Math.max(0, rawBal) : null;
        const balanceStr =
          displayBal !== null ? ` Your current balance is KES ${displayBal.toLocaleString()}.` : '';

        let recordSuccess = true;

        for (const inst of installments) {
          const message = `Dear ${name}, We have received your payment of KES ${inst.amount.toLocaleString()}. Receipt No: ${inst.rct}.${balanceStr} Thank you.`;
          const result = await sendSms(phone, message);

          if (result.success) {
            successCount++;
          } else {
            recordSuccess = false;
            failCount++;
            errors.push(`${name} (${phone}): ${result.error || 'Unknown error'}`);
          }
        }

        record.data.set(statusFieldName, recordSuccess ? 'sent' : 'failed');
        record.markModified('data');
        await record.save();
      })
    );
  }

  revalidatePath(`/collections/${collectionId}`);
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
  return { success: true };
}
