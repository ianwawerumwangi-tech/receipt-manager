'use server';

import { revalidatePath } from 'next/cache';
import ExcelJS from 'exceljs';
import { dbConnect } from '@/lib/mongodb';
import { Collection } from '@/models/Collection';
import { Field } from '@/models/Field';
import { Record as RecordModel } from '@/models/Record';
import { getSession } from '@/lib/auth';

// Evaluates formulas dynamically
function evaluateCell(sheet: ExcelJS.Worksheet, cell: ExcelJS.Cell): any {
  if (!cell) return null;
  const val = cell.value;
  if (val === null || val === undefined) return null;
  if (typeof val !== 'object') return val;
  
  // If it's a formula object
  if ('formula' in val) {
    const fVal = val as any;
    if (fVal.result !== undefined && fVal.result !== null) {
      return fVal.result;
    }
    try {
      const formula = fVal.formula.toUpperCase();
      const cellRegex = /[A-Z]+\d+/g;
      let evaluatedFormula = formula;
      const matches = Array.from(new Set(formula.match(cellRegex) || [])) as string[];
      
      for (const ref of matches) {
        const targetCell = sheet.getCell(ref);
        const cellVal = evaluateCell(sheet, targetCell) ?? 0;
        evaluatedFormula = evaluatedFormula.split(ref).join(String(cellVal));
      }
      
      const cleanExpr = evaluatedFormula.replace(/[^0-9.+\-*/()]/g, '');
      if (!cleanExpr) return null;
      
      const result = new Function(`return (${cleanExpr})`)();
      return result;
    } catch (e) {
      return null;
    }
  }
  
  // If it's a rich text object or something else
  if ('text' in val) {
    return (val as any).text;
  }
  
  return null;
}

function findHeaderRow(sheet: ExcelJS.Worksheet): number {
  const headerIndicators = ['HSE NO', 'HOUSE NO', 'NAME', 'TENANT', 'CUSTOMER', 'RCT NO', 'RECEIPT NUMBER', 'PHONE NO', 'RENT PAID'];
  
  for (let r = 1; r <= Math.min(sheet.rowCount, 20); r++) {
    const row = sheet.getRow(r);
    let matchCount = 0;
    row.eachCell({ includeEmpty: true }, (cell) => {
      const val = String(cell.value || '').trim().toUpperCase();
      if (headerIndicators.includes(val)) {
        matchCount++;
      }
    });
    if (matchCount >= 2) {
      return r;
    }
  }
  return 8; // fallback
}

export async function analyzeSpreadsheet(base64Data: string) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  try {
    const buffer = Buffer.from(base64Data, 'base64');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const sheets = workbook.worksheets.map(s => s.name);
    
    let detectedHeaderRow = 8;
    if (workbook.worksheets.length > 0) {
      const targetSheet = workbook.worksheets.find(s => !s.name.toLowerCase().includes('summary') && !s.name.toLowerCase().includes('total')) || workbook.worksheets[0];
      detectedHeaderRow = findHeaderRow(targetSheet);
    }

    return { sheets, detectedHeaderRow };
  } catch (error: any) {
    return { error: error.message || 'Failed to read spreadsheet' };
  }
}

export async function getSpreadsheetPreview(
  base64Data: string,
  sheetName: string,
  headerRowNumber: number
) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  try {
    const buffer = Buffer.from(base64Data, 'base64');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const targetSheetName = sheetName === '__all__'
      ? workbook.worksheets.map(s => s.name).find(name => !name.toLowerCase().includes('summary') && !name.toLowerCase().includes('total')) || workbook.worksheets[0].name
      : sheetName;

    const sheet = workbook.getWorksheet(targetSheetName);
    if (!sheet) return { error: `Worksheet "${targetSheetName}" not found` };

    const rowNum = Number(headerRowNumber);
    const headerRow = sheet.getRow(rowNum);
    const headers: string[] = [];
    
    // Read headers, keeping track of column numbers
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const val = cell.value;
      if (val && typeof val === 'string') {
        headers.push(val.trim());
      } else if (val && typeof val === 'number') {
        headers.push(String(val));
      } else {
        headers.push(`Column ${colNumber}`);
      }
    });

    const previewRows: Record<string, any>[] = [];
    const maxPreview = 5;
    let currentIdx = rowNum + 1;
    let previewCount = 0;

    while (currentIdx <= sheet.rowCount && previewCount < maxPreview) {
      const row = sheet.getRow(currentIdx);
      
      // Check if we should stop parsing (e.g. totals or empty row)
      const firstCellVal = String(row.getCell(1).value || '').trim();
      const lowerVal = firstCellVal.toLowerCase();
      if (
        !firstCellVal || 
        lowerVal.startsWith('total') || 
        lowerVal.startsWith('deduction') || 
        lowerVal.startsWith('less') || 
        lowerVal.startsWith('bal b/f') || 
        lowerVal.startsWith('amount due') || 
        lowerVal.startsWith('authorise')
      ) {
        break;
      }

      const rowData: Record<string, any> = {};
      let hasData = false;

      headers.forEach((header, index) => {
        const colNum = index + 1;
        const cell = row.getCell(colNum);
        const val = evaluateCell(sheet, cell);
        if (val !== null && val !== undefined && val !== '') {
          rowData[header] = val;
          hasData = true;
        } else {
          rowData[header] = null;
        }
      });

      if (hasData) {
        previewRows.push(rowData);
        previewCount++;
      }
      currentIdx++;
    }

    return { headers, previewRows };
  } catch (error: any) {
    return { error: error.message || 'Failed to generate preview' };
  }
}

export async function importSpreadsheet(data: {
  collectionId: string;
  base64Data: string;
  sheetName: string;
  headerRowNumber: number;
  mappings: Record<string, string>; // collectionFieldName -> excelHeaderName (or "__create_new__" or "__skip__" or "__sheet_name__")
  createNewFields: { name: string; type: string }[];
}) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  try {
    await dbConnect();
    
    // 1. Create any new fields if requested
    for (const newField of data.createNewFields) {
      const maxOrder = await Field.findOne({ collectionId: data.collectionId })
        .sort({ order: -1 })
        .select('order')
        .lean();
      
      await Field.create({
        collectionId: data.collectionId,
        name: newField.name,
        type: newField.type,
        required: false,
        order: (maxOrder?.order ?? -1) + 1,
      });
    }

    // Load workbook
    const buffer = Buffer.from(data.base64Data, 'base64');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const sheetNames = data.sheetName === '__all__'
      ? workbook.worksheets
          .map(s => s.name)
          .filter(name => !name.toLowerCase().includes('summary') && !name.toLowerCase().includes('total'))
      : [data.sheetName];

    let importCount = 0;
    const recordsToInsert: any[] = [];

    for (const currentSheetName of sheetNames) {
      const sheet = workbook.getWorksheet(currentSheetName);
      if (!sheet) continue;

      const rowNum = Number(data.headerRowNumber);
      if (sheet.rowCount < rowNum) continue;

      const headerRow = sheet.getRow(rowNum);
      const headers: string[] = [];
      headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const val = cell.value;
        if (val && typeof val === 'string') {
          headers.push(val.trim());
        } else if (val && typeof val === 'number') {
          headers.push(String(val));
        } else {
          headers.push(`Column ${colNumber}`);
        }
      });

      let currentIdx = rowNum + 1;

      while (currentIdx <= sheet.rowCount) {
        const row = sheet.getRow(currentIdx);
        
        // Stop condition
        const firstCellVal = String(row.getCell(1).value || '').trim();
        const lowerVal = firstCellVal.toLowerCase();
        if (
          !firstCellVal || 
          lowerVal.startsWith('total') || 
          lowerVal.startsWith('deduction') || 
          lowerVal.startsWith('less') || 
          lowerVal.startsWith('bal b/f') || 
          lowerVal.startsWith('amount due') || 
          lowerVal.startsWith('authorise')
        ) {
          break;
        }

        const rowValues: Record<string, any> = {};
        headers.forEach((header, index) => {
          const colNum = index + 1;
          const cell = row.getCell(colNum);
          rowValues[header] = evaluateCell(sheet, cell);
        });

        // Map dynamic record data
        const recordData: Record<string, any> = {};
        let hasMappedData = false;

        for (const [fieldName, excelHeader] of Object.entries(data.mappings)) {
          if (excelHeader === '__skip__') {
            continue;
          }
          if (excelHeader === '__sheet_name__') {
            recordData[fieldName] = currentSheetName;
            hasMappedData = true;
            continue;
          }

          const excelValue = rowValues[excelHeader];
          if (excelValue !== null && excelValue !== undefined) {
            recordData[fieldName] = excelValue;
            hasMappedData = true;
          }
        }

        if (hasMappedData) {
          // Parse installments from formulas and slash-separated receipt numbers
          const amountFieldKey = Object.keys(data.mappings).find(
            (name) => name.toUpperCase() === 'RENT PAID' || name.toUpperCase() === 'AMOUNT PAID' || name.toUpperCase() === 'AMOUNT'
          );
          const rctFieldKey = Object.keys(data.mappings).find(
            (name) => name.toUpperCase() === 'RCT NO' || name.toUpperCase() === 'RECEIPT NUMBER' || name.toUpperCase() === 'RECEIPT NO'
          );

          if (amountFieldKey && rctFieldKey) {
            const amountExcelHeader = data.mappings[amountFieldKey];
            const rctExcelHeader = data.mappings[rctFieldKey];
            
            if (amountExcelHeader && rctExcelHeader) {
              const amountColIndex = headers.indexOf(amountExcelHeader);
              const amountCell = amountColIndex !== -1 ? row.getCell(amountColIndex + 1) : null;
              const rctVal = String(recordData[rctFieldKey] || '').trim();
              
              let amounts: number[] = [];
              if (amountCell && amountCell.value && typeof amountCell.value === 'object' && 'formula' in amountCell.value) {
                const formula = (amountCell.value.formula || '').replace(/^=/, '').trim();
                const parts = formula.split('+').map(p => Number(p.trim()));
                if (parts.every(p => !isNaN(p))) {
                  amounts = parts;
                }
              }
              
              const rcts = rctVal.split('/').map(r => r.trim()).filter(Boolean);
              if (amounts.length > 0 || rcts.length > 1) {
                const installments = [];
                const count = Math.max(amounts.length, rcts.length);
                for (let i = 0; i < count; i++) {
                  installments.push({
                    amount: amounts[i] ?? (amounts.length === 1 ? amounts[0] : 0),
                    rct: rcts[i] ?? (rcts.length === 1 ? rcts[0] : ''),
                  });
                }
                recordData['_installments'] = installments;
              }
            }
          }

          // Auto-validate/correct receipt numbers mapped to RCT NO / RECEIPT NUMBER
          const rctFieldNames = Object.keys(data.mappings).filter(
            (name) => name.toUpperCase() === 'RCT NO' || name.toUpperCase() === 'RECEIPT NUMBER'
          );

          for (const rctFieldName of rctFieldNames) {
            let val = String(recordData[rctFieldName] || '').trim().toUpperCase();
            const rcts = val.split('/').map(r => r.trim()).filter(Boolean);
            const isValidFormat = rcts.length > 0 && rcts.every(r => r.length === 10 && /^[A-Z0-9]+$/.test(r));
            
            let isDuplicate = false;
            if (isValidFormat) {
              for (const rct of rcts) {
                const dbDup = await RecordModel.findOne({
                  collectionId: data.collectionId,
                  [`data.${rctFieldName}`]: { $regex: new RegExp(`(^|/)${rct}($|/)`) },
                });
                const batchDup = recordsToInsert.some((r) => {
                  const rVal = String(r.data[rctFieldName] || '');
                  return rVal.split('/').map(x => x.trim()).includes(rct);
                });
                if (dbDup || batchDup) {
                  isDuplicate = true;
                  break;
                }
              }
            }

            if (!val || !isValidFormat || isDuplicate) {
              const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
              let isUnique = false;
              let generated = '';
              while (!isUnique) {
                generated = '';
                for (let i = 0; i < 10; i++) {
                  generated += chars.charAt(Math.floor(Math.random() * chars.length));
                }
                const dbDup = await RecordModel.findOne({
                  collectionId: data.collectionId,
                  [`data.${rctFieldName}`]: { $regex: new RegExp(`(^|/)${generated}($|/)`) },
                });
                const batchDup = recordsToInsert.some((r) => {
                  const rVal = String(r.data[rctFieldName] || '');
                  return rVal.split('/').map(x => x.trim()).includes(generated);
                });
                if (!dbDup && !batchDup) {
                  isUnique = true;
                }
              }
              recordData[rctFieldName] = generated;
            } else {
              recordData[rctFieldName] = val;
            }
          }

          recordsToInsert.push({
            collectionId: data.collectionId,
            data: recordData,
            createdBy: session.userId,
          });
        }

        currentIdx++;
      }
    }

    if (recordsToInsert.length > 0) {
      await RecordModel.insertMany(recordsToInsert);
      importCount = recordsToInsert.length;
    }

    revalidatePath(`/collections/${data.collectionId}`);
    return { success: true, count: importCount };
  } catch (error: any) {
    return { error: error.message || 'Failed to import data' };
  }
}

export async function importNewCollection(data: {
  name: string;
  description?: string;
  base64Data: string;
  sheetName: string;
  headerRowNumber: number;
  fields: { name: string; type: string }[];
}) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  try {
    await dbConnect();

    // Load workbook
    const buffer = Buffer.from(data.base64Data, 'base64');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const sheetNames = data.sheetName === '__all__'
      ? workbook.worksheets
          .map(s => s.name)
          .filter(name => !name.toLowerCase().includes('summary') && !name.toLowerCase().includes('total'))
      : [data.sheetName];

    let totalImported = 0;
    let lastCollectionId = '';

    for (const currentSheetName of sheetNames) {
      const baseName = data.name.replace(/\s+Receipts$/i, '').trim();
      const collectionName = data.sheetName === '__all__'
        ? `${baseName} - ${currentSheetName}`
        : data.name;

      // 1. Create the Collection
      const collection = await Collection.create({
        name: collectionName,
        description: data.description || `Imported from sheet ${currentSheetName}`,
        createdBy: session.userId,
      });

      lastCollectionId = collection._id.toString();

      // 2. Create the Fields
      const fieldsToCreate = data.fields.map((f, idx) => ({
        collectionId: collection._id,
        name: f.name,
        type: f.type,
        required: false,
        order: idx,
      }));
      await Field.create(fieldsToCreate);

      // 3. Setup mappings for all created fields
      const mappings: Record<string, string> = {};
      data.fields.forEach((f) => {
        mappings[f.name] = f.name;
      });

      // 4. Import the spreadsheet records for this sheet
      const res = await importSpreadsheet({
        collectionId: collection._id.toString(),
        base64Data: data.base64Data,
        sheetName: currentSheetName,
        headerRowNumber: data.headerRowNumber,
        mappings,
        createNewFields: [], // already created
      });

      if ('error' in res) {
        return res;
      }
      totalImported += res.count;
    }

    revalidatePath('/collections');
    return { success: true, collectionId: lastCollectionId, count: totalImported };
  } catch (error: any) {
    return { error: error.message || 'Failed to create and import collection' };
  }
}
