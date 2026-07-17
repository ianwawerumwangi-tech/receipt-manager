'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { recordPayment } from '@/actions/payment.actions';
import { getCustomers } from '@/actions/customer.actions';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

interface Customer {
  _id: string;
  name: string;
  phone: string;
}

type Step = 'form' | 'saving' | 'result';

export function PaymentForm() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [step, setStep] = useState<Step>('form');
  const [result, setResult] = useState<{
    receiptNumber?: string;
    smsStatus?: string;
    smsError?: string | null;
  }>({});

  const [form, setForm] = useState({
    customerId: '',
    amount: '',
    paymentMethod: '',
    reference: '',
    paymentDate: new Date().toISOString().split('T')[0],
    notes: '',
  });

  useEffect(() => {
    getCustomers().then(setCustomers);
  }, []);

  const selectedCustomer = customers.find((c) => c._id === form.customerId);

  const paymentMethodLabels: Record<string, string> = {
    cash: 'Cash',
    mpesa: 'M-Pesa',
    bank_transfer: 'Bank Transfer',
    cheque: 'Cheque',
    other: 'Other',
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStep('saving');

    const res = await recordPayment({
      customerId: form.customerId,
      amount: Number(form.amount),
      paymentMethod: form.paymentMethod,
      reference: form.reference,
      paymentDate: form.paymentDate,
      notes: form.notes || undefined,
    });

    if ('error' in res) {
      setResult({ smsStatus: 'failed', smsError: res.error });
      setStep('result');
      return;
    }

    setResult({
      receiptNumber: res.receiptNumber,
      smsStatus: res.smsStatus,
      smsError: res.smsError,
    });
    setStep('result');
  };

  if (step === 'saving') {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="text-lg font-medium">Recording payment...</p>
        <p className="text-sm text-muted-foreground">Please wait while we process and send SMS</p>
      </div>
    );
  }

  if (step === 'result') {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-6">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-10 w-10 text-green-500" />
          <div>
            <p className="text-lg font-semibold">Payment Recorded</p>
            {result.receiptNumber && (
              <p className="text-sm text-muted-foreground">
                Receipt Number:
                <span className="font-mono font-bold ml-1">{result.receiptNumber}</span>
              </p>
            )}
          </div>
        </div>

        {result.smsStatus === 'sent' ? (
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-5 w-5" />
            <span>SMS Sent Successfully</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-amber-600">
            <AlertCircle className="h-5 w-5" />
            <span>SMS Failed{result.smsError ? `: ${result.smsError}` : ''}</span>
          </div>
        )}

        <div className="flex gap-3">
          <Button onClick={() => { setStep('form'); setForm({ ...form, reference: '', notes: '' }); }}>
            New Payment
          </Button>
          <Button variant="outline" onClick={() => router.push('/payments')}>
            View Payments
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="customer">Customer</Label>
          <Select
            value={form.customerId}
            onValueChange={(v) => v && setForm({ ...form, customerId: v })}
            required
          >
            <SelectTrigger>
              <SelectValue placeholder="Select customer">
                {selectedCustomer ? `${selectedCustomer.name} - ${selectedCustomer.phone}` : ''}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {customers.map((c) => (
                <SelectItem key={c._id} value={c._id}>
                  {c.name} - {c.phone}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="amount">Amount (KES)</Label>
          <Input
            id="amount"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="paymentMethod">Payment Method</Label>
          <Select
            value={form.paymentMethod}
            onValueChange={(v) => v && setForm({ ...form, paymentMethod: v })}
            required
          >
            <SelectTrigger>
              <SelectValue placeholder="Select method">
                {form.paymentMethod ? paymentMethodLabels[form.paymentMethod] : ''}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="mpesa">M-Pesa</SelectItem>
              <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
              <SelectItem value="cheque">Cheque</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="reference">Transaction Reference</Label>
          <Input
            id="reference"
            placeholder="M-Pesa code, cheque no, etc."
            value={form.reference}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="paymentDate">Payment Date</Label>
          <Input
            id="paymentDate"
            type="date"
            value={form.paymentDate}
            onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea
          id="notes"
          placeholder="Any additional notes..."
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </div>

      <Button type="submit" className="w-full" size="lg">
        Save Payment
      </Button>
    </form>
  );
}
