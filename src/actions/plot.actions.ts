'use server';

import { revalidatePath } from 'next/cache';
import { dbConnect } from '@/lib/mongodb';
import { Plot } from '@/models/Plot';
import { getSession } from '@/lib/auth';
import { serialize } from '@/lib/utils';

export async function getPlots() {
  await dbConnect();
  const plots = await Plot.find().populate('customer', 'name phone').sort({ plotNumber: 1 }).lean();
  return serialize(plots.map((p) => ({
    ...p,
    _id: p._id.toString(),
    customer: p.customer ? { ...(p.customer as any), _id: (p.customer as any)._id.toString() } : null,
  })));
}

export async function getAvailablePlots() {
  await dbConnect();
  const plots = await Plot.find({ status: 'available' }).sort({ plotNumber: 1 }).lean();
  return serialize(plots.map((p) => ({ ...p, _id: p._id.toString() })));
}

export async function createPlot(data: {
  plotNumber: string;
  project: string;
  location: string;
  size: number;
  price: number;
}) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  await dbConnect();
  await Plot.create(data);
  revalidatePath('/plots');
  return { success: true };
}

export async function updatePlot(id: string, data: {
  plotNumber: string;
  project: string;
  location: string;
  size: number;
  price: number;
  status: 'available' | 'reserved' | 'sold';
}) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  await dbConnect();
  await Plot.findByIdAndUpdate(id, data);
  revalidatePath('/plots');
  return { success: true };
}

export async function deletePlot(id: string) {
  const session = await getSession();
  if (!session || session.role !== 'admin') return { error: 'Unauthorized' };

  await dbConnect();
  await Plot.findByIdAndDelete(id);
  revalidatePath('/plots');
  return { success: true };
}
