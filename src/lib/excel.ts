import ExcelJS from 'exceljs';
import { IPayment } from '@/types';

export async function generatePaymentsExcel(payments: IPayment[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Payments');

  sheet.columns = [
    { header: 'Receipt', key: 'receiptNumber', width: 20 },
    { header: 'Date', key: 'paymentDate', width: 15 },
    { header: 'Customer', key: 'customer', width: 25 },
    { header: 'Phone', key: 'phone', width: 18 },
    { header: 'Plot', key: 'plot', width: 18 },
    { header: 'Amount', key: 'amount', width: 15 },
    { header: 'Reference', key: 'reference', width: 20 },
    { header: 'SMS Status', key: 'smsStatus', width: 15 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' },
  };

  payments.forEach((payment) => {
    const pDate = new Date(payment.paymentDate);
    const dateStr = `${pDate.getFullYear()}-${String(pDate.getMonth() + 1).padStart(2, '0')}-${String(pDate.getDate()).padStart(2, '0')}`;

    sheet.addRow({
      receiptNumber: payment.receiptNumber,
      paymentDate: dateStr,
      customer: payment.customer?.name || '',
      phone: payment.customer?.phone || '',
      plot: payment.plot?.plotNumber || '',
      amount: payment.amount,
      reference: payment.reference || '',
      smsStatus: payment.smsStatus,
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

export function getExportFilename(): string {
  const now = new Date();
  return `payments-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.xlsx`;
}
