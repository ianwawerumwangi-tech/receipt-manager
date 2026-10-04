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
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  createCollection,
  deleteCollection,
} from '@/actions/collection.actions';
import { getDocumentTypeLabel, resolveCollectionType, DocumentType } from '@/lib/document-classifier';
import { Plus, Trash2, FolderOpen, FileText, Droplets, Receipt, FileCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { ImportDialog } from './ImportDialog';

interface CollectionItem {
  _id: string;
  name: string;
  description?: string;
  type?: 'rent_receipt' | 'water_bill' | 'invoice' | 'general';
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
  const [form, setForm] = useState<{ name: string; description: string; type: DocumentType }>({
    name: '',
    description: '',
    type: 'rent_receipt',
  });
  const [deleteTarget, setDeleteTarget] = useState<CollectionItem | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const res = await createCollection({
      name: form.name,
      description: form.description,
      type: form.type,
    });
    if (res.success) {
      toast.success('Collection created');
      setForm({ name: '', description: '', type: 'rent_receipt' });
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

  const getCollectionBadge = (type?: string, name?: string) => {
    const resolved = resolveCollectionType({ type, name });
    if (resolved === 'water_bill') {
      return (
        <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400 gap-1 text-[11px] font-medium">
          <Droplets className="h-3 w-3" />
          Water Bill
        </Badge>
      );
    }
    if (resolved === 'invoice') {
      return (
        <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 gap-1 text-[11px] font-medium">
          <FileCheck className="h-3 w-3" />
          Invoices
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 gap-1 text-[11px] font-medium">
        <Receipt className="h-3 w-3" />
        Rent Receipts
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <ImportDialog onSuccess={() => router.refresh()} />
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
                  placeholder="e.g. Anita Jan Receipts"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="type">Collection Type</Label>
                <Select
                  value={form.type}
                  onValueChange={(val) => { if (val) setForm({ ...form, type: val as DocumentType }); }}
                >
                  <SelectTrigger id="type">
                    <SelectValue placeholder="Select collection type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rent_receipt">Rent Receipts (Rent payments & receipts)</SelectItem>
                    <SelectItem value="water_bill">Water Bill (Meter readings & consumption)</SelectItem>
                    <SelectItem value="invoice">Invoices (Rent due notices)</SelectItem>
                    <SelectItem value="general">General</SelectItem>
                  </SelectContent>
                </Select>
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
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CardTitle className="text-lg">{collection.name}</CardTitle>
                      {getCollectionBadge(collection.type, collection.name)}
                    </div>
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
