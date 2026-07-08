'use server';

import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/auth';
import { createPayment, sendPaymentSms, getPayments, getDashboardData, retrySms } from '@/services/payment.service';

export async function recordPayment(data: {
  customerId: string;
  plotId: string;
  amount: number;
  paymentMethod: string;
  reference: string;
  paymentDate: string;
  notes?: string;
}) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  const payment = await createPayment({
    ...data,
    recordedBy: session.userId,
  });

  const smsResult = await sendPaymentSms(payment._id.toString());

  revalidatePath('/');
  revalidatePath('/payments');

  return {
    success: true,
    receiptNumber: payment.receiptNumber,
    smsStatus: smsResult.success ? 'sent' : 'failed',
    smsError: smsResult.error || null,
    paymentId: payment._id.toString(),
  };
}

export async function retryPaymentSms(paymentId: string) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  const result = await retrySms(paymentId);
  revalidatePath('/payments');
  revalidatePath('/');
  return { success: result.success, error: result.error };
}

export async function fetchPayments(options?: {
  page?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
}) {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  return getPayments(options);
}

export async function fetchDashboardData() {
  const session = await getSession();
  if (!session) return { error: 'Unauthorized' };

  return getDashboardData();
}
