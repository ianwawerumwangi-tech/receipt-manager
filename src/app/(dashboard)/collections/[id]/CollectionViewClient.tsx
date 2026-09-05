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
import { extractRecordInstallments } from '@/lib/utils';

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
  const parsed = Number(str.replace(/,/g, ''));
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

  const getRecordInstallments = useCallback((record: RecordItem): { amount: number; rct: string }[] => {
    return extractRecordInstallments(record.data, fields);
  }, [fields]);

  // Detect collection-wide water rate from schema, stored _unitRate, or recorded readings
  const collectionWaterRate = useMemo(() => {
    const rateField = fields.find((f) => ['PER UNIT', 'RATE', 'UNIT RATE', 'AMOUNT PER UNIT', 'PRICE PER UNIT'].includes(f.name.toUpperCase()));
    for (const r of records) {
      if (rateField && parseMathExpression(r.data[rateField.name]) > 0) {
        return parseMathExpression(r.data[rateField.name]);
      }
      if (typeof r.data._unitRate === 'number' && r.data._unitRate > 0) {
        return r.data._unitRate;
      }
      const prevF = fields.find((f) => ['PREVIOUS', 'PREV'].includes(f.name.toUpperCase()));
      const currF = fields.find((f) => ['CURRENT', 'CURR'].includes(f.name.toUpperCase()));
      const consF = fields.find((f) => ['CONSUMPTION', 'UNITS'].includes(f.name.toUpperCase()));
      const totF = fields.find((f) => ['TOTAL BILL', 'WATER BILL', 'TOTAL'].includes(f.name.toUpperCase()));
      const p = prevF ? parseMathExpression(r.data[prevF.name]) : 0;
      const c = currF ? parseMathExpression(r.data[currF.name]) : 0;
      const cons = consF ? parseMathExpression(r.data[consF.name]) : Math.max(0, c - p);
      const tot = totF ? parseMathExpression(r.data[totF.name]) : 0;
      if (cons > 0 && tot > 0) {
        return Math.round(tot / cons);
      }
    }
    return 150;
  }, [fields, records]);

  const handleSendRowSms = async (recordId: string) => {
    toast.promise(
      sendRecordSmsAction(recordId, collection._id).then((res) => {
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
    handleSendRowSms(record._id);
  };

  const handleBulkSendSms = async () => {
    if (selectedRecordIds.length === 0) return;

    setSendingSmsBulk(true);
    const toastId = toast.loading(`Preparing to send SMS to ${selectedRecordIds.length} records...`);

    let totalSuccessCount = 0;
    let totalFailCount = 0;
    const allErrors: string[] = [];

    // Client-side batch size of 10 to ensure each Server Action runs under 3s on Vercel Free
    const CLIENT_BATCH_SIZE = 10;
    const totalBatches = Math.ceil(selectedRecordIds.length / CLIENT_BATCH_SIZE);

    try {
      for (let i = 0; i < selectedRecordIds.length; i += CLIENT_BATCH_SIZE) {
        const batchIds = selectedRecordIds.slice(i, i + CLIENT_BATCH_SIZE);
        const currentBatchNum = Math.floor(i / CLIENT_BATCH_SIZE) + 1;

        toast.loading(
          `Sending SMS batch ${currentBatchNum} of ${totalBatches} (${batchIds.length} records)...`,
          { id: toastId }
        );

        const res = await sendRecordsSmsBulkAction(batchIds, collection._id);

        if ('error' in res && res.error && !res.successCount) {
          totalFailCount += batchIds.length;
          allErrors.push(`Batch ${currentBatchNum}: ${res.error}`);
        } else {
          totalSuccessCount += res.successCount || 0;
          totalFailCount += res.failCount || 0;
          if (res.errors) {
            allErrors.push(...res.errors);
          }
        }
      }

      toast.dismiss(toastId);

      if (totalFailCount > 0) {
        toast.error(
          `Bulk SMS completed with errors: ${totalSuccessCount} sent, ${totalFailCount} failed. ${
            allErrors.length > 0 ? `Sample Errors: ${allErrors.slice(0, 2).join('; ')}` : ''
          }`,
          { duration: 6000 }
        );
      } else {
        toast.success(`SMS sent successfully! (${totalSuccessCount} messages sent).`, { duration: 4000 });
      }

      setSelectedRecordIds([]);
      router.refresh();
    } catch (err: any) {
      console.error(err);
      toast.dismiss(toastId);
      toast.error(err?.message || 'An error occurred during bulk SMS sending');
    } finally {
      setSendingSmsBulk(false);
    }
  };

  // Value Lookup Engine (Returns exact stored or draft value)
  const getCalculatedValue = useCallback((recordId: string, recordData: Record<string, any>, fieldName: string): any => {
    const draft = draftRecords[recordId] || {};
    if (fieldName in draft) return draft[fieldName];
    return recordData[fieldName];
  }, [draftRecords]);

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
    const originalRecord = combinedRows.find((r) => r._id === recordId);
    const prevDraft = draftRecords[recordId] || {};
    const updatedRow: Record<string, any> = {
      ...(originalRecord ? originalRecord.data : {}),
      ...prevDraft,
      [fieldName]: val,
    };

    const upperFieldName = fieldName.toUpperCase();

    // 1. Water bill auto-calculations when CURRENT or PREVIOUS changes
    const currF = fields.find((f) => ['CURRENT', 'CURR', 'CURRENT READING', 'CURR READING'].includes(f.name.toUpperCase()));
    const prevF = fields.find((f) => ['PREVIOUS', 'PREV', 'PREVIOUS READING', 'PREV READING'].includes(f.name.toUpperCase()));
    const consF = fields.find((f) => ['CONSUMPTION', 'UNITS', 'UNITS USED'].includes(f.name.toUpperCase()));
    const waterBillF = fields.find((f) => ['WATER BILL', 'WATER'].includes(f.name.toUpperCase()));
    const balBdF = fields.find((f) => ['BAL B/D', 'BAL B/F', 'BALANCE B/D', 'BALANCE B/F'].includes(f.name.toUpperCase()));
    const totalBillF = fields.find((f) => ['TOTAL BILL', 'TOTAL', 'TOTAL AMOUNT'].includes(f.name.toUpperCase()));

    if (currF && prevF && (upperFieldName === currF.name.toUpperCase() || upperFieldName === prevF.name.toUpperCase())) {
      const cVal = parseMathExpression(updatedRow[currF.name]);
      const pVal = parseMathExpression(updatedRow[prevF.name]);
      const isZeroUsage = cVal <= pVal;
      const newCons = isZeroUsage ? 0 : Math.max(0, cVal - pVal);
      const newWaterBill = isZeroUsage ? 0 : newCons * collectionWaterRate;

      if (consF) updatedRow[consF.name] = newCons;
      if (waterBillF) updatedRow[waterBillF.name] = newWaterBill;
      if (totalBillF) {
        const balBd = balBdF ? parseMathExpression(updatedRow[balBdF.name]) : 0;
        updatedRow[totalBillF.name] = newWaterBill + balBd;
      }
    }

    // 2. Rent auto-calculations when RENT PAID changes
    const rentPaidF = fields.find((f) => ['RENT PAID', 'AMOUNT PAID', 'AMOUNT', 'DEPOSIT PAID'].includes(f.name.toUpperCase()));
    const balanceF = fields.find((f) => ['BALANCE', 'BAL', 'CURRENT BALANCE'].includes(f.name.toUpperCase()));

    if (rentPaidF && balanceF && upperFieldName === rentPaidF.name.toUpperCase()) {
      const rentPaid = parseMathExpression(val);
      if (totalBillF && updatedRow[totalBillF.name] !== undefined) {
        const total = parseMathExpression(updatedRow[totalBillF.name]);
        updatedRow[balanceF.name] = total - rentPaid;
      }
    }

    setDraftRecords((prev) => ({
      ...prev,
      [recordId]: updatedRow,
    }));
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

        // Recompute installments from updated values
        const freshInsts = extractRecordInstallments(merged, fields);
        if (freshInsts.length > 0) {
          merged['_installments'] = freshInsts;
        } else {
          delete merged['_installments'];
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
      const handleInputKeyDown = (e: React.KeyboardEvent) => {
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
      };

      if (field.type === 'boolean') {
        return (
          <Checkbox
            checked={currentVal === true}
            onCheckedChange={(checked) => handleDraftChange(recordId, field.name, checked === true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setEditingCell(null);
                if (rowIndex < combinedRows.length - 1) {
                  setFocusedCell({ recordId: combinedRows[rowIndex + 1]._id, fieldId: field._id });
                }
              }
            }}
            onBlur={() => setEditingCell(null)}
            autoFocus
          />
        );
      }

      if (field.type === 'number') {
        return (
          <Input
            type="text"
            value={currentVal !== undefined && currentVal !== null ? String(currentVal) : ''}
            onChange={(e) => handleDraftChange(recordId, field.name, e.target.value)}
            onKeyDown={handleInputKeyDown}
            onBlur={() => setEditingCell(null)}
            className="h-8 py-0.5 px-1.5 w-full text-sm bg-background border-primary focus-visible:ring-1 focus-visible:ring-offset-0 font-mono"
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
            onKeyDown={handleInputKeyDown}
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
          onKeyDown={handleInputKeyDown}
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
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        if (isEditMode) {
          e.preventDefault();
          handleSaveBulk();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isEditMode, draftRecords, records, fields]);

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
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <CardTitle className="text-lg">Records</CardTitle>
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
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

    </>
  );
}
