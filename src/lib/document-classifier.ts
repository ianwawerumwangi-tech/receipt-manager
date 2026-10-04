export type DocumentType = 'rent_receipt' | 'water_bill' | 'invoice' | 'general';

export interface DocumentClassificationResult {
  type: DocumentType;
  confidence: number;
  reason: string;
  matchedIndicators: string[];
}

export const RENT_RECEIPT_INDICATORS = [
  'RENT PAID',
  'AMOUNT PAID',
  'MONTHLY RENT',
  'RENT DUE',
  'RCT NO',
  'RECEIPT NUMBER',
  'RECEIPT NO',
  'RECEIPT',
  'DEPOSIT PAID',
  'RENT ARREARS',
  'RENT ARREAS',
  'RENT BAL',
  'RENT BALANCE',
  'TOTAL PAID',
];

export const WATER_BILL_METER_INDICATORS = [
  'CURRENT',
  'CURR',
  'PREVIOUS',
  'PREV',
  'CONSUMPTION',
  'UNITS',
  'UNITS USED',
  'CURRENT READING',
  'PREVIOUS READING',
  'CURR READING',
  'PREV READING',
  'METER READING',
  'METER NO',
  'METER',
];

export const WATER_BILL_CHARGE_INDICATORS = [
  'WATER BILL',
  'WATER',
  'WATER CHARGE',
  'TOTAL BILL',
  'AMOUNT DUE',
];

export const INVOICE_INDICATORS = [
  'INVOICE NO',
  'INVOICE NUMBER',
  'INVOICE DATE',
  'INVOICE AMOUNT',
  'PAYMENT NOTICE',
  'RENT INVOICE',
];

/**
 * Robustly detects whether a spreadsheet / collection corresponds to:
 * - 'rent_receipt': Tenant rent payments, receipts, amounts paid, receipt numbers.
 * - 'water_bill': Meter readings (prev, curr, consumption) and water billing.
 * - 'invoice': Rent due reminders / billing notices.
 * - 'general': Generic collection.
 * 
 * Crucially: Rent receipt spreadsheets (e.g. Rivunia) often include a 'WATER BILL' or
 * 'GARBAGE' utility breakdown column alongside 'RENT PAID', 'MONTHLY RENT', and 'RCT NO'.
 * Having a 'WATER BILL' column DOES NOT make it a water bill document if rent columns are present!
 */
export function detectDocumentType({
  headers = [],
  collectionName = '',
}: {
  headers?: string[];
  collectionName?: string;
}): DocumentClassificationResult {
  const normHeaders = headers.map((h) => String(h || '').trim().toUpperCase());
  const upperName = (collectionName || '').trim().toUpperCase();

  // Find matches
  const matchedRent = normHeaders.filter((h) => RENT_RECEIPT_INDICATORS.includes(h));
  const matchedWaterMeter = normHeaders.filter((h) => WATER_BILL_METER_INDICATORS.includes(h));
  const matchedWaterCharge = normHeaders.filter((h) => WATER_BILL_CHARGE_INDICATORS.includes(h));
  const matchedInvoice = normHeaders.filter((h) => INVOICE_INDICATORS.includes(h));

  const nameHasWater = upperName.includes('WATER');
  const nameHasInvoice = upperName.includes('INVOICE') || upperName.includes('REMINDER');
  const nameHasRent = upperName.includes('RENT') || upperName.includes('RECEIPT');

  // RULE 1: If the document contains rent receipt indicators (RENT PAID, MONTHLY RENT, RCT NO, RENT DUE, etc.),
  // it is unequivocally a Rent Receipt document, even if it has a 'WATER BILL' or 'GARBAGE' charge column!
  if (matchedRent.length > 0) {
    return {
      type: 'rent_receipt',
      confidence: 1.0,
      reason: `Document contains rent payment & receipt indicators: ${matchedRent.slice(0, 5).join(', ')}`,
      matchedIndicators: matchedRent,
    };
  }

  // RULE 2: If the document contains water meter reading indicators (CURRENT, PREVIOUS, CONSUMPTION, UNITS)
  // and has NO rent payment indicators, it is a Water Bill document!
  if (matchedWaterMeter.length > 0) {
    const indicators = [...matchedWaterMeter, ...matchedWaterCharge];
    return {
      type: 'water_bill',
      confidence: 0.95,
      reason: `Document contains water meter reading indicators: ${indicators.join(', ')}`,
      matchedIndicators: indicators,
    };
  }

  // RULE 3: If collection name explicitly contains 'WATER' and has water charge indicators without rent indicators:
  if (nameHasWater && (matchedWaterCharge.length > 0 || !nameHasRent)) {
    return {
      type: 'water_bill',
      confidence: 0.9,
      reason: `Collection name indicates water bill: "${collectionName}"`,
      matchedIndicators: ['NAME_WATER', ...matchedWaterCharge],
    };
  }

  // RULE 4: Invoice indicators
  if (matchedInvoice.length > 0 || nameHasInvoice) {
    return {
      type: 'invoice',
      confidence: 0.9,
      reason: `Collection indicates invoice/reminder: "${collectionName}"`,
      matchedIndicators: matchedInvoice.length > 0 ? matchedInvoice : ['NAME_INVOICE'],
    };
  }

  // RULE 5: Name indicates rent
  if (nameHasRent) {
    return {
      type: 'rent_receipt',
      confidence: 0.85,
      reason: `Collection name indicates rent receipt: "${collectionName}"`,
      matchedIndicators: ['NAME_RENT'],
    };
  }

  // Default fallback is rent_receipt
  return {
    type: 'rent_receipt',
    confidence: 0.5,
    reason: 'Defaulted to rent receipt',
    matchedIndicators: [],
  };
}

/**
 * Resolves the collection type for a collection document, taking into account:
 * 1. The explicit `collection.type` property if set in database.
 * 2. Automatic field and name analysis as fallback.
 */
export function resolveCollectionType(
  collection?: { name?: string; type?: string } | null,
  fields: { name: string }[] = []
): DocumentType {
  if (collection?.type && ['rent_receipt', 'water_bill', 'invoice', 'general'].includes(collection.type)) {
    return collection.type as DocumentType;
  }

  const headers = fields.map((f) => f.name);
  const detected = detectDocumentType({ headers, collectionName: collection?.name });
  return detected.type;
}

export function getDocumentTypeLabel(type?: string): string {
  switch (type) {
    case 'water_bill':
      return 'Water Bill';
    case 'invoice':
      return 'Invoices';
    case 'general':
      return 'General';
    case 'rent_receipt':
    default:
      return 'Rent Receipts';
  }
}
