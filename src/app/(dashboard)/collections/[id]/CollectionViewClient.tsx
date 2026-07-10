'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  createField,
  updateField,
  deleteField,
} from '@/actions/field.actions';
import {
  createRecord,
  updateRecord,
  deleteRecord,
  getCollectionRecords,
} from '@/actions/record.actions';
import {
  updateCollection,
  getCollections,
} from '@/actions/collection.actions';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Plus,
  Pencil,
  Trash2,
  ChevronLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type FieldType = 'text' | 'number' | 'date' | 'boolean' | 'textarea' | 'email' | 'phone' | 'relation';

interface CollectionItem {
  _id: string;
  name: string;
  description?: string;
  fieldCount: number;
  recordCount: number;
}

interface FieldItem {
  _id: string;
  collectionId: string;
  name: string;
  type: FieldType;
  required: boolean;
  order: number;
  targetCollectionId?: string;
}

interface RecordItem {
  _id: string;
  collectionId: string;
  data: Record<string, unknown>;
  createdAt: string;
}

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Yes/No' },
  { value: 'textarea', label: 'Long Text' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'relation', label: 'Relation' },
];

export function CollectionViewClient({
  collection,
  fields,
  records,
}: {
  collection: CollectionItem;
  fields: FieldItem[];
  records: RecordItem[];
}) {
  const router = useRouter();

  const [fieldDialogOpen, setFieldDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<FieldItem | null>(null);
  const [fieldForm, setFieldForm] = useState<{ name: string; type: FieldType; required: boolean; targetCollectionId?: string }>({ name: '', type: 'text', required: false });
  const [allCollections, setAllCollections] = useState<{ _id: string; name: string }[]>([]);

  const [recordDialogOpen, setRecordDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<RecordItem | null>(null);
  const [recordForm, setRecordForm] = useState<Record<string, unknown>>({});
  const [relationRecords, setRelationRecords] = useState<Record<string, { _id: string; data: Record<string, unknown> }[]>>({});

  const [editNameOpen, setEditNameOpen] = useState(false);
  const [nameForm, setNameForm] = useState({ name: collection.name, description: collection.description || '' });
  const [deleteFieldTarget, setDeleteFieldTarget] = useState<FieldItem | null>(null);
  const [deleteRecordTarget, setDeleteRecordTarget] = useState<RecordItem | null>(null);

  useEffect(() => {
    if (fieldDialogOpen) {
      getCollections().then(setAllCollections);
    }
  }, [fieldDialogOpen]);

  const loadRelationRecords = useCallback(async (relationFields: FieldItem[]) => {
    const targets = relationFields.filter((f) => f.type === 'relation' && f.targetCollectionId);
    if (targets.length === 0) return;
    const entries = await Promise.all(
      targets.map(async (f) => {
        const recs = await getCollectionRecords(f.targetCollectionId!);
        return [f._id, recs] as const;
      })
    );
    setRelationRecords(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    if (recordDialogOpen) {
      loadRelationRecords(fields);
    }
  }, [recordDialogOpen, fields, loadRelationRecords]);

  const resetFieldForm = () => {
    setFieldForm({ name: '', type: 'text', required: false });
    setEditingField(null);
  };

  const handleFieldSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fieldForm.name.trim()) return;

    if (editingField) {
      const res = await updateField(editingField._id, collection._id, fieldForm);
      if (res.success) {
        toast.success('Field updated');
        setFieldDialogOpen(false);
        resetFieldForm();
        router.refresh();
      }
    } else {
      const res = await createField({
        collectionId: collection._id,
        name: fieldForm.name,
        type: fieldForm.type,
        required: fieldForm.required,
        targetCollectionId: fieldForm.type === 'relation' ? fieldForm.targetCollectionId : undefined,
      });
      if (res.success) {
        toast.success('Field created');
        setFieldDialogOpen(false);
        resetFieldForm();
        router.refresh();
      }
    }
  };

  const handleEditField = (field: FieldItem) => {
    setEditingField(field);
    setFieldForm({ name: field.name, type: field.type, required: field.required, targetCollectionId: field.targetCollectionId });
    setFieldDialogOpen(true);
  };

  const handleDeleteField = async () => {
    if (!deleteFieldTarget) return;
    const res = await deleteField(deleteFieldTarget._id, collection._id);
    if (res.success) {
      toast.success('Field deleted');
      setDeleteFieldTarget(null);
      router.refresh();
    }
  };

  const resetRecordForm = () => {
    setRecordForm({});
    setEditingRecord(null);
  };

  const handleRecordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (editingRecord) {
      const res = await updateRecord(editingRecord._id, collection._id, recordForm);
      if (res.success) {
        toast.success('Record updated');
        setRecordDialogOpen(false);
        resetRecordForm();
        router.refresh();
      }
    } else {
      const res = await createRecord({
        collectionId: collection._id,
        fieldData: recordForm,
      });
      if (res.success) {
        toast.success('Record created');
        setRecordDialogOpen(false);
        resetRecordForm();
        router.refresh();
      }
    }
  };

  const handleEditRecord = (record: RecordItem) => {
    setEditingRecord(record);
    setRecordForm({ ...record.data });
    setRecordDialogOpen(true);
  };

  const handleDeleteRecord = async () => {
    if (!deleteRecordTarget) return;
    const res = await deleteRecord(deleteRecordTarget._id, collection._id);
    if (res.success) {
      toast.success('Record deleted');
      setDeleteRecordTarget(null);
      router.refresh();
    }
  };

  const handleNameEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await updateCollection(collection._id, nameForm);
    if (res.success) {
      toast.success('Collection updated');
      setEditNameOpen(false);
      router.refresh();
    }
  };

  const renderFieldInput = (field: FieldItem, value: unknown, onChange: (val: unknown) => void) => {
    if (field.type === 'relation') {
      const records = relationRecords[field._id] || [];
      return (
        <Select
          value={String(value ?? '')}
          onValueChange={(val) => { if (val) onChange(val); }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select related record" />
          </SelectTrigger>
          <SelectContent>
            {records.map((r) => {
              const displayVal = Object.values(r.data).find((v) => typeof v === 'string' && v) || r._id;
              return (
                <SelectItem key={r._id} value={r._id}>
                  {String(displayVal)}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      );
    }

    switch (field.type) {
      case 'number':
        return (
          <Input
            type="number"
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}
            required={field.required}
          />
        );
      case 'date':
        return (
          <Input
            type="date"
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
          />
        );
      case 'boolean':
        return (
          <div className="flex items-center gap-2">
            <Checkbox
              checked={value === true}
              onCheckedChange={(checked) => onChange(checked === true)}
            />
            <span className="text-sm text-muted-foreground">
              {value === true ? 'Yes' : 'No'}
            </span>
          </div>
        );
      case 'textarea':
        return (
          <Textarea
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
          />
        );
      case 'email':
        return (
          <Input
            type="email"
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
          />
        );
      case 'phone':
        return (
          <Input
            type="tel"
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
          />
        );
      default:
        return (
          <Input
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
          />
        );
    }
  };

  const renderCellValue = (field: FieldItem, value: unknown) => {
    if (value === undefined || value === null || value === '') return <span className="text-muted-foreground">-</span>;
    if (field.type === 'boolean') {
      return value === true ? <Badge variant="default">Yes</Badge> : <Badge variant="secondary">No</Badge>;
    }
    if (field.type === 'relation') {
      const records = relationRecords[field._id] || [];
      const matched = records.find((r) => r._id === value);
      if (matched) {
        const displayVal = Object.values(matched.data).find((v) => typeof v === 'string' && v) || matched._id;
        return <span>{String(displayVal)}</span>;
      }
      return <span className="text-muted-foreground">{String(value).slice(-8)}</span>;
    }
    return String(value);
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/collections">
          <Button variant="ghost" size="sm">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{collection.name}</h1>
            <Button variant="ghost" size="sm" onClick={() => setEditNameOpen(true)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
          {collection.description && (
            <p className="text-muted-foreground">{collection.description}</p>
          )}
          <p className="text-sm text-muted-foreground">
            {fields.length} fields &middot; {records.length} records
          </p>
        </div>
      </div>

      <Separator />

      {/* Fields & Records Management */}
      <div className="space-y-4">
        {/* Fields Section */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Fields</CardTitle>
              <Dialog open={fieldDialogOpen} onOpenChange={(open) => { setFieldDialogOpen(open); if (!open) resetFieldForm(); }}>
                <DialogTrigger render={
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    Add Field
                  </Button>
                } />
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editingField ? 'Edit Field' : 'Add Field'}</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleFieldSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="fieldName">Field Name</Label>
                      <Input
                        id="fieldName"
                        value={fieldForm.name}
                        onChange={(e) => setFieldForm({ ...fieldForm, name: e.target.value })}
                        placeholder="e.g. Full Name, Amount, Date"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="fieldType">Data Type</Label>
                      <Select
                        value={fieldForm.type}
                        onValueChange={(val) => { if (val) setFieldForm({ ...fieldForm, type: val as FieldType }); }}
                      >
                        <SelectTrigger id="fieldType">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FIELD_TYPES.map((ft) => (
                            <SelectItem key={ft.value} value={ft.value}>
                              {ft.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {fieldForm.type === 'relation' && (
                      <div className="space-y-2">
                        <Label htmlFor="targetCollection">Target Collection</Label>
                        <Select
                          value={fieldForm.targetCollectionId || ''}
                          onValueChange={(val) => { if (val) setFieldForm({ ...fieldForm, targetCollectionId: val }); }}
                          required
                        >
                          <SelectTrigger id="targetCollection">
                            <SelectValue placeholder="Select collection" />
                          </SelectTrigger>
                          <SelectContent>
                            {allCollections
                              .filter((c) => c._id !== collection._id)
                              .map((c) => (
                                <SelectItem key={c._id} value={c._id}>
                                  {c.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="fieldRequired"
                        checked={fieldForm.required}
                        onCheckedChange={(checked) => setFieldForm({ ...fieldForm, required: checked === true })}
                      />
                      <Label htmlFor="fieldRequired">Required field</Label>
                    </div>
                    <Button type="submit" className="w-full">
                      {editingField ? 'Update Field' : 'Add Field'}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            {fields.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No fields yet. Add fields to define the structure of your data.
              </p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead>Field Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead>Required</TableHead>
                      <TableHead className="w-20">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fields.map((field, idx) => (
                      <TableRow key={field._id}>
                        <TableCell className="text-muted-foreground text-xs">
                          {idx + 1}
                        </TableCell>
                        <TableCell className="font-medium">{field.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{field.type}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {field.type === 'relation'
                            ? (allCollections.find((c) => c._id === field.targetCollectionId)?.name || '-')
                            : '-'}
                        </TableCell>
                        <TableCell>
                          {field.required ? (
                            <Badge variant="default">Required</Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">Optional</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" onClick={() => handleEditField(field)}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setDeleteFieldTarget(field)}>
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Records Section */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Records</CardTitle>
              <Dialog open={recordDialogOpen} onOpenChange={(open) => { setRecordDialogOpen(open); if (!open) resetRecordForm(); }}>
                <DialogTrigger render={
                  <Button size="sm" disabled={fields.length === 0}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Record
                  </Button>
                } />
                <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>{editingRecord ? 'Edit Record' : 'Add Record'}</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleRecordSubmit} className="space-y-4">
                    {fields.map((field) => (
                      <div key={field._id} className="space-y-2">
                        <Label htmlFor={`record-${field._id}`}>
                          {field.name}
                          {field.required && <span className="text-destructive ml-1">*</span>}
                        </Label>
                        {renderFieldInput(field, recordForm[field.name] ?? '', (val) =>
                          setRecordForm({ ...recordForm, [field.name]: val })
                        )}
                      </div>
                    ))}
                    <Button type="submit" className="w-full">
                      {editingRecord ? 'Update Record' : 'Add Record'}
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            {fields.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Define fields first before adding records.
              </p>
            ) : records.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No records yet. Add your first record.
              </p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {fields.map((field) => (
                        <TableHead key={field._id}>{field.name}</TableHead>
                      ))}
                      <TableHead className="w-20">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((record) => (
                      <TableRow key={record._id}>
                        {fields.map((field) => (
                          <TableCell key={field._id}>
                            {renderCellValue(field, record.data[field.name])}
                          </TableCell>
                        ))}
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" onClick={() => handleEditRecord(record)}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setDeleteRecordTarget(record)}>
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit Collection Name Dialog */}
      <Dialog open={editNameOpen} onOpenChange={setEditNameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Collection</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleNameEdit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="editName">Collection Name</Label>
              <Input
                id="editName"
                value={nameForm.name}
                onChange={(e) => setNameForm({ ...nameForm, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editDesc">Description (optional)</Label>
              <Textarea
                id="editDesc"
                value={nameForm.description}
                onChange={(e) => setNameForm({ ...nameForm, description: e.target.value })}
              />
            </div>
            <Button type="submit" className="w-full">
              Save Changes
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteFieldTarget}
        onOpenChange={(open) => { if (!open) setDeleteFieldTarget(null); }}
        onConfirm={handleDeleteField}
        title="Delete Field"
        message={`Delete field "${deleteFieldTarget?.name}"? This will not affect existing records.`}
        confirmLabel="Delete"
      />

      <ConfirmDialog
        open={!!deleteRecordTarget}
        onOpenChange={(open) => { if (!open) setDeleteRecordTarget(null); }}
        onConfirm={handleDeleteRecord}
        title="Delete Record"
        message="Delete this record? This cannot be undone."
        confirmLabel="Delete"
      />
    </>
  );
}
