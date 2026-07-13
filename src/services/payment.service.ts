import { dbConnect } from '@/lib/mongodb';
import { Payment, IPaymentDocument } from '@/models/Payment';
import { Customer } from '@/models/Customer';
import { SmsLog } from '@/models/SmsLog';
import { buildSmsTemplate, sendSms } from '@/lib/sms';
import { serialize } from '@/lib/utils';

async function generateUniqueReceiptNumber(): Promise<string> {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let isUnique = false;
  let receiptNumber = '';
  
  while (!isUnique) {
    receiptNumber = '';
    for (let i = 0; i < 10; i++) {
      receiptNumber += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const existing = await Payment.findOne({ receiptNumber });
    if (!existing) {
      isUnique = true;
    }
  }
  return receiptNumber;
}

export async function createPayment(data: {
  customerId: string;
  amount: number;
  paymentMethod: string;
  reference: string;
  paymentDate: string;
  notes?: string;
  recordedBy: string;
}) {
  await dbConnect();

  const receiptNumber = await generateUniqueReceiptNumber();

  const payment = await Payment.create({
    receiptNumber,
    customer: data.customerId,
    amount: data.amount,
    paymentMethod: data.paymentMethod,
    reference: data.reference,
    paymentDate: new Date(data.paymentDate),
    recordedBy: data.recordedBy,
    notes: data.notes,
    smsStatus: 'pending',
  });

  const populated = await Payment.findById(payment._id)
    .populate('customer', 'name phone')
    .lean();

  return serialize(populated) as unknown as IPaymentDocument & {
    customer: { name: string; phone: string };
  };
}

export async function sendPaymentSms(paymentId: string) {
  await dbConnect();

  const payment = await Payment.findById(paymentId)
    .populate<{ customer: { name: string; phone: string } }>('customer', 'name phone');

  if (!payment) throw new Error('Payment not found');

  const message = buildSmsTemplate({
    customerName: payment.customer.name,
    amount: payment.amount,
    receiptNumber: payment.receiptNumber,
  });

  const result = await sendSms(payment.customer.phone, message);

  await SmsLog.create({
    payment: payment._id,
    phone: payment.customer.phone,
    message,
    status: result.success ? 'sent' : 'failed',
    gatewayResponse: result.error || result.messageId,
  });

  payment.smsStatus = result.success ? 'sent' : 'failed';
  payment.smsId = result.messageId;
  await payment.save();

  return { success: result.success, error: result.error };
}

export async function getPayments(options?: {
  page?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
}) {
  await dbConnect();

  const { page = 1, limit = 50, startDate, endDate } = options || {};
  const query: Record<string, unknown> = {};

  if (startDate || endDate) {
    const dateFilter: Record<string, Date> = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);
    query.paymentDate = dateFilter;
  }

  const [payments, total] = await Promise.all([
    Payment.find(query)
      .populate('customer', 'name phone')
      .populate('recordedBy', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Payment.countDocuments(query),
  ]);

  return { payments: serialize(payments), total, page, totalPages: Math.ceil(total / limit) };
}

export async function getDashboardData() {
  await dbConnect();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [todayPayments, todayRevenue, smsSent, smsFailed, recentPayments] = await Promise.all([
    Payment.countDocuments({ paymentDate: { $gte: today, $lt: tomorrow } }),
    Payment.aggregate([
      { $match: { paymentDate: { $gte: today, $lt: tomorrow } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Payment.countDocuments({ smsStatus: 'sent', paymentDate: { $gte: today, $lt: tomorrow } }),
    Payment.countDocuments({ smsStatus: 'failed', paymentDate: { $gte: today, $lt: tomorrow } }),
    Payment.find()
      .populate('customer', 'name phone')
      .populate('recordedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
  ]);

  return {
    todayPayments,
    todayRevenue: todayRevenue[0]?.total || 0,
    smsSent,
    smsFailed,
    recentPayments: serialize(recentPayments),
  };
}

export async function retrySms(paymentId: string) {
  return sendPaymentSms(paymentId);
}
