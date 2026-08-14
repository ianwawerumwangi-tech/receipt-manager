'use server';

import { revalidatePath } from 'next/cache';
import { dbConnect } from '@/lib/mongodb';
import { Customer } from '@/models/Customer';
import { getSession } from '@/lib/auth';
import { serialize } from '@/lib/utils';

export async function getCustomers() {
  await dbConnect();
  const customers = await Customer.find().sort({ name: 1 }).lean();
  return serialize(customers.map((c) => ({ ...c, _id: c._id.toString() })));
}

export async function createCustomer(data: {
  name: string;
  phone: string;
  email?: string;
  nationalId?: string;
  notes?: string;
}) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  await dbConnect();
  await Customer.create(data);
  revalidatePath('/customers');
  return { success: true };
}

export async function updateCustomer(id: string, data: {
  name: string;
  phone: string;
  email?: string;
  nationalId?: string;
  notes?: string;
}) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  await dbConnect();
  await Customer.findByIdAndUpdate(id, data);
  revalidatePath('/customers');
  return { success: true };
}

export async function deleteCustomer(id: string) {
  const session = await getSession();
  if (!session || session.role !== 'admin') return { error: 'Unauthorized' };

  await dbConnect();
  await Customer.findByIdAndDelete(id);
  revalidatePath('/customers');
  return { success: true };
}

export async function bulkLookupTenantPhones(
  entries?: { name?: string; houseNo?: string }[]
): Promise<Map<string, string>> {
  await dbConnect();
  const phoneMap = new Map<string, string>();

  // 1. Fetch all Customers
  const customers = await Customer.find({ phone: { $exists: true, $ne: '' } }).lean();
  for (const c of customers) {
    if (c.name && c.phone) {
      const cleanName = c.name.trim().toUpperCase();
      const cleanPhone = String(c.phone).trim();
      if (cleanPhone) {
        phoneMap.set(cleanName, cleanPhone);
      }
    }
  }

  // 2. Fetch all Records with Phone numbers across all Collections
  const RecordModel = (await import('@/models/Record')).Record;
  const records = await RecordModel.find().lean();
  const phoneKeys = ['PHONE NO', 'PHONE', 'PHONE NUMBER', 'MOBILE'];
  const nameKeys = ['NAME', 'CUSTOMER NAME', 'CUSTOMER', 'TENANT', 'CLIENT NAME'];

  for (const rec of records) {
    const data = rec.data instanceof Map ? Object.fromEntries(rec.data) : (rec.data as Record<string, any>);
    if (!data) continue;

    let phoneVal = '';
    for (const pKey of phoneKeys) {
      const v = String(data[pKey] || '').trim();
      if (v && v.replace(/\D/g, '').length >= 9) {
        phoneVal = v;
        break;
      }
    }
    if (!phoneVal) continue;

    let nameVal = '';
    for (const nKey of nameKeys) {
      const v = String(data[nKey] || '').trim().toUpperCase();
      if (v) {
        nameVal = v;
        break;
      }
    }

    if (nameVal && !phoneMap.has(nameVal)) {
      phoneMap.set(nameVal, phoneVal);
    }
  }

  return phoneMap;
}

export async function lookupTenantPhone(name?: string, houseNo?: string): Promise<string | null> {
  const map = await bulkLookupTenantPhones();
  if (name) {
    const cleanName = name.trim().toUpperCase();
    if (map.has(cleanName)) return map.get(cleanName)!;
    
    // Partial search
    for (const [k, v] of map.entries()) {
      if (k.includes(cleanName) || cleanName.includes(k)) {
        return v;
      }
    }

    // Name parts matching (e.g. first and last name)
    const nameParts = cleanName.split(/\s+/).filter(p => p.length >= 3);
    for (const part of nameParts) {
      for (const [k, v] of map.entries()) {
        if (k.includes(part)) {
          return v;
        }
      }
    }
  }
  return null;
}
