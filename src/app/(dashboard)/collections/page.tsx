import { getSession } from '@/lib/auth';
import { CollectionsClient } from './CollectionsClient';
import { getCollections } from '@/actions/collection.actions';

export default async function CollectionsPage() {
  const collections = await getCollections();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Collections</h1>
          <p className="text-muted-foreground">
            Workspaces for organising your data
          </p>
        </div>
      </div>

      <CollectionsClient collections={collections} />
    </div>
  );
}
