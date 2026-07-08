import { dbConnect } from '@/lib/mongodb';
import { Payment } from '@/models/Payment';
import { generatePaymentsExcel, getExportFilename } from '@/lib/excel';

export async function exportPaymentsToExcel() {
  await dbConnect();

  const payments = await Payment.find()
    .populate('customer', 'name phone')
    .populate('plot', 'plotNumber project')
    .sort({ createdAt: -1 })
    .lean();

  const buffer = await generatePaymentsExcel(payments as any);
  const filename = getExportFilename();

  return { buffer, filename };
}
