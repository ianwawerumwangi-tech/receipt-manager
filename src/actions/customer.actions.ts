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
