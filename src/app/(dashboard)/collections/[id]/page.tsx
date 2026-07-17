import { getSession } from '@/lib/auth';
import { CollectionViewClient } from './CollectionViewClient';
import { getCollection } from '@/actions/collection.actions';
import { getFields } from '@/actions/field.actions';
import { getRecords } from '@/actions/record.actions';
import { notFound } from 'next/navigation';

export default async function CollectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const collection = await getCollection(id);
  if (!collection) notFound();

  const [fields, records] = await Promise.all([
    getFields(id),
    getRecords(id),
  ]);

  return (
    <div className="space-y-6">
      <CollectionViewClient
        collection={collection}
        fields={fields}
        records={records}
      />
    </div>
  );
}
