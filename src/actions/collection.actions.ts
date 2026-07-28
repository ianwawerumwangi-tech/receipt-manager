'use server';

import { revalidatePath } from 'next/cache';
import { dbConnect } from '@/lib/mongodb';
import { Collection } from '@/models/Collection';
import { Field } from '@/models/Field';
import { Record as RecordModel } from '@/models/Record';
import { getSession } from '@/lib/auth';
import { serialize } from '@/lib/utils';

export async function getCollections() {
  const session = await getSession();
  if (!session) return [];

  await dbConnect();
  const collections = await Collection.find({ createdBy: session.userId })
    .sort({ createdAt: -1 })
    .lean();

  const result = await Promise.all(
    collections.map(async (col) => {
      const fieldCount = await Field.countDocuments({ collectionId: col._id });
      const recordCount = await RecordModel.countDocuments({ collectionId: col._id });
      return {
        ...col,
        _id: col._id.toString(),
        createdBy: col.createdBy.toString(),
        fieldCount,
        recordCount,
      };
    })
  );

  return serialize(result);
}

export async function createCollection(data: { name: string; description?: string }) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  await dbConnect();
  const collection = await Collection.create({
    name: data.name,
    description: data.description || '',
    createdBy: session.userId,
  });

  revalidatePath('/collections');
  return { success: true, _id: collection._id.toString() };
}

export async function updateCollection(id: string, data: { name: string; description?: string }) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  await dbConnect();
  await Collection.findByIdAndUpdate(id, data);
  revalidatePath('/collections');
  revalidatePath(`/collections/${id}`);
  return { success: true };
}

export async function deleteCollection(id: string) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  await dbConnect();
  await Promise.all([
    Collection.findByIdAndDelete(id),
    Field.deleteMany({ collectionId: id }),
    RecordModel.deleteMany({ collectionId: id }),
  ]);
  revalidatePath('/collections');
  return { success: true };
}

export async function getCollection(id: string) {
  const session = await getSession();
  if (!session) return null;

  await dbConnect();
  const collection = await Collection.findById(id).lean();
  if (!collection) return null;

  const fieldCount = await Field.countDocuments({ collectionId: id });
  const recordCount = await RecordModel.countDocuments({ collectionId: id });

  return serialize({
    ...collection,
    _id: collection._id.toString(),
    createdBy: collection.createdBy.toString(),
    fieldCount,
    recordCount,
  });
}
