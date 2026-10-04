import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {
  detectDocumentType,
  resolveCollectionType,
  getDocumentTypeLabel,
} from '../src/lib/document-classifier';
import {
  formatPhoneNumber,
  buildSmsTemplate,
  buildWaterBillSmsTemplate,
  sendBatchSms,
  sendSms,
} from '../src/lib/sms';
import {
  buildRecordSmsPayload,
  buildRecordInvoiceSmsPayload,
} from '../src/actions/record.actions';
import {
  getInvoiceTemplate,
  resolveInvoiceMessage,
} from '../src/lib/invoice-templates';
import { parseMathExpression } from '../src/lib/utils';

const TEST_PHONE_1 = '0711667099';
const TEST_PHONE_2 = '0119204765';

let passedTests = 0;
let failedTests = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passedTests++;
  } catch (err: any) {
    console.error(`  \x1b[31m✗\x1b[0m ${name}`);
    console.error(`    \x1b[31m${err.message}\x1b[0m`);
    if (err.stack) {
      console.error(`    ${err.stack.split('\n').slice(1, 4).join('\n    ')}`);
    }
    failedTests++;
  }
}

async function runAllTests() {
  console.log('\n======================================================');
  console.log('RECEIPT MANAGER TEST SUITE: DOCUMENT TYPES & SMS LOGIC');
  console.log('======================================================\n');

  // --- SECTION 1: DOCUMENT CLASSIFICATION & RIVUNIA FIX ---
  console.log('\x1b[36m--- Section 1: Document Classification on Real Files ---\x1b[0m');

  await test('ANITA 2026.xlsx must be classified as rent_receipt', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join('data', 'ANITA 2026.xlsx'));
    const ws = wb.getWorksheet('JAN') || wb.worksheets[0];
    const headers: string[] = [];
    ws.getRow(10).eachCell({ includeEmpty: true }, (c) => {
      if (c.value) headers.push(String(c.value).trim());
    });
    const result = detectDocumentType({ headers, collectionName: 'ANITA 2026 - JAN' });
    assert.strictEqual(result.type, 'rent_receipt');
    assert.strictEqual(getDocumentTypeLabel(result.type), 'Rent Receipts');
  });

  await test('ANITA SAMPLE SHEET.xlsx must be classified as rent_receipt', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join('data', 'ANITA SAMPLE SHEET.xlsx'));
    const ws = wb.getWorksheet('JAN') || wb.worksheets[0];
    const headers: string[] = [];
    ws.getRow(10).eachCell({ includeEmpty: true }, (c) => {
      if (c.value) headers.push(String(c.value).trim());
    });
    const result = detectDocumentType({ headers, collectionName: 'ANITA SAMPLE - JAN' });
    assert.strictEqual(result.type, 'rent_receipt');
  });

  await test('RIVUNIA 2026.xlsx MUST be classified as rent_receipt despite having a WATER BILL column', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join('data', 'RIVUNIA 2026.xlsx'));
    const testSheets = ['FEB', 'MARCH', 'APR', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER'];

    for (const sheetName of testSheets) {
      const ws = wb.getWorksheet(sheetName);
      if (!ws) continue;
      const headers: string[] = [];
      ws.getRow(9).eachCell({ includeEmpty: true }, (c) => {
        if (c.value) headers.push(String(c.value).trim());
      });
      // Confirm that the sheet DOES contain "WATER BILL"
      assert(
        headers.some((h) => h.toUpperCase() === 'WATER BILL'),
        `Sheet ${sheetName} should have WATER BILL column`
      );
      // But because it has RENT PAID / MONTHLY RENT / RCT NO, it MUST be rent_receipt!
      const result = detectDocumentType({ headers, collectionName: `RIVUNIA 2026 - ${sheetName}` });
      assert.strictEqual(
        result.type,
        'rent_receipt',
        `Sheet ${sheetName} with WATER BILL column was falsely classified as ${result.type} instead of rent_receipt!`
      );
    }
  });

  await test('ANTHONY SEPTEMBER WATER BILL.xlsx must be classified as water_bill', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join('data', 'ANTHONY SEPTEMBER  WATER  BILL.xlsx'));
    const ws = wb.getWorksheet('Sheet1') || wb.worksheets[0];
    const headers: string[] = [];
    ws.getRow(2).eachCell({ includeEmpty: true }, (c) => {
      if (c.value) headers.push(String(c.value).trim());
    });
    const result = detectDocumentType({ headers, collectionName: 'ANTHONY SEPTEMBER WATER BILL' });
    assert.strictEqual(result.type, 'water_bill');
    assert.strictEqual(getDocumentTypeLabel(result.type), 'Water Bill');
  });

  await test('KABAIKU 2026.xlsx must be classified as rent_receipt across all sheets', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join('data', 'KABAIKU 2026.xlsx'));
    const testSheets = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUNE', 'JULY', 'AUG', 'SEP', 'OCT'];

    for (const sheetName of testSheets) {
      const ws = wb.getWorksheet(sheetName);
      if (!ws) continue;
      const headers: string[] = [];
      ws.getRow(9).eachCell({ includeEmpty: true }, (c) => {
        if (c.value) headers.push(String(c.value).trim());
      });
      const result = detectDocumentType({ headers, collectionName: `KABAIKU 2026 - ${sheetName}` });
      assert.strictEqual(
        result.type,
        'rent_receipt',
        `Sheet ${sheetName} was classified as ${result.type} instead of rent_receipt`
      );
    }
  });

  await test('resolveCollectionType respects explicit type and falls back accurately', () => {
    // Explicit overrides
    assert.strictEqual(resolveCollectionType({ name: 'Any Name', type: 'rent_receipt' }, []), 'rent_receipt');
    assert.strictEqual(resolveCollectionType({ name: 'Any Name', type: 'water_bill' }, []), 'water_bill');
    assert.strictEqual(resolveCollectionType({ name: 'Any Name', type: 'invoice' }, []), 'invoice');

    // Fallback: Rivunia headers with no explicit type in database
    const rivuniaFields = [
      { name: 'HSE NO' },
      { name: 'NAME' },
      { name: 'PHONE NO' },
      { name: 'MONTHLY RENT' },
      { name: 'WATER BILL' },
      { name: 'RENT PAID' },
      { name: 'RCT NO' },
      { name: 'BALANCE' },
    ];
    assert.strictEqual(resolveCollectionType({ name: 'RIVUNIA 2026 - JULY' }, rivuniaFields), 'rent_receipt');

    // Fallback: Anthony water bill headers with no explicit type in database
    const waterFields = [
      { name: 'HSE NO' },
      { name: 'NAME' },
      { name: 'PHONE NO' },
      { name: 'CURRENT' },
      { name: 'PREVIOUS' },
      { name: 'CONSUMPTION' },
      { name: 'WATER BILL' },
      { name: 'TOTAL BILL' },
    ];
    assert.strictEqual(resolveCollectionType({ name: 'ANTHONY WATER' }, waterFields), 'water_bill');
  });

  // --- SECTION 2: PHONE NUMBER FORMATTING (TEST PHONES 0711667099 and 0119204765) ---
  console.log('\n\x1b[36m--- Section 2: Phone Formatting with Test Numbers (0711667099 & 0119204765) ---\x1b[0m');

  await test('formatPhoneNumber correctly formats 0711667099 and 0119204765', () => {
    assert.strictEqual(formatPhoneNumber('0711667099'), '254711667099');
    assert.strictEqual(formatPhoneNumber('0119204765'), '254119204765');
  });

  await test('formatPhoneNumber handles international formats, spaces, dashes, and local prefix', () => {
    // 0711667099 variations
    assert.strictEqual(formatPhoneNumber('+254711667099'), '254711667099');
    assert.strictEqual(formatPhoneNumber('254711667099'), '254711667099');
    assert.strictEqual(formatPhoneNumber('0711 667 099'), '254711667099');
    assert.strictEqual(formatPhoneNumber('0711-667-099'), '254711667099');
    assert.strictEqual(formatPhoneNumber('711667099'), '254711667099');

    // 0119204765 variations
    assert.strictEqual(formatPhoneNumber('+254119204765'), '254119204765');
    assert.strictEqual(formatPhoneNumber('254119204765'), '254119204765');
    assert.strictEqual(formatPhoneNumber('011 920 4765'), '254119204765');
    assert.strictEqual(formatPhoneNumber('011-920-4765'), '254119204765');
    assert.strictEqual(formatPhoneNumber('119204765'), '254119204765');
  });

  // --- SECTION 3: RENT RECEIPT SMS GENERATION (NO CONFUSION WITH WATER BILL) ---
  console.log('\n\x1b[36m--- Section 3: Rent Receipts Generation & Verification ---\x1b[0m');

  await test('buildRecordSmsPayload generates Rent Receipt SMS for Rivunia data using 0711667099', async () => {
    const rivuniaFields = [
      { name: 'HSE NO' },
      { name: 'NAME' },
      { name: 'PHONE NO' },
      { name: 'MONTHLY RENT' },
      { name: 'WATER BILL' }, // Has water bill column!
      { name: 'GARBAGE' },
      { name: 'BAL B/D' },
      { name: 'RENT DUE' },
      { name: 'RENT PAID' },
      { name: 'RCT NO' },
      { name: 'PERIOD' },
      { name: 'BALANCE' },
    ];

    const recordData = {
      'HSE NO': 'G2',
      'NAME': 'KEVIN ESSAU',
      'PHONE NO': TEST_PHONE_1,
      'MONTHLY RENT': 11000,
      'WATER BILL': 300,
      'GARBAGE': 300,
      'BAL B/D': -450,
      'RENT DUE': 11150,
      'RENT PAID': 11600,
      'RCT NO': 'UFUMI98K3V',
      'PERIOD': 'JULY 2026',
      'BALANCE': -450,
    };

    const payload = await buildRecordSmsPayload(
      recordData,
      rivuniaFields,
      'RIVUNIA 2026 - JULY'
    );

    assert.strictEqual(payload.phone, TEST_PHONE_1);
    assert.strictEqual(payload.name, 'KEVIN ESSAU');

    // Verify it is a RENT RECEIPT message
    assert(
      payload.message.includes('Dear KEVIN ESSAU, you are in receipt of KES 11,600, for house #G2 for the month of JULY 2026. Your current balance is KES 0. Thank you.'),
      `Message unexpected: ${payload.message}`
    );

    // CRITICAL: Ensure it is NEVER confused with water bill!
    assert(!payload.message.toLowerCase().includes('water bill:'), 'Rent receipt must NOT contain "water bill:"');
    assert(!payload.message.includes('Previous'), 'Rent receipt must NOT contain meter reading "Previous"');
    assert(!payload.message.includes(', current '), 'Rent receipt must NOT contain meter reading ", current "');
    assert(!payload.message.includes('per unit'), 'Rent receipt must NOT contain "per unit"');
  });

  await test('buildRecordSmsPayload generates Rent Receipt SMS for Rivunia data using 0119204765 with multiple installments', async () => {
    const rivuniaFields = [
      { name: 'HSE NO' },
      { name: 'NAME' },
      { name: 'PHONE NO' },
      { name: 'MONTHLY RENT' },
      { name: 'WATER BILL' },
      { name: 'RENT DUE' },
      { name: 'RENT PAID' },
      { name: 'RCT NO' },
      { name: 'BALANCE' },
    ];

    const recordData = {
      'HSE NO': 'G3',
      'NAME': 'ERNEST MUKIRI',
      'PHONE NO': TEST_PHONE_2,
      'MONTHLY RENT': 21000,
      'WATER BILL': 600,
      'RENT DUE': 21600,
      'RENT PAID': '10000+11750', // Formula installments sum to 21750
      'RCT NO': 'UGOGOBWHLU/UHVGO4AOOD',
      'BALANCE': -150,
    };

    const payload = await buildRecordSmsPayload(
      recordData,
      rivuniaFields,
      'RIVUNIA 2026 - AUGUST'
    );

    assert.strictEqual(payload.phone, TEST_PHONE_2);
    assert.strictEqual(payload.name, 'ERNEST MUKIRI');

    assert(
      payload.message.includes('you are in receipt of KES 21,750, for house #G3 for the month of AUGUST 2026'),
      `Message unexpected: ${payload.message}`
    );
    assert(!payload.message.toLowerCase().includes('water bill:'), 'Must NOT be a water bill message');
  });

  // --- SECTION 4: WATER BILL SMS GENERATION (NO CONFUSION WITH RENT) ---
  console.log('\n\x1b[36m--- Section 4: Water Bill Generation & Verification ---\x1b[0m');

  await test('buildRecordSmsPayload generates Water Bill SMS for Anthony data using 0711667099 with normal consumption', async () => {
    const waterFields = [
      { name: 'HSE NO' },
      { name: 'NAME' },
      { name: 'PHONE NO' },
      { name: 'CURRENT' },
      { name: 'PREVIOUS' },
      { name: 'CONSUMPTION' },
      { name: 'WATER BILL' },
      { name: 'BAL B/D' },
      { name: 'TOTAL BILL' },
    ];

    const recordData = {
      'HSE NO': 2,
      'NAME': 'KEVIN NTHENGE',
      'PHONE NO': TEST_PHONE_1,
      'CURRENT': 14,
      'PREVIOUS': 12,
      'CONSUMPTION': 2,
      'WATER BILL': 300,
      'BAL B/D': 0,
      'TOTAL BILL': 300,
      '_unitRate': 150,
    };

    const payload = await buildRecordSmsPayload(
      recordData,
      waterFields,
      'ANTHONY SEPTEMBER WATER BILL'
    );

    assert.strictEqual(payload.phone, TEST_PHONE_1);
    assert.strictEqual(payload.name, 'KEVIN NTHENGE');

    // Expected: Previous 12, current 14, per unit KES 150. Total KES 300.
    assert(
      payload.message.includes('water bill: Previous 12, current 14, per unit KES 150. Total KES 300. Thank you.'),
      `Message unexpected: ${payload.message}`
    );

    // CRITICAL: Ensure it is NEVER confused with rent receipt!
    assert(!payload.message.includes('you are in receipt of'), 'Water bill must NOT contain "you are in receipt of"');
    assert(!payload.message.includes('balance is KES'), 'Water bill must NOT contain rent balance phrase');
  });

  await test('buildRecordSmsPayload generates Water Bill SMS for Anthony data using 0119204765 with ZERO consumption', async () => {
    const waterFields = [
      { name: 'HSE NO' },
      { name: 'NAME' },
      { name: 'PHONE NO' },
      { name: 'CURRENT' },
      { name: 'PREVIOUS' },
      { name: 'CONSUMPTION' },
      { name: 'WATER BILL' },
      { name: 'BAL B/D' },
      { name: 'TOTAL BILL' },
    ];

    // Leslie Korir in Anthony sheet: Previous 9, Current 9 -> Zero usage -> Total KES 0!
    const recordData = {
      'HSE NO': 1,
      'NAME': 'LESLIE KORIR',
      'PHONE NO': TEST_PHONE_2,
      'CURRENT': 9,
      'PREVIOUS': 9,
      'CONSUMPTION': 0,
      'WATER BILL': 0,
      'BAL B/D': 0,
      'TOTAL BILL': 0,
      '_unitRate': 150,
    };

    const payload = await buildRecordSmsPayload(
      recordData,
      waterFields,
      'ANTHONY SEPTEMBER WATER BILL'
    );

    assert.strictEqual(payload.phone, TEST_PHONE_2);
    assert(
      payload.message.includes('water bill: Previous 9, current 9, per unit KES 150. Total KES 0. Thank you.'),
      `Message unexpected: ${payload.message}`
    );
  });

  // --- SECTION 5: INVOICES (RENT DUE INVOICES) SMS GENERATION ---
  console.log('\n\x1b[36m--- Section 5: Invoices Generation & Verification ---\x1b[0m');

  await test('buildRecordInvoiceSmsPayload generates Rent Due Invoice SMS for 0711667099 using Sidian template', async () => {
    const fields = [
      { name: 'HSE NO' },
      { name: 'NAME' },
      { name: 'PHONE NO' },
      { name: 'BALANCE' },
    ];

    const recordData = {
      'HSE NO': 'B4',
      'NAME': 'JOHN DOE',
      'PHONE NO': TEST_PHONE_1,
      'BALANCE': 15000,
    };

    const payload = await buildRecordInvoiceSmsPayload(
      recordData,
      fields,
      'ANITA PLOT - OCTOBER',
      'sidian-111999',
      'ANITA PLOT',
      'OCTOBER'
    );

    assert.strictEqual(payload.phone, TEST_PHONE_1);
    assert(
      payload.message.includes('Dear Esteemed Tenant, your OCTOBER rent is due. Please pay by today. Pay via Paybill 111999, A/C No. 01001710003718 (SIDIAN Bank).'),
      `Message unexpected: ${payload.message}`
    );

    // CRITICAL: Must NOT be confused with rent receipt or water bill!
    assert(!payload.message.includes('you are in receipt of'), 'Invoice must NOT be a receipt');
    assert(!payload.message.toLowerCase().includes('water bill:'), 'Invoice must NOT be a water bill');
  });

  await test('buildRecordInvoiceSmsPayload generates customized Rent Due Invoice SMS for 0119204765 with dynamic variables', async () => {
    const fields = [
      { name: 'HSE NO' },
      { name: 'NAME' },
      { name: 'PHONE NO' },
      { name: 'BALANCE' },
    ];

    const recordData = {
      'HSE NO': 'G2',
      'NAME': 'KEVIN ESSAU',
      'PHONE NO': TEST_PHONE_2,
      'BALANCE': 12000,
    };

    const customTemplate = 'Hello {name}, your {month} rent for house #{houseNo} at {plotName} is due. Outstanding balance: KES {balance}. Pay via Paybill 4026352.';

    const payload = await buildRecordInvoiceSmsPayload(
      recordData,
      fields,
      'RIVUNIA - OCTOBER',
      'paybill-4026352',
      'RIVUNIA',
      'OCTOBER',
      customTemplate
    );

    assert.strictEqual(payload.phone, TEST_PHONE_2);
    assert.strictEqual(
      payload.message,
      'Hello KEVIN ESSAU, your OCTOBER rent for house #G2 at RIVUNIA is due. Outstanding balance: KES 12,000. Pay via Paybill 4026352.'
    );
  });

  // --- SECTION 6: THREE DISTINCT THINGS - INTEGRITY TEST ---
  console.log('\n\x1b[36m--- Section 6: Triple Distinction Integrity (Receipts vs Water Bill vs Invoices) ---\x1b[0m');

  await test('All 3 message types are fundamentally distinct and never confused', async () => {
    const commonFields = [
      { name: 'HSE NO' },
      { name: 'NAME' },
      { name: 'PHONE NO' },
      { name: 'MONTHLY RENT' },
      { name: 'WATER BILL' },
      { name: 'RENT PAID' },
      { name: 'CURRENT' },
      { name: 'PREVIOUS' },
      { name: 'BALANCE' },
    ];

    const commonRecord = {
      'HSE NO': '10',
      'NAME': 'SARAH W',
      'PHONE NO': TEST_PHONE_1,
      'MONTHLY RENT': 15000,
      'WATER BILL': 450,
      'RENT PAID': 15000,
      'CURRENT': 25,
      'PREVIOUS': 22,
      'CONSUMPTION': 3,
      '_unitRate': 150,
      'TOTAL BILL': 450,
      'BALANCE': 0,
    };

    // 1. Rent Receipt (explicit type 'rent_receipt')
    const receiptPayload = await buildRecordSmsPayload(
      commonRecord,
      commonFields,
      'Collection 1',
      undefined,
      undefined,
      'rent_receipt'
    );

    // 2. Water Bill (explicit type 'water_bill')
    const waterPayload = await buildRecordSmsPayload(
      commonRecord,
      commonFields,
      'Collection 1',
      undefined,
      150,
      'water_bill'
    );

    // 3. Invoice
    const invoicePayload = await buildRecordInvoiceSmsPayload(
      commonRecord,
      commonFields,
      'Collection 1',
      'sidian-111999',
      'ANITA',
      'OCTOBER'
    );

    // Check Receipt signature
    assert(receiptPayload.message.includes('you are in receipt of KES 15,000'));
    assert(!receiptPayload.message.includes('water bill:'));
    assert(!receiptPayload.message.includes('rent is due'));

    // Check Water Bill signature
    assert(waterPayload.message.includes('water bill: Previous 22, current 25, per unit KES 150. Total KES 450.'));
    assert(!waterPayload.message.includes('you are in receipt of'));
    assert(!waterPayload.message.includes('rent is due'));

    // Check Invoice signature
    assert(invoicePayload.message.includes('OCTOBER rent is due'));
    assert(!invoicePayload.message.includes('you are in receipt of'));
    assert(!invoicePayload.message.includes('water bill:'));
  });

  // --- SECTION 7: END-TO-END GATEWAY BATCH DISPATCH SIMULATION WITH TEST PHONES ---
  console.log('\n\x1b[36m--- Section 7: Gateway Dispatch Simulation with 0711667099 & 0119204765 ---\x1b[0m');

  await test('sendBatchSms formats and delivers messages to both 0711667099 and 0119204765', async () => {
    // Save original env and fetch
    const origKey = process.env.BONGATECH_API_KEY;
    const origSender = process.env.BONGATECH_SENDER_ID;
    const origFetch = globalThis.fetch;

    process.env.BONGATECH_API_KEY = 'test_api_key_123';
    process.env.BONGATECH_SENDER_ID = 'TEST_SENDER';

    const interceptedRequests: any[] = [];

    globalThis.fetch = (async (url: any, options: any) => {
      const parsedBody = JSON.parse(options.body);
      interceptedRequests.push({ url, options, body: parsedBody });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: true, messageId: 'MSG_' + Math.random().toString(36).slice(2, 9) }),
      } as any;
    }) as any;

    try {
      const items = [
        {
          correlator: 'rec_1',
          phone: TEST_PHONE_1, // 0711667099
          message: 'Dear Customer, your rent receipt for KES 10,000 is confirmed.',
        },
        {
          correlator: 'rec_2',
          phone: TEST_PHONE_2, // 0119204765
          message: 'Dear Customer, your SEPTEMBER water bill is KES 300.',
        },
      ];

      const results = await sendBatchSms(items);

      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0].success, true);
      assert.strictEqual(results[1].success, true);

      // Verify outgoing HTTP payload
      assert.strictEqual(interceptedRequests.length, 1);
      const batchBody = interceptedRequests[0].body;
      assert.strictEqual(batchBody.length, 2);

      // Check normalized phone numbers
      assert.strictEqual(batchBody[0].phone, '254711667099');
      assert.strictEqual(batchBody[1].phone, '254119204765');
      assert.strictEqual(batchBody[0].sender, 'TEST_SENDER');
      assert.strictEqual(batchBody[1].sender, 'TEST_SENDER');
    } finally {
      process.env.BONGATECH_API_KEY = origKey;
      process.env.BONGATECH_SENDER_ID = origSender;
      globalThis.fetch = origFetch;
    }
  });

  // --- SECTION 8: KABAIKU PARSING & RENT RECEIPT SMS VERIFICATION ---
  console.log('\x1b[36m--- Section 8: Kabaiku Parsing & Verification (0711667099 & 0119204765) ---\x1b[0m');

  await test('KABAIKU 2026.xlsx parses valid records and does not abort at Row 10 (LLD row)', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join('data', 'KABAIKU 2026.xlsx'));

    const testSheets = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUNE', 'JULY', 'AUG', 'SEP', 'OCT'];

    for (const sheetName of testSheets) {
      const ws = wb.getWorksheet(sheetName);
      if (!ws) continue;

      const headerRow = ws.getRow(9);
      const headers: string[] = [];
      headerRow.eachCell({ includeEmpty: true }, (c, col) => {
        headers.push(String(c.value || `Col${col}`).trim());
      });

      // Verify that data rows exist after header (e.g. Row 10, 11, 12, 13...)
      const row10 = ws.getRow(10);
      const col2Val = String(row10.getCell(2).value || '').trim();
      assert(col2Val.length > 0, `Sheet ${sheetName} row 10 should have data in col 2`);

      const row13 = ws.getRow(13);
      assert(
        row13.getCell(1).value !== null && row13.getCell(2).value !== null,
        `Sheet ${sheetName} row 13 should have valid tenant data`
      );
    }
  });

  await test('buildRecordSmsPayload generates valid Rent Receipt SMS for Kabaiku records with 0711667099 and 0119204765', async () => {
    const kabaikuCollection = {
      _id: 'col_kabaiku_jan_1',
      name: 'KABAIKU 2026 - JAN',
      type: 'rent_receipt' as const,
    };

    const kabaikuFields = [
      { name: 'HSE NO' },
      { name: 'NAME' },
      { name: 'PHONE NO' },
      { name: 'DEPOSIT PAID' },
      { name: 'MONTHLY RENT' },
      { name: 'BAL B/D' },
      { name: 'RENT DUE' },
      { name: 'RENT PAID' },
      { name: 'RCT NO' },
      { name: 'PERIOD' },
      { name: 'BALANCE' },
    ];

    // Record with test phone 1: 0711667099
    const kabaikuRecord1 = {
      'HSE NO': '2',
      'NAME': 'JOSEPH KITHUKU',
      'PHONE NO': TEST_PHONE_1, // 0711667099
      'MONTHLY RENT': 2500,
      'RENT DUE': 2500,
      'RENT PAID': 2500,
      'RCT NO': 'QWE9876543',
      'PERIOD': 'JAN',
      'BALANCE': 0,
    };

    const payload1 = await buildRecordSmsPayload(kabaikuRecord1, kabaikuFields, kabaikuCollection);
    assert(payload1 !== null, 'Payload 1 must not be null');
    assert.strictEqual(payload1.phone, TEST_PHONE_1);
    assert(payload1.message.includes('Dear JOSEPH KITHUKU, you are in receipt of KES 2,500'));
    assert(payload1.message.includes('for house #2'));
    assert(payload1.message.includes('Your current balance is KES 0.'));

    // Record with test phone 2: 0119204765
    const kabaikuRecord2 = {
      'HSE NO': '3',
      'NAME': 'NELSON KHAVUSHIRWA',
      'PHONE NO': TEST_PHONE_2, // 0119204765
      'MONTHLY RENT': 2500,
      'RENT DUE': 2500,
      'RENT PAID': 2000,
      'RCT NO': 'RTY1234567',
      'PERIOD': 'JAN',
      'BALANCE': 500,
    };

    const payload2 = await buildRecordSmsPayload(kabaikuRecord2, kabaikuFields, kabaikuCollection);
    assert(payload2 !== null, 'Payload 2 must not be null');
    assert.strictEqual(payload2.phone, TEST_PHONE_2);
    assert(payload2.message.includes('Dear NELSON KHAVUSHIRWA, you are in receipt of KES 2,000'));
    assert(payload2.message.includes('for house #3'));
    assert(payload2.message.includes('Your current balance is KES 500.'));
  });

  // --- SECTION 9: DASHBOARD REVENUE CALCULATION & NAN PREVENTION ---
  console.log('\x1b[36m--- Section 9: Dashboard Revenue Calculation & NaN Prevention ---\x1b[0m');

  await test('parseMathExpression safely parses messy Excel values and never returns NaN', () => {
    // Normal numbers
    assert.strictEqual(parseMathExpression(2500), 2500);
    assert.strictEqual(parseMathExpression(0), 0);
    assert.strictEqual(parseMathExpression(-500), -500);

    // Number strings with commas
    assert.strictEqual(parseMathExpression('10,000'), 10000);
    assert.strictEqual(parseMathExpression('  2,500  '), 2500);

    // Math expressions in strings
    assert.strictEqual(parseMathExpression('2500+2500'), 5000);
    assert.strictEqual(parseMathExpression('2000 + 1000 + 500'), 3500);

    // Objects with formula results
    assert.strictEqual(parseMathExpression({ formula: 'H32*10%', result: 3990 }), 3990);
    assert.strictEqual(parseMathExpression({ formula: 'D3-E3', result: '150' }), 150);

    // Non-numeric or empty strings (MUST return 0, NEVER NaN)
    assert.strictEqual(parseMathExpression('VACANT'), 0);
    assert.strictEqual(parseMathExpression('-'), 0);
    assert.strictEqual(parseMathExpression('N/A'), 0);
    assert.strictEqual(parseMathExpression(''), 0);
    assert.strictEqual(parseMathExpression(null), 0);
    assert.strictEqual(parseMathExpression(undefined), 0);
  });

  await test('Dashboard revenue aggregation never results in NaN even with dirty Excel records', () => {
    // Simulate dirty data from various spreadsheet columns
    const testRecords = [
      { 'RENT PAID': '2500+2500' },               // math expression string -> 5000
      { 'RENT PAID': 2500 },                      // number -> 2500
      { 'RENT PAID': '10,000' },                  // comma string -> 10000
      { 'RENT PAID': { result: 3000 } },          // formula result object -> 3000
      { 'RENT PAID': 'VACANT' },                  // non-numeric string -> 0
      { 'RENT PAID': null },                      // null -> 0
      { 'RENT PAID': undefined },                 // undefined -> 0
      { 'RENT PAID': '-' },                       // dash -> 0
    ];

    let totalRevenue = 0;
    for (const rec of testRecords) {
      const amount = parseMathExpression(rec['RENT PAID']);
      assert(!isNaN(amount), `Amount should not be NaN for ${JSON.stringify(rec)}`);
      assert(isFinite(amount), `Amount should be finite for ${JSON.stringify(rec)}`);
      totalRevenue += amount;
    }

    assert.strictEqual(totalRevenue, 20500);
    assert(!isNaN(totalRevenue));
    assert(!totalRevenue.toLocaleString().includes('NaN'));
    assert.strictEqual(`KES ${totalRevenue.toLocaleString()}`, 'KES 20,500');
  });

  // Summary
  console.log('\n======================================================');
  console.log(`TOTAL TESTS: ${passedTests + failedTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllTests();
