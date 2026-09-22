'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  INVOICE_TEMPLATES,
  InvoiceTemplate,
  getInvoiceTemplate,
  getCurrentInvoiceMonth,
  extractPlotNameFromCollection,
} from '@/lib/invoice-templates';
import {
  sendRecordInvoiceSmsAction,
  sendRecordsInvoiceSmsChunkAction,
} from '@/actions/record.actions';
import { updateCollection } from '@/actions/collection.actions';
import { Loader2, Send, MessageSquare, CheckCircle, AlertCircle, Building2, User } from 'lucide-react';
import { toast } from 'sonner';

interface FieldItem {
  _id: string;
  collectionId: string;
  name: string;
  type: string;
  required: boolean;
  order: number;
}

interface RecordItem {
  _id: string;
  collectionId: string;
  data: Record<string, unknown>;
  createdAt: string;
}

interface CollectionItem {
  _id: string;
  name: string;
  description?: string;
  fieldCount: number;
  recordCount: number;
  defaultInvoiceTemplateId?: string;
  plotName?: string;
}

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

export function SendInvoiceDialog({
  open,
  onOpenChange,
  collection,
  fields,
  selectedRecords,
  allRecords,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection: CollectionItem;
  fields: FieldItem[];
  selectedRecords: RecordItem[];
  allRecords: RecordItem[];
  onSuccess: () => void;
}) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    collection.defaultInvoiceTemplateId || 'sidian-111999'
  );
  const [plotName, setPlotName] = useState<string>(
    collection.plotName || extractPlotNameFromCollection(collection.name)
  );
  const [saveAsDefault, setSaveAsDefault] = useState<boolean>(false);
  const [targetScope, setTargetScope] = useState<'selected' | 'all'>(
    selectedRecords.length > 0 ? 'selected' : 'all'
  );
  const [skipZeroBalance, setSkipZeroBalance] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    success: number;
    fail: number;
    currentBatch: number;
    totalBatches: number;
  } | null>(null);

  // Sync state whenever dialog opens
  useEffect(() => {
    if (open) {
      setSelectedTemplateId(collection.defaultInvoiceTemplateId || 'sidian-111999');
      setPlotName(collection.plotName || extractPlotNameFromCollection(collection.name));
      setTargetScope(selectedRecords.length > 0 ? 'selected' : 'all');
      setSaveAsDefault(false);
      setSkipZeroBalance(false);
      setProgress(null);
    }
  }, [open, collection, selectedRecords.length]);

  const currentMonth = getCurrentInvoiceMonth();

  // Selected template object
  const template: InvoiceTemplate = useMemo(() => {
    return getInvoiceTemplate(selectedTemplateId);
  }, [selectedTemplateId]);

  // Extract helper fields
  const nameField = useMemo(
    () => fields.find((f) => ['NAME', 'CUSTOMER NAME', 'CUSTOMER', 'TENANT', 'CLIENT NAME', 'CLIENT'].includes(f.name.toUpperCase())),
    [fields]
  );
  const phoneField = useMemo(
    () => fields.find((f) => ['PHONE NO', 'PHONE', 'PHONE NUMBER', 'MOBILE'].includes(f.name.toUpperCase())),
    [fields]
  );
  const houseField = useMemo(
    () => fields.find((f) => ['HSE NO', 'HOUSE NO', 'HOUSE', 'HSE', 'UNIT NO', 'HOUSE NUMBER', 'ROOM NO', 'HSE/ROOM', 'HOUSE/ROOM'].includes(f.name.toUpperCase())),
    [fields]
  );
  const balanceField = useMemo(
    () => fields.find((f) => ['BALANCE', 'CURRENT BALANCE', 'ACTUAL BALANCE', 'CLOSING BALANCE', 'BAL'].includes(f.name.toUpperCase())),
    [fields]
  );

  // Compute eligible records to invoice
  const targetRecords = useMemo(() => {
    let pool = targetScope === 'selected' && selectedRecords.length > 0 ? selectedRecords : allRecords;
    if (skipZeroBalance && balanceField) {
      pool = pool.filter((r) => {
        const balVal = parseMathExpression(r.data[balanceField.name]);
        return balVal > 0;
      });
    }
    return pool;
  }, [targetScope, selectedRecords, allRecords, skipZeroBalance, balanceField]);

  // Sample recipient for preview
  const sampleRecord = targetRecords[0] || allRecords[0];
  const sampleName = sampleRecord && nameField ? String(sampleRecord.data[nameField.name] || 'Tenant') : 'Tenant';
  const sampleHouseNo = sampleRecord && houseField ? String(sampleRecord.data[houseField.name] || '') : '12';
  const samplePhone = sampleRecord && phoneField ? String(sampleRecord.data[phoneField.name] || '07XXXXXXXX') : '07XXXXXXXX';

  const previewMessage = useMemo(() => {
    return template.buildMessage({
      month: currentMonth,
      houseNo: sampleHouseNo,
      plotName: plotName.trim() || undefined,
    });
  }, [template, currentMonth, sampleHouseNo, plotName]);

  const smsPartsCount = Math.ceil(previewMessage.length / 160) || 1;

  const handleSend = async () => {
    if (targetRecords.length === 0) {
      toast.error('No tenants selected to receive invoices');
      return;
    }

    setLoading(true);
    try {
      // Save as default if requested
      if (saveAsDefault) {
        await updateCollection(collection._id, {
          defaultInvoiceTemplateId: selectedTemplateId,
          plotName: plotName.trim(),
        });
      }

      if (targetRecords.length === 1) {
        const res = await sendRecordInvoiceSmsAction({
          recordId: targetRecords[0]._id,
          collectionId: collection._id,
          templateId: selectedTemplateId,
          plotName: plotName.trim(),
        });

        if ('error' in res && res.error) {
          toast.error(res.error);
        } else {
          toast.success(`Invoice SMS dispatched for house #${sampleHouseNo || 'N/A'}`);
          onOpenChange(false);
          onSuccess();
        }
      } else {
        const recordIds = targetRecords.map((r) => r._id);
        const CHUNK_SIZE = 10;
        const totalBatches = Math.ceil(recordIds.length / CHUNK_SIZE);
        let totalSuccess = 0;
        let totalFail = 0;
        const allErrors: string[] = [];

        for (let i = 0; i < recordIds.length; i += CHUNK_SIZE) {
          const chunkIds = recordIds.slice(i, i + CHUNK_SIZE);
          const currentBatch = Math.floor(i / CHUNK_SIZE) + 1;

          setProgress({
            current: i,
            total: recordIds.length,
            success: totalSuccess,
            fail: totalFail,
            currentBatch,
            totalBatches,
          });

          const res = await sendRecordsInvoiceSmsChunkAction({
            recordIds: chunkIds,
            collectionId: collection._id,
            templateId: selectedTemplateId,
            plotName: plotName.trim(),
          });

          if ('error' in res && res.error && !res.successCount) {
            totalFail += chunkIds.length;
            allErrors.push(res.error);
          } else {
            totalSuccess += res.successCount || 0;
            totalFail += res.failCount || 0;
            if (res.errors) allErrors.push(...res.errors);
          }

          setProgress({
            current: Math.min(i + CHUNK_SIZE, recordIds.length),
            total: recordIds.length,
            success: totalSuccess,
            fail: totalFail,
            currentBatch,
            totalBatches,
          });

          // Pacing delay (250ms) to ensure smooth gateway flow and zero rate limit triggers
          if (i + CHUNK_SIZE < recordIds.length) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }

        if (totalFail === 0) {
          toast.success(`All ${totalSuccess} invoice SMS dispatched successfully!`);
        } else {
          toast.warning(`Dispatched ${totalSuccess} invoices, ${totalFail} failed. (Check Activity Logs)`);
        }
        onOpenChange(false);
        onSuccess();
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to dispatch invoices');
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        if (!loading) onOpenChange(val);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-xl">Send Rent Due Invoices</DialogTitle>
              <DialogDescription>
                Dispatch rent due reminder SMS to tenants for month of <strong className="text-foreground">{currentMonth}</strong>.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Target Audience */}
          <div className="p-3.5 rounded-lg border bg-card/60 space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Recipient Tenants
            </Label>
            <div className="flex flex-wrap items-center gap-4">
              {selectedRecords.length > 0 && (
                <label className="flex items-center gap-2 text-sm cursor-pointer font-medium">
                  <input
                    type="radio"
                    name="targetScope"
                    checked={targetScope === 'selected'}
                    disabled={loading}
                    onChange={() => setTargetScope('selected')}
                    className="accent-primary"
                  />
                  <span>Selected tenants ({selectedRecords.length})</span>
                </label>
              )}
              <label className="flex items-center gap-2 text-sm cursor-pointer font-medium">
                <input
                  type="radio"
                  name="targetScope"
                  checked={targetScope === 'all'}
                  disabled={loading}
                  onChange={() => setTargetScope('all')}
                  className="accent-primary"
                />
                <span>All tenants in collection ({allRecords.length})</span>
              </label>
            </div>

            {balanceField && (
              <div className="pt-2 border-t flex items-center gap-2">
                <Checkbox
                  id="skipZeroBalance"
                  checked={skipZeroBalance}
                  disabled={loading}
                  onCheckedChange={(c) => setSkipZeroBalance(!!c)}
                />
                <Label htmlFor="skipZeroBalance" className="text-xs cursor-pointer text-muted-foreground">
                  Skip tenants who already paid / have KES 0 or negative balance
                </Label>
              </div>
            )}
          </div>

          {targetRecords.length === 0 && (
            <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>No tenants qualify under the selected filters (e.g. all tenants have 0 or negative balance).</span>
            </div>
          )}

          {/* Property / Template Picker */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="templateSelect" className="text-sm font-medium">
                Property / Payment Template
              </Label>
              <Badge variant="outline" className="text-xs">
                {template.category}
              </Badge>
            </div>
            <Select
              value={selectedTemplateId}
              disabled={loading}
              onValueChange={(val) => {
                if (val) setSelectedTemplateId(val);
              }}
            >
              <SelectTrigger id="templateSelect" className="w-full">
                <SelectValue placeholder="Select a template" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {INVOICE_TEMPLATES.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <div className="flex flex-col text-left py-0.5">
                      <span className="font-semibold text-sm">{t.name}</span>
                      <span className="text-xs text-muted-foreground">{t.accountDetails}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Optional Plot Name for templates with #Plot Name / House No */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="plotNameInput" className="text-xs text-muted-foreground">
                Plot / Property Name (Optional)
              </Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="plotNameInput"
                  value={plotName}
                  disabled={loading}
                  onChange={(e) => setPlotName(e.target.value)}
                  placeholder="e.g. ANITA PLOT"
                  className="pl-9 h-9 text-sm"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">Used for A/C formatting in Paybills</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Billing Month</Label>
              <Input value={currentMonth} disabled className="h-9 text-sm bg-muted font-medium" />
              <p className="text-[11px] text-muted-foreground">Calendar month automatically applied</p>
            </div>
          </div>

          {/* Live SMS Message Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                SMS Preview {sampleRecord ? `(Sample: ${sampleName}, House #${sampleHouseNo || 'N/A'})` : ''}
              </Label>
              <span className="text-xs text-muted-foreground font-mono">
                {previewMessage.length} chars (~{smsPartsCount} SMS)
              </span>
            </div>

            <div className="p-3.5 rounded-lg border bg-muted/40 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground select-all border-dashed">
              {previewMessage}
            </div>
          </div>

          {/* Save as default for collection */}
          <div className="flex items-center gap-2 pt-1">
            <Checkbox
              id="saveDefaultCheck"
              checked={saveAsDefault}
              disabled={loading}
              onCheckedChange={(c) => setSaveAsDefault(!!c)}
            />
            <Label htmlFor="saveDefaultCheck" className="text-xs cursor-pointer text-muted-foreground">
              Remember <strong>{template.name}</strong> as the default invoice template for this collection
            </Label>
          </div>

          {/* Real-time Dispatch Progress Bar */}
          {progress && (
            <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  Dispatching Batch {progress.currentBatch} of {progress.totalBatches}
                </span>
                <span className="font-mono text-muted-foreground font-medium">
                  {Math.round((progress.current / progress.total) * 100)}% ({progress.current}/{progress.total})
                </span>
              </div>

              <div className="w-full bg-muted h-2.5 rounded-full overflow-hidden">
                <div
                  className="bg-primary h-2.5 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-muted-foreground text-[11px]">Paced safely for Vercel Free & BongaTech delivery</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-emerald-600 bg-emerald-500/10 border-emerald-500/20 text-[11px]">
                    ✓ {progress.success} Delivered
                  </Badge>
                  {progress.fail > 0 && (
                    <Badge variant="outline" className="text-rose-600 bg-rose-500/10 border-rose-500/20 text-[11px]">
                      ✕ {progress.fail} Failed
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={loading || targetRecords.length === 0} className="gap-2">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending Invoices...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Send Invoices ({targetRecords.length} {targetRecords.length === 1 ? 'Tenant' : 'Tenants'})
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
