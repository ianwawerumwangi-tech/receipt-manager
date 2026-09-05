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

  const amountField = fields.find((f) =>
    ['RENT PAID', 'AMOUNT PAID', 'AMOUNT', 'DEPOSIT PAID'].includes(f.name.toUpperCase())
  );
  const rctField = fields.find((f) =>
    ['RCT NO', 'RECEIPT NUMBER', 'RECEIPT NO', 'RECEIPT'].includes(f.name.toUpperCase())
  );

  const rctVal = String(rctField ? recordData[rctField.name] || '' : '').trim();
  const amountVal = amountField ? recordData[amountField.name] : undefined;

  const insts = recordData._installments;
  if (Array.isArray(insts) && insts.length > 0) {
    const currentAmount = parseMathExpression(amountVal);
    const instsTotal = insts.reduce((sum: number, i: any) => sum + (Number(i.amount) || 0), 0);
    const currentRct = rctVal.toUpperCase();
    const instsRcts = insts.map((i: any) => String(i.rct || '').trim().toUpperCase()).filter(Boolean);

    const amountMatches = !amountField || currentAmount === 0 || Math.abs(currentAmount - instsTotal) < 0.01;
    const rctMatches = !rctField || !currentRct || instsRcts.some((r) => currentRct.includes(r));

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
        .map((p) => Number(p.trim()))
        .filter((p) => !isNaN(p));
    } else {
      const parsed = Number(amountVal.trim());
      if (!isNaN(parsed)) {
        amounts = [parsed];
      }
    }
  }

  const count = Math.max(amounts.length, rcts.length);
  if (count === 0) {
    return [];
  }

  const installments: { amount: number; rct: string }[] = [];
  for (let i = 0; i < count; i++) {
    const instAmount = amounts[i] ?? (amounts.length === 1 ? amounts[0] : 0);
    const instRct = rcts[i] ?? (rcts.length === 1 ? rcts[0] : (rcts[0] || ''));
    installments.push({
      amount: instAmount,
      rct: instRct,
    });
  }

  return installments;
}

