'use server';

import { revalidatePath } from 'next/cache';
import { dbConnect } from '@/lib/mongodb';
import { Field } from '@/models/Field';
import { getSession } from '@/lib/auth';
import { serialize } from '@/lib/utils';

export async function getFields(collectionId: string) {
  const session = await getSession();
  if (!session) return [];

  await dbConnect();
  const fields = await Field.find({ collectionId })
    .sort({ order: 1 })
    .lean();

  return serialize(
    fields.map((f) => ({
      ...f,
      _id: f._id.toString(),
      collectionId: f.collectionId.toString(),
      targetCollectionId: f.targetCollectionId ? f.targetCollectionId.toString() : undefined,
    }))
  );
}

export async function createField(data: {
  collectionId: string;
  name: string;
  type: string;
  required: boolean;
  targetCollectionId?: string;
}) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  await dbConnect();
  const maxOrder = await Field.findOne({ collectionId: data.collectionId })
    .sort({ order: -1 })
    .select('order')
    .lean();

  await Field.create({
    collectionId: data.collectionId,
    name: data.name,
    type: data.type,
    required: data.required,
    order: (maxOrder?.order ?? -1) + 1,
    ...(data.targetCollectionId ? { targetCollectionId: data.targetCollectionId } : {}),
  });

  revalidatePath(`/collections/${data.collectionId}`);
  return { success: true };
}

export async function updateField(id: string, collectionId: string, data: { name?: string; type?: string; required?: boolean; targetCollectionId?: string | null }) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  await dbConnect();
  const updateData: Record<string, unknown> = { ...data };
  if (data.targetCollectionId === null) {
    updateData.targetCollectionId = null;
  }
  await Field.findByIdAndUpdate(id, updateData);
  revalidatePath(`/collections/${collectionId}`);
  return { success: true };
}

export async function deleteField(id: string, collectionId: string) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  await dbConnect();
  await Field.findByIdAndDelete(id);
  revalidatePath(`/collections/${collectionId}`);
  return { success: true };
}
