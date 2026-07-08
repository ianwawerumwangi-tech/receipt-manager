'use client';

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExportButton } from '@/components/ExportButton';
import { retryPaymentSms } from '@/actions/payment.actions';
import { RefreshCw } from 'lucide-react';
import type { IPayment } from '@/types';

export function PaymentsClient({ payments: initial }: { payments: IPayment[] }) {
  const [payments, setPayments] = useState(initial);

  const handleRetrySms = async (paymentId: string) => {
    const result = await retryPaymentSms(paymentId);
    if (result.success) {
      setPayments((prev) =>
        prev.map((p) =>
          p._id === paymentId ? { ...p, smsStatus: 'sent' as const } : p
        )
      );
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton />
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Receipt</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Plot</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>SMS</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  No payments yet
                </TableCell>
              </TableRow>
            ) : (
              payments.map((payment) => (
                <TableRow key={payment._id}>
                  <TableCell className="font-mono text-xs">{payment.receiptNumber}</TableCell>
                  <TableCell className="text-sm">
                    {new Date(payment.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>{payment.customer?.name || 'N/A'}</TableCell>
                  <TableCell>{payment.customer?.phone || 'N/A'}</TableCell>
                  <TableCell>{payment.plot?.plotNumber || 'N/A'}</TableCell>
                  <TableCell>KES {payment.amount.toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{payment.reference || '-'}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        payment.smsStatus === 'sent'
                          ? 'default'
                          : payment.smsStatus === 'failed'
                            ? 'destructive'
                            : 'secondary'
                      }
                    >
                      {payment.smsStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {payment.smsStatus === 'failed' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRetrySms(payment._id)}
                      >
                        <RefreshCw className="h-3 w-3 mr-1" />
                        Retry
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
