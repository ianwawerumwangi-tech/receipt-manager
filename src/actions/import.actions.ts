'use server';

import { revalidatePath } from 'next/cache';
import ExcelJS from 'exceljs';
import { dbConnect } from '@/lib/mongodb';
import { Collection } from '@/models/Collection';
import { Field } from '@/models/Field';
import { Record as RecordModel } from '@/models/Record';
import { getSession } from '@/lib/auth';
import { findLatestMonthSheet } from '@/lib/utils';
import { bulkLookupTenantPhones } from '@/actions/customer.actions';

// Evaluates formulas dynamically
function evaluateCell(sheet: ExcelJS.Worksheet, cell: ExcelJS.Cell, workbook?: ExcelJS.Workbook): any {
  if (!cell) return null;
  const val = cell.value;
  if (val === null || val === undefined) return null;
  if (typeof val !== 'object') return val;
  if (val instanceof Date) return val.toISOString().split('T')[0];

  if ('result' in val && val.result !== undefined && val.result !== null) {
    if (typeof val.result === 'object') {
      if ((val.result as any).error) return null;
      if ('result' in (val.result as any)) return (val.result as any).result;
    } else {
      return val.result;
    }
  }

  if ('formula' in val || 'sharedFormula' in val) {
    try {
      const fVal = val as any;
      let formula = String(fVal.formula || '').toUpperCase();

      if (!formula && fVal.sharedFormula) {
        const masterCell = sheet.getCell(String(fVal.sharedFormula));
        const masterVal = masterCell?.value as any;
        if (masterVal && typeof masterVal === 'object' && masterVal.formula) {
          const masterFormula = String(masterVal.formula).toUpperCase();
          const rowOffset = Number(cell.row) - Number(masterCell.row);
          const colOffset = Number(cell.col) - Number(masterCell.col);

          formula = masterFormula.replace(
            /([A-Z0-9_]+!)?(\$?)([A-Z]+)(\$?)([0-9]+)/g,
            (_match, sheetPrefix, absCol, colLetters, absRow, rowNum) => {
              let newCol = colLetters;
              let newRow = rowNum;
              if (!absCol && colOffset !== 0) {
                let colIdx = 0;
                for (let i = 0; i < colLetters.length; i++) {
                  colIdx = colIdx * 26 + (colLetters.charCodeAt(i) - 64);
                }
                colIdx += colOffset;
                if (colIdx > 0) {
                  let temp = '';
                  while (colIdx > 0) {
                    const rem = (colIdx - 1) % 26;
                    temp = String.fromCharCode(65 + rem) + temp;
                    colIdx = Math.floor((colIdx - 1) / 26);
                  }
                  newCol = temp;
                }
              }
              if (!absRow && rowOffset !== 0) {
                newRow = String(parseInt(rowNum, 10) + rowOffset);
              }
              return (sheetPrefix || '') + (absCol || '') + newCol + (absRow || '') + newRow;
            }
          );
        } else {
          return evaluateCell(sheet, masterCell, workbook);
        }
      }

      if (!formula) return null;

      const cellRegex = /([A-Z0-9_]+!)?[A-Z]+\d+/g;
      let evaluatedFormula = formula;
      const matches = Array.from(new Set(formula.match(cellRegex) || [])) as string[];

      for (const ref of matches) {
        let targetSheet = sheet;
        let cellRef = ref;
        if (ref.includes('!')) {
          const [sName, cRef] = ref.split('!');
          if (workbook) {
            targetSheet = workbook.getWorksheet(sName) || sheet;
          }
          cellRef = cRef;
        }
        const targetCell = targetSheet.getCell(cellRef);
        const cellVal = evaluateCell(targetSheet, targetCell, workbook) ?? 0;
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

  if ('text' in val) {
    return (val as any).text;
  }
  if ('richText' in val && Array.isArray((val as any).richText)) {
    return (val as any).richText.map((t: any) => t.text).join('');
  }

  return null;
}

function findHeaderRow(sheet: ExcelJS.Worksheet): number {
  const headerIndicators = [
    'HSE NO', 'HOUSE NO', 'NAME', 'TENANT', 'CUSTOMER', 'RCT NO', 'RECEIPT NUMBER', 'PHONE NO', 'RENT PAID',
    'CURRENT', 'PREVIOUS', 'PREV', 'CURR', 'CONSUMPTION', 'WATER BILL', 'BAL B/D', 'TOTAL BILL'
  ];
  
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
    const firstSheet = sheets[0] || '';
    const latestSheet = firstSheet || findLatestMonthSheet(sheets);
    
    let detectedHeaderRow = 8;
    if (workbook.worksheets.length > 0) {
      const targetSheet = workbook.getWorksheet(firstSheet) || workbook.worksheets.find(s => !s.name.toLowerCase().includes('summary') && !s.name.toLowerCase().includes('total')) || workbook.worksheets[0];
      detectedHeaderRow = findHeaderRow(targetSheet);
    }

    return { sheets, detectedHeaderRow, latestSheet };
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
        const val = evaluateCell(sheet, cell, workbook);
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

    // Ensure PHONE NO field exists on the collection
    const existingFields = await Field.find({ collectionId: data.collectionId });
    const hasPhoneField = existingFields.some(f => ['PHONE NO', 'PHONE', 'PHONE NUMBER', 'MOBILE'].includes(f.name.toUpperCase())) ||
      data.createNewFields.some(f => ['PHONE NO', 'PHONE', 'PHONE NUMBER', 'MOBILE'].includes(f.name.toUpperCase()));

    let phoneFieldName = 'PHONE NO';
    if (!hasPhoneField) {
      const maxOrder = await Field.findOne({ collectionId: data.collectionId })
        .sort({ order: -1 })
        .select('order')
        .lean();

      await Field.create({
        collectionId: data.collectionId,
        name: 'PHONE NO',
        type: 'phone',
        required: false,
        order: (maxOrder?.order ?? -1) + 1,
      });
      phoneFieldName = 'PHONE NO';
    } else {
      const found = existingFields.find(f => ['PHONE NO', 'PHONE', 'PHONE NUMBER', 'MOBILE'].includes(f.name.toUpperCase()));
      if (found) {
        phoneFieldName = found.name;
      }
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

    const maxOrderRecord = await RecordModel.findOne({ collectionId: data.collectionId })
      .sort({ order: -1 })
      .select('order')
      .lean();
    let currentOrder = (maxOrderRecord?.order ?? -1) + 1;

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
          rowValues[header] = evaluateCell(sheet, cell, workbook);
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

          // Parse water rate from water bill formula (e.g. =F3*150 or shared formula) or values
          const waterBillFieldKey = Object.keys(data.mappings).find(
            (name) => ['WATER BILL', 'WATER', 'TOTAL BILL'].includes(name.toUpperCase())
          );
          if (waterBillFieldKey) {
            const billExcelHeader = data.mappings[waterBillFieldKey];
            if (billExcelHeader) {
              const billColIndex = headers.indexOf(billExcelHeader);
              const billCell = billColIndex !== -1 ? row.getCell(billColIndex + 1) : null;
              if (billCell && billCell.value && typeof billCell.value === 'object') {
                const cellVal = billCell.value as any;
                let formulaStr = String(cellVal.formula || '').toUpperCase();
                if (!formulaStr && cellVal.sharedFormula) {
                  const masterCell = sheet.getCell(String(cellVal.sharedFormula));
                  const masterVal = masterCell?.value as any;
                  if (masterVal && typeof masterVal === 'object' && masterVal.formula) {
                    formulaStr = String(masterVal.formula).toUpperCase();
                  }
                }
                const rateMatch = formulaStr.match(/\*\s*(\d+(?:\.\d+)?)/);
                if (rateMatch) {
                  const detectedRate = parseFloat(rateMatch[1]);
                  if (detectedRate > 0) {
                    recordData['_unitRate'] = detectedRate;
                  }
                }
              }
            }
          }

          if (!recordData['_unitRate']) {
            const consKey = Object.keys(data.mappings).find(n => ['CONSUMPTION', 'UNITS', 'UNITS USED'].includes(n.toUpperCase()));
            const billKey = Object.keys(data.mappings).find(n => ['WATER BILL', 'WATER'].includes(n.toUpperCase()));
            if (consKey && billKey) {
              const cons = Number(recordData[consKey]);
              const bill = Number(recordData[billKey]);
              if (cons > 0 && bill > 0) {
                const calcRate = Math.round(bill / cons);
                if (calcRate > 0) {
                  recordData['_unitRate'] = calcRate;
                }
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
            order: currentOrder++,
            createdBy: session.userId,
          });
        }

        currentIdx++;
      }
    }

    if (recordsToInsert.length > 0) {
      // Auto-lookup missing phone numbers from Customers and other Collections
      const phoneMap = await bulkLookupTenantPhones();
      const nameFieldNames = ['NAME', 'CUSTOMER NAME', 'CUSTOMER', 'TENANT', 'CLIENT NAME'];

      for (const rec of recordsToInsert) {
        if (!rec.data[phoneFieldName]) {
          let tenantName = '';
          for (const nKey of nameFieldNames) {
            const v = String(rec.data[nKey] || '').trim();
            if (v) {
              tenantName = v;
              break;
            }
          }

          if (tenantName) {
            const upperName = tenantName.toUpperCase();
            if (phoneMap.has(upperName)) {
              rec.data[phoneFieldName] = phoneMap.get(upperName);
            } else {
              // Partial search
              for (const [k, v] of phoneMap.entries()) {
                if (k.includes(upperName) || upperName.includes(k)) {
                  rec.data[phoneFieldName] = v;
                  break;
                }
              }
              if (!rec.data[phoneFieldName]) {
                const parts = upperName.split(/\s+/).filter((p: string) => p.length >= 3);
                for (const part of parts) {
                  for (const [k, v] of phoneMap.entries()) {
                    if (k.includes(part)) {
                      rec.data[phoneFieldName] = v;
                      break;
                    }
                  }
                  if (rec.data[phoneFieldName]) break;
                }
              }
            }
          }
        }
      }

      await RecordModel.insertMany(recordsToInsert);
      importCount = recordsToInsert.length;
    }

    revalidatePath(`/collections/${data.collectionId}`);
    revalidatePath('/');
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

      // 2. Create the Fields (Ensuring PHONE NO field is always present for SMS sending)
      const hasPhoneField = data.fields.some(f => ['PHONE NO', 'PHONE', 'PHONE NUMBER', 'MOBILE'].includes(f.name.toUpperCase()));
      const allFields = [...data.fields];
      if (!hasPhoneField) {
        allFields.push({ name: 'PHONE NO', type: 'phone' });
      }

      const fieldsToCreate = allFields.map((f, idx) => ({
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
    revalidatePath('/');
    return { success: true, collectionId: lastCollectionId, count: totalImported };
  } catch (error: any) {
    return { error: error.message || 'Failed to create and import collection' };
  }
}
