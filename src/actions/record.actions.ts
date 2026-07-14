'use server';

import { revalidatePath } from 'next/cache';
import { dbConnect } from '@/lib/mongodb';
import { Record } from '@/models/Record';
import { Field } from '@/models/Field';
import { getSession } from '@/lib/auth';
import { serialize } from '@/lib/utils';
import { sendSms } from '@/lib/sms';

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
        [`data.${fieldName}`]: generated,
      });
      if (!existing) {
        isUnique = true;
      }
    }
    fieldData[fieldName] = generated;
    return {};
  }

  // Validate length (must be 10 characters)
  if (val.length !== 10 || !/^[A-Z0-9]+$/.test(val)) {
    return {
      error: `Receipt number "${val}" must be exactly 10 uppercase alphanumeric characters (e.g. M-Pesa code).`,
    };
  }

  // Validate uniqueness
  const query: Record<string, any> = {
    collectionId,
    [`data.${fieldName}`]: val,
  };
  if (recordId) {
    query._id = { $ne: recordId };
  }

  const existing = await Record.findOne(query);
  if (existing) {
    return {
      error: `Receipt number "${val}" is already used in another record. It must be unique.`,
    };
  }

  fieldData[fieldName] = val; // save clean trimmed uppercase value
  return {};
}

export async function getRecords(collectionId: string) {
  const session = await getSession();
  if (!session) return [];

  await dbConnect();
  const records = await Record.find({ collectionId })
    .sort({ createdAt: -1 })
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

  await Record.create({
    collectionId: data.collectionId,
    data: data.fieldData,
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
    .sort({ createdAt: -1 })
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

export async function sendRecordSmsAction(recordId: string, collectionId: string) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  await dbConnect();
  
  const record = await Record.findById(recordId);
  if (!record) return { error: 'Record not found' };

  const fields = await Field.find({ collectionId }).lean();
  
  // Find name, phone, amount, and receipt number fields
  const nameField = fields.find(f => ['NAME', 'CUSTOMER NAME', 'CUSTOMER'].includes(f.name.toUpperCase()));
  const phoneField = fields.find(f => ['PHONE NO', 'PHONE', 'PHONE NUMBER', 'MOBILE'].includes(f.name.toUpperCase()));
  const amountField = fields.find(f => ['RENT PAID', 'AMOUNT PAID', 'AMOUNT', 'DEPOSIT PAID'].includes(f.name.toUpperCase()));
  const rctField = fields.find(f => ['RCT NO', 'RECEIPT NUMBER', 'RECEIPT NO', 'RECEIPT'].includes(f.name.toUpperCase()));
  const smsStatusField = fields.find(f => ['SMS STATUS', 'SMS_STATUS'].includes(f.name.toUpperCase()));

  if (!phoneField) {
    return { error: 'Phone number field (e.g. "PHONE NO") not found in collection schema.' };
  }

  const phone = String(record.data.get(phoneField.name) || '').trim();
  const name = String(record.data.get(nameField?.name || '') || 'Customer').trim();
  const amount = Number(record.data.get(amountField?.name || '') || 0);
  const rct = String(record.data.get(rctField?.name || '') || '').trim();

  if (!phone) {
    return { error: 'Phone number is empty for this record.' };
  }

  const message = `Dear ${name}, We have received your payment of KES ${amount.toLocaleString()}. Receipt No: ${rct}. Thank you.`;

  const result = await sendSms(phone, message);

  // If SMS Status field doesn't exist, dynamically add it to the schema
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

  // Update record's data map
  record.data.set(statusFieldName, result.success ? 'sent' : 'failed');
  await record.save();

  revalidatePath(`/collections/${collectionId}`);

  if (!result.success) {
    return { error: result.error || 'Failed to send SMS' };
  }

  return { success: true };
}

export async function sendRecordsSmsBulkAction(recordIds: string[], collectionId: string) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  await dbConnect();

  const fields = await Field.find({ collectionId }).lean();
  const nameField = fields.find(f => ['NAME', 'CUSTOMER NAME', 'CUSTOMER'].includes(f.name.toUpperCase()));
  const phoneField = fields.find(f => ['PHONE NO', 'PHONE', 'PHONE NUMBER', 'MOBILE'].includes(f.name.toUpperCase()));
  const amountField = fields.find(f => ['RENT PAID', 'AMOUNT PAID', 'AMOUNT', 'DEPOSIT PAID'].includes(f.name.toUpperCase()));
  const rctField = fields.find(f => ['RCT NO', 'RECEIPT NUMBER', 'RECEIPT NO', 'RECEIPT'].includes(f.name.toUpperCase()));
  const smsStatusField = fields.find(f => ['SMS STATUS', 'SMS_STATUS'].includes(f.name.toUpperCase()));

  if (!phoneField) {
    return { error: 'Phone number field (e.g. "PHONE NO") not found in collection schema.' };
  }

  // Check or create SMS Status field
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

  for (const record of records) {
    const phone = String(record.data.get(phoneField.name) || '').trim();
    const name = String(record.data.get(nameField?.name || '') || 'Customer').trim();
    const amount = Number(record.data.get(amountField?.name || '') || 0);
    const rct = String(record.data.get(rctField?.name || '') || '').trim();

    if (!phone) {
      record.data.set(statusFieldName, 'failed');
      await record.save();
      failCount++;
      errors.push(`${name}: Phone number is empty.`);
      continue;
    }

    const message = `Dear ${name}, We have received your payment of KES ${amount.toLocaleString()}. Receipt No: ${rct}. Thank you.`;
    const result = await sendSms(phone, message);

    record.data.set(statusFieldName, result.success ? 'sent' : 'failed');
    await record.save();

    if (result.success) {
      successCount++;
    } else {
      failCount++;
      errors.push(`${name} (${phone}): ${result.error || 'Unknown error'}`);
    }
  }

  revalidatePath(`/collections/${collectionId}`);
  return { success: true, successCount, failCount, errors: errors.length > 0 ? errors : undefined };
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

  // Insert all records
  const newRecords = recordsData.map((fieldData) => ({
    collectionId,
    data: fieldData,
    createdBy: session.userId,
  }));

  if (newRecords.length > 0) {
    await Record.insertMany(newRecords);
  }

  revalidatePath(`/collections/${collectionId}`);
  return { success: true };
}
