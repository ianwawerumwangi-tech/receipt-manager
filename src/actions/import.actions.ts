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

export async function analyzeSpreadsheet(base64Data: string) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  try {
    const buffer = Buffer.from(base64Data, 'base64');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const sheets = workbook.worksheets.map(s => s.name);
    return { sheets };
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

    const sheet = workbook.getWorksheet(sheetName);
    if (!sheet) return { error: `Worksheet "${sheetName}" not found` };

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

    const sheet = workbook.getWorksheet(data.sheetName);
    if (!sheet) return { error: `Worksheet "${data.sheetName}" not found` };

    const rowNum = Number(data.headerRowNumber);
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
    let importCount = 0;

    // We will collect records and insert them
    const recordsToInsert: any[] = [];

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
          recordData[fieldName] = data.sheetName;
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
        // Auto-validate/correct receipt numbers mapped to RCT NO / RECEIPT NUMBER
        const rctFieldNames = Object.keys(data.mappings).filter(
          (name) => name.toUpperCase() === 'RCT NO' || name.toUpperCase() === 'RECEIPT NUMBER'
        );

        for (const rctFieldName of rctFieldNames) {
          let val = String(recordData[rctFieldName] || '').trim().toUpperCase();
          const isValidFormat = val.length === 10 && /^[A-Z0-9]+$/.test(val);
          
          let isDuplicate = false;
          if (isValidFormat) {
            const dbDup = await RecordModel.findOne({
              collectionId: data.collectionId,
              [`data.${rctFieldName}`]: val,
            });
            const batchDup = recordsToInsert.some((r) => r.data[rctFieldName] === val);
            isDuplicate = !!dbDup || batchDup;
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
                [`data.${rctFieldName}`]: generated,
              });
              const batchDup = recordsToInsert.some((r) => r.data[rctFieldName] === generated);
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

    // 1. Create the Collection
    const collection = await Collection.create({
      name: data.name,
      description: data.description || 'Imported from spreadsheet',
      createdBy: session.userId,
    });

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

    // 4. Import the spreadsheet records
    const res = await importSpreadsheet({
      collectionId: collection._id.toString(),
      base64Data: data.base64Data,
      sheetName: data.sheetName,
      headerRowNumber: data.headerRowNumber,
      mappings,
      createNewFields: [], // already created
    });

    if ('error' in res) {
      return res;
    }

    revalidatePath('/collections');
    return { success: true, collectionId: collection._id.toString(), count: res.count };
  } catch (error: any) {
    return { error: error.message || 'Failed to create and import collection' };
  }
}
