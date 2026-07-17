'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  analyzeSpreadsheet,
  getSpreadsheetPreview,
  importSpreadsheet,
  importNewCollection,
} from '@/actions/import.actions';
import { getCollections } from '@/actions/collection.actions';
import { getFields } from '@/actions/field.actions';
import { FileUp, Loader2, Check, AlertCircle, Plus, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';

interface FieldItem {
  _id: string;
  collectionId: string;
  name: string;
  type: string;
  required: boolean;
}

export function ImportDialog({
  collectionId,
  collectionFields = [],
  onSuccess,
}: {
  collectionId?: string;
  collectionFields?: FieldItem[];
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'upload' | 'mapping' | 'importing'>('upload');
  
  // File states
  const [file, setFile] = useState<File | null>(null);
  const [base64Data, setBase64Data] = useState<string>('');
  const [sheets, setSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [headerRow, setHeaderRow] = useState<number>(10);
  
  // Universal Import states
  const [existingCollections, setExistingCollections] = useState<{ _id: string; name: string }[]>([]);
  const [targetCollectionType, setTargetCollectionType] = useState<string>('__new__'); // '__new__' or existing collection ID
  const [newCollectionName, setNewCollectionName] = useState<string>('');
  const [dynFields, setDynFields] = useState<FieldItem[]>([]);
  
  // Preview / Mapping states
  const [excelHeaders, setExcelHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, any>[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({}); // fieldName -> excelHeader (or __skip__ or __sheet_name__)
  const [newFieldsToCreate, setNewFieldsToCreate] = useState<Record<string, { create: boolean; type: string }>>({}); // excelHeader -> { create, type }
  
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // Initialize if collectionId is provided
  useEffect(() => {
    if (collectionId) {
      setDynFields(collectionFields);
      setTargetCollectionType(collectionId);
    }
  }, [collectionId, collectionFields]);

  // Load existing collections for Universal Mode
  useEffect(() => {
    if (!collectionId && open) {
      getCollections().then((cols) => {
        setExistingCollections(cols.map(c => ({ _id: c._id, name: c.name })));
      });
    }
  }, [collectionId, open]);

  // Handle changing target collection
  const handleTargetTypeChange = async (val: string) => {
    setTargetCollectionType(val);
    if (val !== '__new__') {
      setLoading(true);
      try {
        const fields = await getFields(val);
        setDynFields(fields);
      } catch (err) {
        console.error(err);
        toast.error('Failed to load collection fields');
      } finally {
        setLoading(false);
      }
    } else {
      setDynFields([]);
    }
  };

  // Convert file to Base64
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setAnalyzing(true);

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        setBase64Data(base64);

        const res = await analyzeSpreadsheet(base64);
        if ('error' in res) {
          toast.error(res.error || 'Failed to analyze file');
          setFile(null);
          setAnalyzing(false);
          return;
        }

        setSheets(res.sheets || []);
        if (res.detectedHeaderRow !== undefined) {
          setHeaderRow(res.detectedHeaderRow);
        }
        if (res.sheets && res.sheets.length > 0) {
          const defaultSheet = res.sheets.length > 1 ? '__all__' : res.sheets[0];
          setSelectedSheet(defaultSheet);
          const baseName = selectedFile.name.replace(/\.[^/.]+$/, "");
          setNewCollectionName(baseName + ' Receipts');
        }
        setStep('mapping');
        setAnalyzing(false);
      };
      reader.readAsArrayBuffer(selectedFile);
    } catch (err) {
      console.error(err);
      toast.error('Failed to read file');
      setAnalyzing(false);
    }
  };

  // Fetch sheet preview
  const fetchPreview = useCallback(async () => {
    if (!base64Data || !selectedSheet) return;
    setLoading(true);

    try {
      const res = await getSpreadsheetPreview(base64Data, selectedSheet, headerRow);
      if ('error' in res) {
        toast.error(res.error || 'Failed to fetch preview');
        setLoading(false);
        return;
      }

      setExcelHeaders(res.headers || []);
      setPreviewRows(res.previewRows || []);
      
      // Auto-mapping for existing fields (if target is not __new__)
      if (targetCollectionType !== '__new__') {
        const newMappings: Record<string, string> = {};
        dynFields.forEach((field) => {
          const fieldKey = field.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          const matchedHeader = (res.headers || []).find((h: string) => {
            const headerKey = h.toLowerCase().replace(/[^a-z0-9]/g, '');
            return headerKey === fieldKey;
          });

          if (matchedHeader) {
            newMappings[field.name] = matchedHeader;
          } else {
            if (field.name.toUpperCase() === 'PERIOD') {
              newMappings[field.name] = '__sheet_name__';
            } else {
              newMappings[field.name] = '__skip__';
            }
          }
        });
        setMappings(newMappings);
      }

      // Populate default new fields mapping state (create all columns by default if new collection, or unmapped if existing)
      const initialNewFields: Record<string, { create: boolean; type: string }> = {};
      (res.headers || []).forEach((header: string) => {
        const isMapped = targetCollectionType !== '__new__' && 
          dynFields.some(f => f.name.toLowerCase().replace(/[^a-z0-9]/g, '') === header.toLowerCase().replace(/[^a-z0-9]/g, ''));
        
        // If importing to new collection, we create all columns as fields by default.
        // If importing to existing collection, we only suggest creating unmapped columns.
        initialNewFields[header] = { 
          create: targetCollectionType === '__new__' || !isMapped, 
          type: header.toUpperCase().includes('AMOUNT') || 
                header.toUpperCase().includes('RENT') || 
                header.toUpperCase().includes('BAL') || 
                header.toUpperCase().includes('PAID') || 
                header.toUpperCase().includes('DUE') ||
                header.toUpperCase().includes('BALANCE') ||
                header.toUpperCase().includes('DEPOSIT')
                  ? 'number' 
                  : 'text' 
        };
      });
      setNewFieldsToCreate(initialNewFields);

    } catch (err) {
      console.error(err);
      toast.error('Failed to load sheet data');
    } finally {
      setLoading(false);
    }
  }, [base64Data, selectedSheet, headerRow, targetCollectionType, dynFields]);

  useEffect(() => {
    if (step === 'mapping') {
      fetchPreview();
    }
  }, [step, selectedSheet, headerRow, fetchPreview]);

  // Handle final import submission
  const handleImportSubmit = async () => {
    setStep('importing');
    setLoading(true);

    try {
      if (targetCollectionType === '__new__') {
        // 1. Create a new collection
        if (!newCollectionName.trim()) {
          toast.error('Collection Name is required');
          setStep('mapping');
          setLoading(false);
          return;
        }

        const fieldsToCreate = Object.entries(newFieldsToCreate)
          .filter(([_, value]) => value.create)
          .map(([header, value]) => ({
            name: header,
            type: value.type,
          }));

        const res = await importNewCollection({
          name: newCollectionName,
          base64Data,
          sheetName: selectedSheet,
          headerRowNumber: headerRow,
          fields: fieldsToCreate,
        });

        if ('error' in res) {
          toast.error(res.error || 'Failed to create and import collection');
          setStep('mapping');
        } else {
          toast.success(`Successfully created collection and imported ${res.count} records!`);
          setOpen(false);
          resetState();
          onSuccess();
        }

      } else {
        // 2. Import into an existing collection
        const createFieldsList = Object.entries(newFieldsToCreate)
          .filter(([_, value]) => value.create)
          .map(([header, value]) => ({
            name: header,
            type: value.type,
          }));

        const finalMappings = { ...mappings };
        createFieldsList.forEach((field) => {
          finalMappings[field.name] = field.name;
        });

        const res = await importSpreadsheet({
          collectionId: targetCollectionType,
          base64Data,
          sheetName: selectedSheet,
          headerRowNumber: headerRow,
          mappings: finalMappings,
          createNewFields: createFieldsList,
        });

        if ('error' in res) {
          toast.error(res.error || 'Import failed');
          setStep('mapping');
        } else {
          toast.success(`Successfully imported ${res.count} records!`);
          setOpen(false);
          resetState();
          onSuccess();
        }
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to import spreadsheet');
      setStep('mapping');
    } finally {
      setLoading(false);
    }
  };

  const resetState = () => {
    setStep('upload');
    setFile(null);
    setBase64Data('');
    setSheets([]);
    setSelectedSheet('');
    setHeaderRow(10);
    setExcelHeaders([]);
    setPreviewRows([]);
    setMappings({});
    setNewFieldsToCreate({});
    if (!collectionId) {
      setTargetCollectionType('__new__');
      setDynFields([]);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (!isOpen) resetState();
      }}
    >
      <DialogTrigger render={
        <Button variant="outline" size="sm" className="relative overflow-hidden group">
          <FileUp className="h-4 w-4 mr-1.5 transition-transform group-hover:-translate-y-0.5" />
          Import Spreadsheet
        </Button>
      } />
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-6">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <FileUp className="h-5 w-5 text-primary" />
            Import Spreadsheet Data
          </DialogTitle>
        </DialogHeader>

        {step === 'upload' && (
          <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/20 rounded-xl p-12 bg-muted/10 hover:bg-muted/20 transition-all duration-300 relative group cursor-pointer">
            <input
              type="file"
              accept=".xlsx, .xls, .csv"
              onChange={handleFileChange}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              disabled={analyzing}
            />
            {analyzing ? (
              <div className="text-center space-y-4">
                <Loader2 className="h-12 w-12 text-primary animate-spin mx-auto" />
                <p className="font-semibold text-lg">Analyzing Spreadsheet...</p>
                <p className="text-sm text-muted-foreground">Reading workbook structure and worksheets</p>
              </div>
            ) : (
              <div className="text-center space-y-4">
                <div className="p-4 bg-primary/5 rounded-full inline-block group-hover:scale-110 transition-transform duration-300">
                  <FileUp className="h-12 w-12 text-primary" />
                </div>
                <p className="font-semibold text-lg text-foreground">Click to upload or drag & drop</p>
                <p className="text-sm text-muted-foreground">Supports Excel (.xlsx, .xls) and CSV files</p>
              </div>
            )}
          </div>
        )}

        {step === 'mapping' && (
          <div className="flex-1 flex flex-col gap-6 overflow-hidden min-h-0">
            {/* Target Collection Options (only if universal mode, i.e., no collectionId prop passed) */}
            {!collectionId && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-muted/30 p-4 rounded-lg">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Target Collection</Label>
                  <Select value={targetCollectionType} onValueChange={(val) => { if (val) handleTargetTypeChange(val); }}>
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder="Select target" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__new__">Create New Collection</SelectItem>
                      {existingCollections.map((c) => (
                        <SelectItem key={c._id} value={c._id}>
                          Import into: {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {targetCollectionType === '__new__' ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="new-col-name" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">New Collection Name</Label>
                    <Input
                      id="new-col-name"
                      value={newCollectionName}
                      onChange={(e) => setNewCollectionName(e.target.value)}
                      className="bg-background"
                      placeholder="e.g. Anita Jan Receipts"
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5 flex items-end">
                    <span className="text-xs text-muted-foreground pb-2">
                      Importing into existing collection &quot;{existingCollections.find(c => c._id === targetCollectionType)?.name}&quot;
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Sheet & Header row settings */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-muted/30 p-4 rounded-lg">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Select Worksheet</Label>
                <Select value={selectedSheet} onValueChange={(val) => { if (val) setSelectedSheet(val); }}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Choose sheet" />
                  </SelectTrigger>
                  <SelectContent>
                    {sheets.length > 1 && (
                      <>
                        <SelectItem value="__all__">
                          <span className="font-semibold text-primary">Import All Worksheets ({sheets.length})</span>
                        </SelectItem>
                        <div className="h-px bg-muted my-1" />
                      </>
                    )}
                    {sheets.map((sheet) => (
                      <SelectItem key={sheet} value={sheet}>
                        {sheet}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="header-row" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Header Row Number</Label>
                <div className="flex gap-2 items-center">
                  <Input
                    id="header-row"
                    type="number"
                    min={1}
                    value={headerRow}
                    onChange={(e) => setHeaderRow(Number(e.target.value))}
                    className="bg-background w-28"
                  />
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <HelpCircle className="h-3.5 w-3.5" />
                    Header row index (default: 10)
                  </span>
                </div>
              </div>
            </div>

            {loading ? (
              <div className="flex-1 flex flex-col items-center justify-center py-12 space-y-4">
                <Loader2 className="h-8 w-8 text-primary animate-spin" />
                <p className="text-sm text-muted-foreground">Generating column mapping and row previews...</p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col gap-6 overflow-y-auto pr-1">
                
                {/* Column Mapping Section (Only if importing to existing collection) */}
                {targetCollectionType !== '__new__' && dynFields.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-500" />
                      Map Spreadsheet Columns to Collection Fields
                    </h3>
                    <div className="rounded-md border overflow-hidden">
                      <Table>
                        <TableHeader className="bg-muted/50">
                          <TableRow>
                            <TableHead className="w-1/3">Collection Field</TableHead>
                            <TableHead className="w-1/3">Source Excel Column</TableHead>
                            <TableHead className="w-1/3">Mapping Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {dynFields.map((field) => {
                            const currentVal = mappings[field.name] || '__skip__';
                            return (
                              <TableRow key={field._id}>
                                <TableCell className="font-medium flex items-center gap-2">
                                  {field.name}
                                  <Badge variant="outline" className="text-[10px] py-0.5">
                                    {field.type}
                                  </Badge>
                                  {field.required && <span className="text-destructive font-bold">*</span>}
                                </TableCell>
                                <TableCell>
                                  <Select
                                    value={currentVal}
                                    onValueChange={(val) => { if (val) setMappings({ ...mappings, [field.name]: val }); }}
                                  >
                                    <SelectTrigger className="h-9">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__skip__">
                                        <span className="text-muted-foreground italic">Skip column</span>
                                      </SelectItem>
                                      <SelectItem value="__sheet_name__">
                                        <span className="text-primary italic">Use Sheet Name ({selectedSheet})</span>
                                      </SelectItem>
                                      <SelectSeparator />
                                      {excelHeaders.map((header) => (
                                        <SelectItem key={header} value={header}>
                                          {header}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                                <TableCell>
                                  {currentVal === '__skip__' ? (
                                    <span className="text-xs text-muted-foreground italic flex items-center gap-1">
                                      <AlertCircle className="h-3.5 w-3.5" /> Skipped
                                    </span>
                                  ) : currentVal === '__sheet_name__' ? (
                                    <span className="text-xs text-primary font-medium flex items-center gap-1">
                                      <Check className="h-3.5 w-3.5 text-primary" /> Populated by &quot;{selectedSheet}&quot;
                                    </span>
                                  ) : (
                                    <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                                      <Check className="h-3.5 w-3.5 text-green-500" /> Mapped to {currentVal}
                                    </span>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {/* Create Fields Section (Show all columns for Create New, or only unmapped for Import Existing) */}
                {excelHeaders.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      <Plus className="h-4 w-4 text-primary" />
                      {targetCollectionType === '__new__' 
                        ? 'Define Collection Schema from Spreadsheet Columns' 
                        : 'Unmapped Excel Columns (Flexible Schema Extension)'}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {targetCollectionType === '__new__'
                        ? 'Choose which columns to create as fields in the new collection, and select their data types:'
                        : 'These columns exist in your spreadsheet but are not currently defined in your collection. You can dynamically create them as new fields:'}
                    </p>
                    <div className="rounded-md border overflow-hidden">
                      <Table>
                        <TableHeader className="bg-muted/50">
                          <TableRow>
                            <TableHead className="w-12"></TableHead>
                            <TableHead>Excel Column Name</TableHead>
                            <TableHead className="w-60">Field Type</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {excelHeaders
                            .filter((header) => {
                              if (targetCollectionType === '__new__') return true;
                              return !Object.values(mappings).includes(header) && 
                                !dynFields.some(f => f.name.toLowerCase().replace(/[^a-z0-9]/g, '') === header.toLowerCase().replace(/[^a-z0-9]/g, ''));
                            })
                            .map((header) => {
                              const state = newFieldsToCreate[header] || { create: false, type: 'text' };
                              return (
                                <TableRow key={header}>
                                  <TableCell>
                                    <Checkbox
                                      checked={state.create}
                                      onCheckedChange={(checked) =>
                                        setNewFieldsToCreate({
                                          ...newFieldsToCreate,
                                          [header]: { ...state, create: checked === true },
                                        })
                                      }
                                    />
                                  </TableCell>
                                  <TableCell className="font-medium text-foreground">
                                    {header}
                                  </TableCell>
                                  <TableCell>
                                    <Select
                                      disabled={!state.create}
                                      value={state.type}
                                      onValueChange={(val) => {
                                        if (val) {
                                          setNewFieldsToCreate({
                                            ...newFieldsToCreate,
                                            [header]: { ...state, type: val },
                                          });
                                        }
                                      }}
                                    >
                                      <SelectTrigger className="h-8 bg-background">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="text">Text</SelectItem>
                                        <SelectItem value="number">Number</SelectItem>
                                        <SelectItem value="date">Date</SelectItem>
                                        <SelectItem value="boolean">Yes/No</SelectItem>
                                        <SelectItem value="textarea">Long Text</SelectItem>
                                        <SelectItem value="email">Email</SelectItem>
                                        <SelectItem value="phone">Phone</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {/* Import Preview Section */}
                {previewRows.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="font-semibold text-sm">Preview Data Rows (Evaluated Formulas)</h3>
                    <div className="rounded-md border overflow-x-auto">
                      <Table>
                        <TableHeader className="bg-muted/30">
                          <TableRow>
                            {excelHeaders.slice(0, 8).map((header) => (
                              <TableHead key={header} className="text-xs whitespace-nowrap">{header}</TableHead>
                            ))}
                            {excelHeaders.length > 8 && <TableHead className="text-xs">...</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {previewRows.map((row, rIdx) => (
                            <TableRow key={rIdx}>
                              {excelHeaders.slice(0, 8).map((header) => (
                                <TableCell key={header} className="text-xs whitespace-nowrap max-w-[150px] truncate">
                                  {row[header] === null || row[header] === undefined ? (
                                    <span className="text-muted-foreground italic">-</span>
                                  ) : typeof row[header] === 'boolean' ? (
                                    row[header] ? 'Yes' : 'No'
                                  ) : (
                                    String(row[header])
                                  )}
                                </TableCell>
                              ))}
                              {excelHeaders.length > 8 && <TableCell className="text-xs text-muted-foreground">...</TableCell>}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-between items-center pt-4 border-t bg-background">
              <Button variant="ghost" onClick={resetState}>
                Cancel
              </Button>
              <Button onClick={handleImportSubmit} disabled={loading || excelHeaders.length === 0}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Import Mapped Records
              </Button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div className="flex-1 flex flex-col items-center justify-center p-12 space-y-4">
            <Loader2 className="h-12 w-12 text-primary animate-spin" />
            <h3 className="text-lg font-semibold">Importing Data...</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              Please wait while the spreadsheet records are parsed, formulas are evaluated, and data is saved to your collection.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SelectSeparator() {
  return <div className="h-px bg-muted my-1" />;
}
