'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
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
  extractMonthFromCollection,
  formatSelectedMonths,
  templateUsesHouseNo,
  resolveInvoiceMessage,
  ALL_MONTHS,
} from '@/lib/invoice-templates';
import {
  sendRecordInvoiceSmsAction,
  sendRecordsInvoiceSmsChunkAction,
} from '@/actions/record.actions';
import { updateCollection } from '@/actions/collection.actions';
import {
  Loader2,
  Send,
  MessageSquare,
  AlertCircle,
  Building2,
  Calendar,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

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

  // Month selection state
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [billingMonth, setBillingMonth] = useState<string>('');
  const [isMultiMonth, setIsMultiMonth] = useState<boolean>(false);

  // SMS message editing state
  const [messageText, setMessageText] = useState<string>('');
  const [isMessageModified, setIsMessageModified] = useState<boolean>(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
      const initialTemplateId = collection.defaultInvoiceTemplateId || 'sidian-111999';
      const initialPlot = collection.plotName || extractPlotNameFromCollection(collection.name);
      const detectedMonth = extractMonthFromCollection(collection.name);
      const initialMonth = detectedMonth || getCurrentInvoiceMonth();

      setSelectedTemplateId(initialTemplateId);
      setPlotName(initialPlot);
      setSelectedMonths([initialMonth]);
      setBillingMonth(initialMonth);
      setIsMultiMonth(false);
      setTargetScope(selectedRecords.length > 0 ? 'selected' : 'all');
      setSaveAsDefault(false);
      setSkipZeroBalance(false);
      setProgress(null);
      setIsMessageModified(false);

      const templ = getInvoiceTemplate(initialTemplateId);
      const initialMsg = templ.buildMessage({
        month: initialMonth,
        houseNo: '{houseNo}',
        plotName: initialPlot.trim() || undefined,
      });
      setMessageText(initialMsg);
    }
  }, [open, collection, selectedRecords.length]);

  // Selected template object
  const template: InvoiceTemplate = useMemo(() => {
    return getInvoiceTemplate(selectedTemplateId);
  }, [selectedTemplateId]);

  const templateNeedsHouseNo = useMemo(() => {
    return templateUsesHouseNo(template);
  }, [template]);

  // Auto-generate template message when template, billingMonth, or plotName changes if user hasn't edited manually
  useEffect(() => {
    if (open && !isMessageModified) {
      const defaultMsg = template.buildMessage({
        month: billingMonth.trim() || 'MONTH',
        houseNo: '{houseNo}',
        plotName: plotName.trim() || undefined,
      });
      setMessageText(defaultMsg);
    }
  }, [template, billingMonth, plotName, isMessageModified, open]);

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
  const sampleBal = sampleRecord && balanceField ? parseMathExpression(sampleRecord.data[balanceField.name]) : 0;
  const sampleBalStr = sampleBal > 0 ? sampleBal.toLocaleString() : '0';

  // Live rendered preview for sample recipient
  const previewMessage = useMemo(() => {
    return resolveInvoiceMessage(messageText, {
      houseNo: sampleHouseNo,
      name: sampleName,
      month: billingMonth.trim() || undefined,
      plotName: plotName.trim() || undefined,
      balance: sampleBalStr,
    });
  }, [messageText, sampleHouseNo, sampleName, billingMonth, plotName, sampleBalStr]);

  const smsPartsCount = Math.ceil(previewMessage.length / 160) || 1;

  // Manual month button click handler
  const handleMonthClick = (monthFull: string) => {
    if (isMultiMonth) {
      let newMonths: string[];
      if (selectedMonths.includes(monthFull)) {
        newMonths = selectedMonths.filter((m) => m !== monthFull);
      } else {
        newMonths = [...selectedMonths, monthFull];
        // Sort in calendar order
        newMonths.sort((a, b) => {
          const idxA = ALL_MONTHS.findIndex((m) => m.full === a);
          const idxB = ALL_MONTHS.findIndex((m) => m.full === b);
          return idxA - idxB;
        });
      }
      setSelectedMonths(newMonths);
      const formatted = formatSelectedMonths(newMonths);
      setBillingMonth(formatted);
    } else {
      setSelectedMonths([monthFull]);
      setBillingMonth(monthFull);
    }
  };

  // Insert variable tag into textarea at cursor position
  const handleInsertVariable = (variable: string) => {
    const el = textareaRef.current;
    if (el) {
      const start = el.selectionStart ?? messageText.length;
      const end = el.selectionEnd ?? messageText.length;
      const before = messageText.substring(0, start);
      const after = messageText.substring(end);
      const newText = before + variable + after;
      setMessageText(newText);
      setIsMessageModified(true);
      setTimeout(() => {
        el.focus();
        const cursorPosition = start + variable.length;
        el.setSelectionRange(cursorPosition, cursorPosition);
      }, 0);
    } else {
      setMessageText((prev) => (prev ? prev + ' ' + variable : variable));
      setIsMessageModified(true);
    }
  };

  // Reset message to template default
  const handleResetMessage = () => {
    const defaultMsg = template.buildMessage({
      month: billingMonth.trim() || 'MONTH',
      houseNo: '{houseNo}',
      plotName: plotName.trim() || undefined,
    });
    setMessageText(defaultMsg);
    setIsMessageModified(false);
    toast.info('Message restored to template default');
  };

  const handleSend = async () => {
    if (targetRecords.length === 0) {
      toast.error('No tenants selected to receive invoices');
      return;
    }

    if (!messageText.trim()) {
      toast.error('Invoice SMS message cannot be empty');
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
          month: billingMonth.trim(),
          customMessage: messageText.trim(),
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
            month: billingMonth.trim(),
            customMessage: messageText.trim(),
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
                Dispatch rent due reminder SMS to tenants for <strong className="text-foreground">{billingMonth || 'selected month'}</strong>.
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
                if (val) {
                  setSelectedTemplateId(val);
                  const templ = getInvoiceTemplate(val);
                  const newMsg = templ.buildMessage({
                    month: billingMonth.trim() || 'MONTH',
                    houseNo: '{houseNo}',
                    plotName: plotName.trim() || undefined,
                  });
                  setMessageText(newMsg);
                  setIsMessageModified(false);
                }
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

          {/* Optional Plot Name & Billing Month Section */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="plotNameInput" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
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
              <div className="flex items-center justify-between">
                <Label htmlFor="billingMonthInput" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Billing Month(s)
                </Label>
                <div className="flex items-center gap-1.5">
                  <Checkbox
                    id="multiMonthToggle"
                    checked={isMultiMonth}
                    disabled={loading}
                    onCheckedChange={(checked) => {
                      const val = !!checked;
                      setIsMultiMonth(val);
                      if (!val && selectedMonths.length > 1) {
                        const single = [selectedMonths[selectedMonths.length - 1]];
                        setSelectedMonths(single);
                        setBillingMonth(single[0]);
                      }
                    }}
                  />
                  <Label htmlFor="multiMonthToggle" className="text-[11px] cursor-pointer text-muted-foreground select-none">
                    Multi-month
                  </Label>
                </div>
              </div>
              <div className="relative">
                <Calendar className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="billingMonthInput"
                  value={billingMonth}
                  disabled={loading}
                  onChange={(e) => {
                    const val = e.target.value;
                    setBillingMonth(val);
                    const matchingMonths = ALL_MONTHS.filter((m) => {
                      const regex = new RegExp(`\\b(${m.full}|${m.short})\\b`, 'i');
                      return regex.test(val);
                    }).map((m) => m.full);
                    setSelectedMonths(matchingMonths);
                  }}
                  placeholder="e.g. OCTOBER or OCTOBER & NOVEMBER"
                  className="pl-9 h-9 text-sm font-medium"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">Select below or type custom period</p>
            </div>
          </div>

          {/* Quick Month Toggle Buttons */}
          <div className="space-y-1.5 pt-0.5">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Select Month:</span>
              <button
                type="button"
                onClick={() => {
                  const curr = getCurrentInvoiceMonth();
                  setSelectedMonths([curr]);
                  setBillingMonth(curr);
                  setIsMultiMonth(false);
                }}
                className="hover:underline text-primary text-[11px] font-medium"
              >
                Set to Current Month ({getCurrentInvoiceMonth()})
              </button>
            </div>
            <div className="grid grid-cols-6 sm:grid-cols-12 gap-1">
              {ALL_MONTHS.map((m) => {
                const isSelected = selectedMonths.includes(m.full);
                return (
                  <button
                    key={m.short}
                    type="button"
                    disabled={loading}
                    onClick={() => handleMonthClick(m.full)}
                    className={cn(
                      'h-7 text-xs rounded transition-all border text-center flex items-center justify-center font-medium',
                      isSelected
                        ? 'bg-primary text-primary-foreground border-primary shadow-xs font-semibold'
                        : 'bg-background hover:bg-muted text-muted-foreground hover:text-foreground border-border'
                    )}
                  >
                    {m.short}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Invoice SMS Message Editor */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label htmlFor="smsMessageEditor" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Invoice SMS Message (Editable)
                </Label>
                {isMessageModified && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-amber-500/10 text-amber-600 border-amber-500/20">
                    Edited
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                {isMessageModified && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleResetMessage}
                    className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reset to Default
                  </Button>
                )}
                <span
                  className={cn(
                    'text-xs font-mono',
                    smsPartsCount > 1 ? 'text-amber-600 font-medium' : 'text-muted-foreground'
                  )}
                >
                  {previewMessage.length} chars (~{smsPartsCount} SMS)
                </span>
              </div>
            </div>

            {/* Quick Variable Insert Tags */}
            <div className="flex flex-wrap items-center gap-1.5 py-1">
              <span className="text-[11px] text-muted-foreground mr-1">Insert Variable:</span>
              <button
                type="button"
                onClick={() => handleInsertVariable('{houseNo}')}
                className="text-[11px] font-mono px-2 py-0.5 rounded border border-border bg-background hover:bg-muted transition-colors text-foreground"
                title="Inserts tenant's house/unit number"
              >
                {'{houseNo}'}
              </button>
              <button
                type="button"
                onClick={() => handleInsertVariable('{month}')}
                className="text-[11px] font-mono px-2 py-0.5 rounded border border-border bg-background hover:bg-muted transition-colors text-foreground"
                title="Inserts billing month(s)"
              >
                {'{month}'}
              </button>
              <button
                type="button"
                onClick={() => handleInsertVariable('{name}')}
                className="text-[11px] font-mono px-2 py-0.5 rounded border border-border bg-background hover:bg-muted transition-colors text-foreground"
                title="Inserts tenant name"
              >
                {'{name}'}
              </button>
              <button
                type="button"
                onClick={() => handleInsertVariable('{plotName}')}
                className="text-[11px] font-mono px-2 py-0.5 rounded border border-border bg-background hover:bg-muted transition-colors text-foreground"
                title="Inserts plot/property name"
              >
                {'{plotName}'}
              </button>
              {balanceField && (
                <button
                  type="button"
                  onClick={() => handleInsertVariable('{balance}')}
                  className="text-[11px] font-mono px-2 py-0.5 rounded border border-border bg-background hover:bg-muted transition-colors text-foreground"
                  title="Inserts tenant balance"
                >
                  {'{balance}'}
                </button>
              )}
            </div>

            <Textarea
              id="smsMessageEditor"
              ref={textareaRef}
              value={messageText}
              disabled={loading}
              onChange={(e) => {
                setMessageText(e.target.value);
                setIsMessageModified(true);
              }}
              placeholder="Type or edit invoice SMS message..."
              rows={4}
              className="font-mono text-xs leading-relaxed resize-y min-h-[90px]"
            />

            {/* Warning if sending to multiple tenants without houseNo for templates that need it */}
            {targetRecords.length > 1 &&
              templateNeedsHouseNo &&
              !messageText.includes('{houseNo}') &&
              !messageText.includes('{house}') && (
                <div className="p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>
                    <strong>Note:</strong> This template uses house numbers for tenant payments, but{' '}
                    <code className="bg-amber-500/20 px-1 py-0.5 rounded">{'{houseNo}'}</code> is not in your message.
                    Recipients might not get their specific unit number in the SMS.
                  </span>
                </div>
              )}
          </div>

          {/* Live SMS Preview */}
          <div className="space-y-1.5 p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-muted-foreground flex items-center gap-1.5">
                Live Recipient Preview
                {sampleRecord && (
                  <Badge variant="outline" className="font-normal text-[11px]">
                    Sample: {sampleName} (House #{sampleHouseNo || 'N/A'})
                  </Badge>
                )}
              </span>
              <span className="text-[11px] text-muted-foreground">What the recipient sees</span>
            </div>

            <div className="p-3 rounded-md border bg-background font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground select-all shadow-xs">
              {previewMessage || <span className="text-muted-foreground italic">No message content</span>}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Dynamic variables like {'{houseNo}'}, {'{name}'}, and {'{balance}'} are automatically personalized for each tenant upon dispatch.
            </p>
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
