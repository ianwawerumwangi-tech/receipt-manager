'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  createCollection,
  deleteCollection,
} from '@/actions/collection.actions';
import { Plus, Trash2, FolderOpen, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

interface CollectionItem {
  _id: string;
  name: string;
  description?: string;
  fieldCount: number;
  recordCount: number;
}

export function CollectionsClient({
  collections,
}: {
  collections: CollectionItem[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [deleteTarget, setDeleteTarget] = useState<CollectionItem | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const res = await createCollection({ name: form.name, description: form.description });
    if (res.success) {
      toast.success('Collection created');
      setForm({ name: '', description: '' });
      setOpen(false);
      router.refresh();
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const res = await deleteCollection(deleteTarget._id);
    if (res.success) {
      toast.success('Collection deleted');
      setDeleteTarget(null);
      router.refresh();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button><Plus className="h-4 w-4 mr-2" />New Collection</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Collection</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Collection Name</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Inventory, Employee Records"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">Description (optional)</Label>
                <Textarea
                  id="desc"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="What is this collection for?"
                />
              </div>
              <Button type="submit" className="w-full">
                Create Collection
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {collections.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FolderOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium">No collections yet</p>
          <p className="text-sm">Create your first collection to get started</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((collection) => (
            <Card key={collection._id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{collection.name}</CardTitle>
                    {collection.description && (
                      <CardDescription className="mt-1">
                        {collection.description}
                      </CardDescription>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteTarget(collection)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                  <span className="flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5" />
                    {collection.fieldCount} fields
                  </span>
                  <span className="flex items-center gap-1">
                    <FolderOpen className="h-3.5 w-3.5" />
                    {collection.recordCount} records
                  </span>
                </div>
                <Link href={`/collections/${collection._id}`}>
                  <Button variant="secondary" className="w-full">
                    Open Collection
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        onConfirm={handleDelete}
        title="Delete Collection"
        message={`Delete "${deleteTarget?.name}" and all its data? This cannot be undone.`}
        confirmLabel="Delete"
      />
    </div>
  );
}
