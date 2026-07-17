'use server';

import { revalidatePath } from 'next/cache';
import { dbConnect } from '@/lib/mongodb';
import { User } from '@/models/User';
import { getSession, hashPassword } from '@/lib/auth';
import { serialize } from '@/lib/utils';

export async function getUsers() {
  const session = await getSession();
  if (!session || session.role !== 'admin') return { error: 'Unauthorized' };

  await dbConnect();
  const users = await User.find().select('-password').sort({ name: 1 }).lean();
  return serialize(users.map((u) => ({ ...u, _id: u._id.toString() })));
}

export async function createUser(data: {
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'staff';
}) {
  const session = await getSession();
  if (!session || session.role !== 'admin') return { error: 'Unauthorized' };

  await dbConnect();
  await User.create({
    name: data.name,
    email: data.email,
    password: await hashPassword(data.password),
    role: data.role,
  });
  revalidatePath('/users');
  return { success: true };
}

export async function deleteUser(id: string) {
  const session = await getSession();
  if (!session || session.role !== 'admin') return { error: 'Unauthorized' };

  await dbConnect();
  await User.findByIdAndDelete(id);
  revalidatePath('/users');
  return { success: true };
}
