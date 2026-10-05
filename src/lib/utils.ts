import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function serialize<T>(data: T): T {
  return JSON.parse(JSON.stringify(data))
}

export function findLatestMonthSheet(sheets: string[]): string {
  if (!sheets || sheets.length === 0) return '';

  const MONTH_MAP: Record<string, number> = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
  };

  const validSheets = sheets.filter(
    (name) => !name.toLowerCase().includes('summary') && !name.toLowerCase().includes('total')
  );

  if (validSheets.length === 0) return sheets[0];

  let bestSheet = validSheets[validSheets.length - 1];
  let maxScore = -1;

  for (const sheet of validSheets) {
    const cleanName = sheet.toLowerCase().trim();
    let foundMonth = -1;
    let foundYear = 0;

    const yearMatch = cleanName.match(/\b(20\d\d)\b/);
    if (yearMatch) {
      foundYear = parseInt(yearMatch[1], 10);
    }

    for (const [mName, mNum] of Object.entries(MONTH_MAP)) {
      const regex = new RegExp(`\\b${mName}\\b`, 'i');
      if (regex.test(cleanName)) {
        foundMonth = mNum;
        break;
      }
    }

    if (foundMonth !== -1) {
      const score = foundYear * 100 + foundMonth;
      if (score > maxScore) {
        maxScore = score;
        bestSheet = sheet;
      }
    }
  }

  return bestSheet;
}

export function parseMathExpression(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'object') {
    if ('result' in val && typeof val.result === 'number') return val.result;
    if ('result' in val && typeof val.result === 'string') return parseMathExpression(val.result);
  }
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

export function extractRecordInstallments(
  recordData: Record<string, any>,
  fields: { name: string; type?: string }[]
): { amount: number; rct: string }[] {
  if (!recordData) return [];

  // 1. Primary payment columns (strictly prioritized over deposit)
  const primaryAmountCandidates = [
    'RENT PAID',
    'AMOUNT PAID',
    'TOTAL PAID',
    'PAID',
    'AMOUNT',
    'TOTAL AMOUNT',
    'MONTHLY RENT',
  ];
  let amountField: { name: string; type?: string } | undefined;
  for (const candidate of primaryAmountCandidates) {
    const found = fields.find((f) => f.name.trim().toUpperCase() === candidate);
    if (found) {
      amountField = found;
      break;
    }
  }

  // Only fall back to deposit columns if NO rent or payment columns exist in schema
  if (!amountField) {
    const depositCandidates = ['DEPOSIT PAID', 'DEPOSIT'];
    for (const candidate of depositCandidates) {
      const found = fields.find((f) => f.name.trim().toUpperCase() === candidate);
      if (found) {
        amountField = found;
        break;
      }
    }
  }

  const rctCandidates = ['RCT NO', 'RECEIPT NUMBER', 'RECEIPT NO', 'RECEIPT'];
  let rctField: { name: string; type?: string } | undefined;
  for (const candidate of rctCandidates) {
    const found = fields.find((f) => f.name.trim().toUpperCase() === candidate);
    if (found) {
      rctField = found;
      break;
    }
  }

  const rctVal = String(rctField ? recordData[rctField.name] || '' : '').trim();
  const amountVal = amountField ? recordData[amountField.name] : undefined;

  // Check stored _installments: only trust them if they strictly match the authoritative amount
  const insts = recordData._installments;
  if (Array.isArray(insts) && insts.length > 0) {
    const currentAmount = parseMathExpression(amountVal);
    const instsTotal = insts.reduce((sum: number, i: any) => sum + (Number(i.amount) || 0), 0);
    const currentRct = rctVal.toUpperCase();
    const instsRcts = insts.map((i: any) => String(i.rct || '').trim().toUpperCase()).filter(Boolean);

    // Sum of installments must strictly match currentAmount (within 0.01 tolerance)
    const amountMatches = !amountField || Math.abs(currentAmount - instsTotal) < 0.01;
    const rctMatches =
      !rctField ||
      !currentRct ||
      instsRcts.some((r) => currentRct.includes(r)) ||
      currentRct.includes(instsRcts.join('/'));

    if (amountMatches && rctMatches) {
      return insts.map((i: any) => ({
        amount: typeof i.amount === 'number' ? i.amount : Number(i.amount) || 0,
        rct: String(i.rct || '').trim(),
      }));
    }
  }

  const rcts = rctVal ? rctVal.split('/').map((r) => r.trim()).filter(Boolean) : [];

  let amounts: number[] = [];
  if (typeof amountVal === 'number') {
    amounts = [amountVal];
  } else if (typeof amountVal === 'string' && amountVal.trim()) {
    if (amountVal.includes('+')) {
      amounts = amountVal
        .split('+')
        .map((p) => Number(p.replace(/,/g, '').trim()))
        .filter((p) => !isNaN(p));
    } else {
      const parsed = Number(amountVal.replace(/,/g, '').trim());
      if (!isNaN(parsed)) {
        amounts = [parsed];
      }
    }
  }

  if (amounts.length === 0 && rcts.length === 0) {
    return [];
  }

  // Case A: Multiple broken-down amounts provided (e.g. from formula 2000+65000)
  if (amounts.length > 1) {
    const installments: { amount: number; rct: string }[] = [];
    const count = Math.max(amounts.length, rcts.length);
    for (let i = 0; i < count; i++) {
      installments.push({
        amount: amounts[i] ?? 0,
        rct: rcts[i] ?? (rcts.length === 1 ? rcts[0] : (rcts[0] || '')),
      });
    }
    return installments;
  }

  // Case B: Single total amount with multiple receipt numbers (e.g. 67,000 across UI3CU4MCDDI / UI3CU4MEVB)
  // CRITICAL: NEVER duplicate amounts[0] across all receipts! Doing so would double/triple the customer's payment!
  if (amounts.length === 1 && rcts.length > 1) {
    return [
      {
        amount: amounts[0],
        rct: rcts.join(' / '),
      },
    ];
  }

  // Case C: Single amount and single (or no) receipt
  return [
    {
      amount: amounts[0] ?? 0,
      rct: rcts[0] ?? '',
    },
  ];
}

