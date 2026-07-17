'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
  updateRecordsBulk,
  createRecordsBulk,
  sendRecordSmsAction,
  sendRecordsSmsBulkAction,
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
  Loader2,
  MessageSquare,
} from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ImportDialog } from '../ImportDialog';

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

function parseMathExpression(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  const str = String(val).trim();
  if (!str) return 0;
  if (/^\d+(\s*\+\s*\d+)*$/.test(str)) {
    try {
      return str.split('+').reduce((sum, part) => sum + Number(part.trim()), 0);
    } catch {
      return 0;
    }
  }
  const parsed = Number(str);
  return isNaN(parsed) ? 0 : parsed;
}

function getFieldValueByCandidates(data: Record<string, any>, fields: FieldItem[], candidates: string[]): any {
  if (!data) return undefined;
  const field = fields.find(f => candidates.includes(f.name.toUpperCase()));
  return field ? data[field.name] : undefined;
}

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

  // Grid Edit Mode States
  const [isEditMode, setIsEditMode] = useState(false);
  const [draftRecords, setDraftRecords] = useState<Record<string, Record<string, any>>>({});
  const [focusedCell, setFocusedCell] = useState<{ recordId: string; fieldId: string } | null>(null);
  const [editingCell, setEditingCell] = useState<{ recordId: string; fieldId: string } | null>(null);
  const [savingBulk, setSavingBulk] = useState(false);
  const [newRows, setNewRows] = useState<{ _id: string; data: Record<string, any> }[]>([]);

  const combinedRows = useMemo(() => {
    return [
      ...records,
      ...newRows.map((nr) => ({
        _id: nr._id,
        collectionId: collection._id,
        data: nr.data,
        createdAt: new Date().toISOString(),
      })),
    ];
  }, [records, newRows, collection._id]);

  // SMS States & Handlers
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [sendingSmsBulk, setSendingSmsBulk] = useState(false);
  const [smsDialogOpen, setSmsDialogOpen] = useState(false);
  const [smsRecord, setSmsRecord] = useState<RecordItem | null>(null);
  const [smsInstallments, setSmsInstallments] = useState<{ amount: number; rct: string }[]>([]);
  const [selectedInstallmentIndex, setSelectedInstallmentIndex] = useState<number | 'all'>(0);

  const getRecordInstallments = useCallback((record: RecordItem): { amount: number; rct: string }[] => {
    if (record.data && Array.isArray(record.data._installments)) {
      return record.data._installments as { amount: number; rct: string }[];
    }
    
    const amountField = fields.find(f => ['RENT PAID', 'AMOUNT PAID', 'AMOUNT'].includes(f.name.toUpperCase()));
    const rctField = fields.find(f => ['RCT NO', 'RECEIPT NUMBER', 'RECEIPT NO', 'RECEIPT'].includes(f.name.toUpperCase()));
    
    if (!amountField || !rctField) return [];
    
    const rctVal = String(record.data[rctField.name] || '').trim();
    const amountVal = record.data[amountField.name];
    
    if (!rctVal) return [];
    
    const rcts = rctVal.split('/').map(r => r.trim()).filter(Boolean);
    let amounts: number[] = [];
    if (typeof amountVal === 'string' && amountVal.includes('+')) {
      amounts = amountVal.split('+').map(p => Number(p.trim())).filter(p => !isNaN(p));
    } else if (typeof amountVal === 'number') {
      amounts = [amountVal];
    } else if (typeof amountVal === 'string') {
      const parsed = Number(amountVal);
      if (!isNaN(parsed)) amounts = [parsed];
    }
    
    const count = Math.max(amounts.length, rcts.length);
    const installments = [];
    for (let i = 0; i < count; i++) {
      installments.push({
        amount: amounts[i] ?? (amounts.length === 1 ? amounts[0] : 0),
        rct: rcts[i] ?? (rcts.length === 1 ? rcts[0] : ''),
      });
    }
    return installments;
  }, [fields]);

  const handleSendRowSms = async (recordId: string, installment?: { amount: number; rct: string }) => {
    toast.promise(
      sendRecordSmsAction(recordId, collection._id, installment).then((res) => {
        if (res.error) throw new Error(res.error);
        return res;
      }),
      {
        loading: 'Sending SMS...',
        success: 'SMS sent successfully!',
        error: (err: any) => err.message || 'Failed to send SMS',
      }
    );
  };

  const handleSmsButtonClick = (record: RecordItem) => {
    const insts = getRecordInstallments(record);
    if (insts.length > 1) {
      setSmsRecord(record);
      setSmsInstallments(insts);
      setSelectedInstallmentIndex(0);
      setSmsDialogOpen(true);
    } else {
      handleSendRowSms(record._id, insts[0]);
    }
  };

  const handleConfirmSendSms = async () => {
    if (!smsRecord) return;
    
    let installment: { amount: number; rct: string } | undefined = undefined;
    if (selectedInstallmentIndex !== 'all') {
      installment = smsInstallments[selectedInstallmentIndex as number];
    }
    
    setSmsDialogOpen(false);
    await handleSendRowSms(smsRecord._id, installment);
  };

  const handleBulkSendSms = async () => {
    if (selectedRecordIds.length === 0) return;
    
    if (selectedRecordIds.length === 1) {
      const record = combinedRows.find(r => r._id === selectedRecordIds[0]);
      if (record) {
        handleSmsButtonClick(record);
        return;
      }
    }

    setSendingSmsBulk(true);
    try {
      const res = await sendRecordsSmsBulkAction(selectedRecordIds, collection._id);
      if (res.success) {
        if (res.failCount > 0) {
          toast.error(`SMS bulk complete with errors: ${res.successCount} sent, ${res.failCount} failed. Sample Errors: ${res.errors?.slice(0, 3).join('; ')}`);
        } else {
          toast.success(`SMS sent successfully to all ${res.successCount} recipients.`);
        }
        setSelectedRecordIds([]);
        router.refresh();
      } else {
        toast.error(res.error || 'Failed to send bulk SMS');
      }
    } catch (err) {
      console.error(err);
      toast.error('An error occurred during bulk SMS sending');
    } finally {
      setSendingSmsBulk(false);
    }
  };

  // Live Auto-Calculation Engine
  const getCalculatedValue = useCallback((recordId: string, recordData: Record<string, any>, fieldName: string): any => {
    const draft = draftRecords[recordId] || {};
    
    const hasDue = fields.some(f => f.name.toUpperCase() === 'RENT DUE');
    const hasBal = fields.some(f => f.name.toUpperCase() === 'BALANCE');

    const getValue = (name: string) => {
      if (name in draft) return draft[name];
      return recordData[name];
    };

    const getValueByCandidates = (candidates: string[]) => {
      const field = fields.find(f => candidates.includes(f.name.toUpperCase()));
      return field ? getValue(field.name) : undefined;
    };

    if (fieldName.toUpperCase() === 'RENT DUE' && hasDue) {
      const dep = parseMathExpression(getValueByCandidates(['DEPOSIT PAID', 'DEPOSIT']));
      const rent = parseMathExpression(getValueByCandidates(['MONTHLY RENT', 'RENT']));
      const balBD = parseMathExpression(getValueByCandidates(['BAL B/D', 'BAL B/F', 'BALANCE B/F']));
      const water = parseMathExpression(getValueByCandidates(['WATERBILL', 'WATER BILL', 'WATER']));
      return dep + rent + balBD + water;
    }

    if (fieldName.toUpperCase() === 'BALANCE' && hasBal && hasDue) {
      const due = Number(getCalculatedValue(recordId, recordData, 'RENT DUE') ?? 0);
      const paid = parseMathExpression(getValueByCandidates(['RENT PAID', 'AMOUNT PAID', 'AMOUNT', 'DEPOSIT PAID']));
      return due - paid;
    }

    return getValue(fieldName);
  }, [draftRecords, fields]);

  // Keyboard navigation & Editing cell commits
  const handleCellKeyDown = (
    e: React.KeyboardEvent,
    recordId: string,
    field: FieldItem,
    rowIndex: number,
    colIndex: number
  ) => {
    if (editingCell?.recordId === recordId && editingCell.fieldId === field._id) {
      if (e.key === 'Enter') {
        e.preventDefault();
        setEditingCell(null);
        if (rowIndex < combinedRows.length - 1) {
          setFocusedCell({ recordId: combinedRows[rowIndex + 1]._id, fieldId: field._id });
        }
      } else if (e.key === 'Tab') {
        e.preventDefault();
        setEditingCell(null);
        if (colIndex < fields.length - 1) {
          setFocusedCell({ recordId, fieldId: fields[colIndex + 1]._id });
        } else if (rowIndex < combinedRows.length - 1) {
          setFocusedCell({ recordId: combinedRows[rowIndex + 1]._id, fieldId: fields[0]._id });
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setEditingCell(null);
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (rowIndex > 0) {
        setFocusedCell({ recordId: combinedRows[rowIndex - 1]._id, fieldId: field._id });
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (rowIndex < combinedRows.length - 1) {
        setFocusedCell({ recordId: combinedRows[rowIndex + 1]._id, fieldId: field._id });
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (colIndex > 0) {
        setFocusedCell({ recordId, fieldId: fields[colIndex - 1]._id });
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (colIndex < fields.length - 1) {
        setFocusedCell({ recordId, fieldId: fields[colIndex + 1]._id });
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      setEditingCell({ recordId, fieldId: field._id });
    }
  };

  const handleDraftChange = (recordId: string, fieldName: string, val: any) => {
    const prev = draftRecords[recordId] || {};
    setDraftRecords({
      ...draftRecords,
      [recordId]: {
        ...prev,
        [fieldName]: val,
      },
    });
  };

  // Bulk save action
  const handleSaveBulk = async () => {
    setSavingBulk(true);
    try {
      const updates: { id: string; data: Record<string, unknown> }[] = [];
      const creations: Record<string, unknown>[] = [];

      for (const [recordId, data] of Object.entries(draftRecords)) {
        let merged: Record<string, unknown> = {};
        if (!recordId.startsWith('temp_')) {
          const originalRecord = records.find((r) => r._id === recordId);
          merged = { ...(originalRecord ? originalRecord.data : {}), ...data };
        } else {
          merged = { ...data };
        }

        const hasDeposit = fields.some(f => f.name.toUpperCase() === 'DEPOSIT PAID');
        const hasRent = fields.some(f => f.name.toUpperCase() === 'MONTHLY RENT');
        const hasBalBD = fields.some(f => f.name.toUpperCase() === 'BAL B/D');
        const hasDue = fields.some(f => f.name.toUpperCase() === 'RENT DUE');
        const hasPaid = fields.some(f => f.name.toUpperCase() === 'RENT PAID');
        const hasBal = fields.some(f => f.name.toUpperCase() === 'BALANCE');

        if (hasDue && (hasDeposit || hasRent || hasBalBD)) {
          const dep = Number(merged['DEPOSIT PAID'] ?? 0);
          const rent = Number(merged['MONTHLY RENT'] ?? 0);
          const balBD = Number(merged['BAL B/D'] ?? 0);
          merged['RENT DUE'] = dep + rent + balBD;
        }

        if (hasBal && hasDue) {
          const due = Number(merged['RENT DUE'] ?? 0);
          const paid = Number(merged['RENT PAID'] ?? 0);
          merged['BALANCE'] = due - paid;
        }

        if (recordId.startsWith('temp_')) {
          creations.push(merged);
        } else {
          updates.push({
            id: recordId,
            data: merged,
          });
        }
      }

      if (updates.length > 0) {
        const updateRes = await updateRecordsBulk(collection._id, updates);
        if (!updateRes.success) {
          toast.error(updateRes.error || 'Failed to update existing records');
          setSavingBulk(false);
          return;
        }
      }

      if (creations.length > 0) {
        const createRes = await createRecordsBulk(collection._id, creations);
        if (!createRes.success) {
          toast.error(createRes.error || 'Failed to create new records');
          setSavingBulk(false);
          return;
        }
      }

      toast.success('All changes saved successfully');
      setDraftRecords({});
      setNewRows([]);
      setIsEditMode(false);
      router.refresh();
    } catch (err) {
      console.error(err);
      toast.error('An error occurred while saving');
    } finally {
      setSavingBulk(false);
    }
  };

  const handleAddRow = () => {
    setIsEditMode(true);
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newRow = { _id: tempId, data: {} };
    setNewRows((prev) => [...prev, newRow]);
    
    setTimeout(() => {
      if (fields.length > 0) {
        setFocusedCell({ recordId: tempId, fieldId: fields[0]._id });
        setEditingCell({ recordId: tempId, fieldId: fields[0]._id });
      }
    }, 50);
  };

  const renderEditableCell = (
    record: RecordItem,
    field: FieldItem,
    rowIndex: number,
    colIndex: number
  ) => {
    const recordId = record._id;
    const isFocused = focusedCell?.recordId === recordId && focusedCell.fieldId === field._id;
    const isEditing = editingCell?.recordId === recordId && editingCell.fieldId === field._id;
    const currentVal = getCalculatedValue(recordId, record.data, field.name);

    if (isEditing) {
      if (field.type === 'boolean') {
        return (
          <Checkbox
            checked={currentVal === true}
            onCheckedChange={(checked) => handleDraftChange(recordId, field.name, checked === true)}
            onBlur={() => setEditingCell(null)}
            autoFocus
          />
        );
      }

      if (field.type === 'number') {
        return (
          <Input
            type="number"
            value={currentVal ?? ''}
            onChange={(e) => handleDraftChange(recordId, field.name, e.target.value !== '' ? Number(e.target.value) : '')}
            onBlur={() => setEditingCell(null)}
            className="h-8 py-0.5 px-1.5 w-full text-sm bg-background border-primary focus-visible:ring-1 focus-visible:ring-offset-0"
            autoFocus
          />
        );
      }

      if (field.type === 'date') {
        return (
          <Input
            type="date"
            value={currentVal ?? ''}
            onChange={(e) => handleDraftChange(recordId, field.name, e.target.value)}
            onBlur={() => setEditingCell(null)}
            className="h-8 py-0.5 px-1.5 w-full text-sm bg-background border-primary focus-visible:ring-1 focus-visible:ring-offset-0"
            autoFocus
          />
        );
      }

      return (
        <Input
          value={currentVal ?? ''}
          onChange={(e) => handleDraftChange(recordId, field.name, e.target.value)}
          onBlur={() => setEditingCell(null)}
          className="h-8 py-0.5 px-1.5 w-full text-sm bg-background border-primary focus-visible:ring-1 focus-visible:ring-offset-0"
          autoFocus
        />
      );
    }

    return (
      <div
        tabIndex={0}
        onFocus={() => setFocusedCell({ recordId, fieldId: field._id })}
        onKeyDown={(e) => handleCellKeyDown(e, recordId, field, rowIndex, colIndex)}
        onDoubleClick={() => {
          setFocusedCell({ recordId, fieldId: field._id });
          setEditingCell({ recordId, fieldId: field._id });
        }}
        className={`w-full h-full min-h-8 py-1.5 px-2.5 rounded cursor-pointer outline-none transition-all ${
          isFocused 
            ? 'ring-2 ring-primary ring-offset-1 bg-primary/5' 
            : 'hover:bg-muted/50'
        }`}
      >
        {renderCellValue(field, currentVal)}
      </div>
    );
  };

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

    const updatedForm = { ...recordForm };

    const hasDue = fields.some(f => f.name.toUpperCase() === 'RENT DUE');
    const hasBal = fields.some(f => f.name.toUpperCase() === 'BALANCE');

    if (hasDue) {
      const dep = parseMathExpression(getFieldValueByCandidates(updatedForm, fields, ['DEPOSIT PAID', 'DEPOSIT']));
      const rent = parseMathExpression(getFieldValueByCandidates(updatedForm, fields, ['MONTHLY RENT', 'RENT']));
      const balBD = parseMathExpression(getFieldValueByCandidates(updatedForm, fields, ['BAL B/D', 'BAL B/F', 'BALANCE B/F']));
      const water = parseMathExpression(getFieldValueByCandidates(updatedForm, fields, ['WATERBILL', 'WATER BILL', 'WATER']));
      const dueField = fields.find(f => f.name.toUpperCase() === 'RENT DUE');
      if (dueField) {
        updatedForm[dueField.name] = dep + rent + balBD + water;
      }
    }

    if (hasBal && hasDue) {
      const dueField = fields.find(f => f.name.toUpperCase() === 'RENT DUE');
      const due = Number(dueField ? updatedForm[dueField.name] ?? 0 : 0);
      const paid = parseMathExpression(getFieldValueByCandidates(updatedForm, fields, ['RENT PAID', 'AMOUNT PAID', 'AMOUNT', 'DEPOSIT PAID']));
      const balField = fields.find(f => f.name.toUpperCase() === 'BALANCE');
      if (balField) {
        updatedForm[balField.name] = due - paid;
      }
    }

    // Compute installments
    const amountField = fields.find(f => ['RENT PAID', 'AMOUNT PAID', 'AMOUNT'].includes(f.name.toUpperCase()));
    const rctField = fields.find(f => ['RCT NO', 'RECEIPT NUMBER', 'RECEIPT NO', 'RECEIPT'].includes(f.name.toUpperCase()));
    if (amountField && rctField) {
      const rctVal = String(updatedForm[rctField.name] || '').trim();
      const amountVal = updatedForm[amountField.name];
      const rcts = rctVal.split('/').map(r => r.trim()).filter(Boolean);
      let amounts: number[] = [];
      if (typeof amountVal === 'string' && amountVal.includes('+')) {
        amounts = amountVal.split('+').map(p => Number(p.trim())).filter(p => !isNaN(p));
      } else if (typeof amountVal === 'number') {
        amounts = [amountVal];
      }
      if (amounts.length > 0 || rcts.length > 1) {
        const installmentsList = [];
        const count = Math.max(amounts.length, rcts.length);
        for (let i = 0; i < count; i++) {
          installmentsList.push({
            amount: amounts[i] ?? (amounts.length === 1 ? amounts[0] : 0),
            rct: rcts[i] ?? (rcts.length === 1 ? rcts[0] : ''),
          });
        }
        updatedForm['_installments'] = installmentsList;
      } else {
        delete updatedForm['_installments'];
      }
    }

    if (editingRecord) {
      const res = await updateRecord(editingRecord._id, collection._id, updatedForm);
      if (res.success) {
        toast.success('Record updated');
        setRecordDialogOpen(false);
        resetRecordForm();
        router.refresh();
      } else {
        toast.error(res.error || 'Failed to update record');
      }
    } else {
      const res = await createRecord({
        collectionId: collection._id,
        fieldData: updatedForm,
      });
      if (res.success) {
        toast.success('Record created');
        setRecordDialogOpen(false);
        resetRecordForm();
        router.refresh();
      } else {
        toast.error(res.error || 'Failed to create record');
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
            type="text"
            placeholder="e.g. 6000+7000"
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
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
    if (field.name.toUpperCase() === 'SMS STATUS') {
      const valStr = String(value).toLowerCase();
      if (valStr === 'sent') return <Badge variant="default">sent</Badge>;
      if (valStr === 'failed') return <Badge variant="destructive">failed</Badge>;
      return <Badge variant="secondary">{valStr}</Badge>;
    }
    if (field.type === 'boolean') {
      return value === true ? <Badge variant="default">Yes</Badge> : <Badge variant="secondary">No</Badge>;
    }
    if (field.type === 'number') {
      const parsed = parseMathExpression(value);
      return <span>{parsed.toLocaleString()}</span>;
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

        {/* Records Section */}
        <Card>
          <CardHeader className="pb-3 sticky top-0 bg-card z-20 border-b shadow-sm">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Records</CardTitle>
              <div className="flex items-center gap-2">
                {isEditMode ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleAddRow}
                      className="border-sky-600 text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-950/20"
                      disabled={savingBulk}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add Row
                    </Button>
                    <Button 
                      size="sm" 
                      variant="default" 
                      onClick={handleSaveBulk}
                      disabled={savingBulk || Object.keys(draftRecords).length === 0}
                    >
                      {savingBulk && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                      Save Changes ({Object.keys(draftRecords).length})
                    </Button>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={() => {
                        setDraftRecords({});
                        setNewRows([]);
                        setIsEditMode(false);
                      }}
                      disabled={savingBulk}
                    >
                      Discard Changes
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleAddRow}
                      className="border-sky-600 text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-950/20"
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add Row (Excel Mode)
                    </Button>
                    {selectedRecordIds.length > 0 && (
                      <Button
                        size="sm"
                        variant="default"
                        onClick={handleBulkSendSms}
                        disabled={sendingSmsBulk}
                        className="bg-green-600 hover:bg-green-700 text-white"
                      >
                        {sendingSmsBulk && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                        Send SMS ({selectedRecordIds.length})
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIsEditMode(true)}
                    >
                      Grid Edit Mode
                    </Button>
                    <ImportDialog
                      collectionId={collection._id}
                      collectionFields={fields}
                      onSuccess={() => router.refresh()}
                    />
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
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {fields.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Define fields first before adding records.
              </p>
            ) : (records.length === 0 && newRows.length === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No records yet. Add your first record.
              </p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          checked={selectedRecordIds.length === records.length && records.length > 0}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedRecordIds(records.map((r) => r._id));
                            } else {
                              setSelectedRecordIds([]);
                            }
                          }}
                          disabled={isEditMode}
                        />
                      </TableHead>
                      {fields.map((field) => (
                        <TableHead key={field._id}>{field.name}</TableHead>
                      ))}
                      <TableHead className="w-28">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {combinedRows.map((record, rowIndex) => (
                      <TableRow key={record._id} className={isEditMode ? 'hover:bg-transparent' : ''}>
                        <TableCell className="w-12">
                          <Checkbox
                            checked={selectedRecordIds.includes(record._id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedRecordIds([...selectedRecordIds, record._id]);
                              } else {
                                setSelectedRecordIds(selectedRecordIds.filter((id) => id !== record._id));
                              }
                            }}
                            disabled={isEditMode}
                          />
                        </TableCell>
                        {fields.map((field, colIndex) => (
                          <TableCell key={field._id} className={isEditMode ? 'p-1' : ''}>
                            {isEditMode ? (
                              renderEditableCell(record, field, rowIndex, colIndex)
                            ) : (
                              renderCellValue(field, getCalculatedValue(record._id, record.data, field.name))
                            )}
                          </TableCell>
                        ))}
                        <TableCell>
                          <div className="flex gap-1">
                            {isEditMode ? (
                              record._id.startsWith('temp_') && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    const nextDrafts = { ...draftRecords };
                                    delete nextDrafts[record._id];
                                    setDraftRecords(nextDrafts);
                                    setNewRows(newRows.filter((nr) => nr._id !== record._id));
                                  }}
                                  title="Remove row"
                                >
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              )
                            ) : (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="Send Receipt SMS"
                                  onClick={() => handleSmsButtonClick(record)}
                                >
                                  <MessageSquare className="h-3.5 w-3.5 text-primary" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => handleEditRecord(record)}>
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setDeleteRecordTarget(record)}>
                                  <Trash2 className="h-3 w-3 text-destructive" />
                                </Button>
                              </>
                            )}
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

      {/* SMS Installment Dialog */}
      <Dialog open={smsDialogOpen} onOpenChange={setSmsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              Select Installment to Receipt
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              This payment has multiple installments or transaction IDs. Please select which installment to reference in the SMS:
            </p>
            <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
              {smsInstallments.map((inst, index) => (
                <div
                  key={index}
                  onClick={() => setSelectedInstallmentIndex(index)}
                  className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                    selectedInstallmentIndex === index
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'hover:bg-muted/50 border-muted'
                  }`}
                >
                  <div className="flex items-center gap-3 text-left">
                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${selectedInstallmentIndex === index ? 'border-primary' : 'border-muted'}`}>
                      {selectedInstallmentIndex === index && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                    </div>
                    <div>
                      <span className="font-semibold text-sm">Installment {index + 1}</span>
                      <p className="text-xs text-muted-foreground">Tx ID: {inst.rct || 'N/A'}</p>
                    </div>
                  </div>
                  <span className="font-bold text-sm text-primary">
                    KES {inst.amount.toLocaleString()}
                  </span>
                </div>
              ))}
              
              <div
                onClick={() => setSelectedInstallmentIndex('all')}
                className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                  selectedInstallmentIndex === 'all'
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'hover:bg-muted/50 border-muted'
                }`}
              >
                <div className="flex items-center gap-3 text-left">
                  <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${selectedInstallmentIndex === 'all' ? 'border-primary' : 'border-muted'}`}>
                    {selectedInstallmentIndex === 'all' && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                  </div>
                  <div>
                    <span className="font-semibold text-sm">Overall Total</span>
                    <p className="text-xs text-muted-foreground">All Tx IDs</p>
                  </div>
                </div>
                <span className="font-bold text-sm text-primary">
                  KES {(smsRecord ? parseMathExpression(getFieldValueByCandidates(smsRecord.data, fields, ['RENT PAID', 'AMOUNT PAID', 'AMOUNT'])) : 0).toLocaleString()}
                </span>
              </div>
            </div>
            
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setSmsDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleConfirmSendSms}>
                Send Receipt SMS
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
