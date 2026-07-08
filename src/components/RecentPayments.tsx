'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { IPayment } from '@/types';

export function RecentPayments({ payments }: { payments: IPayment[] }) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Receipt</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Plot</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>SMS</TableHead>
            <TableHead>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                No payments recorded yet
              </TableCell>
            </TableRow>
          ) : (
            payments.map((payment) => (
              <TableRow key={payment._id}>
                <TableCell className="font-mono text-xs">{payment.receiptNumber}</TableCell>
                <TableCell>{payment.customer?.name || 'N/A'}</TableCell>
                <TableCell>{payment.plot?.plotNumber || 'N/A'}</TableCell>
                <TableCell>KES {payment.amount.toLocaleString()}</TableCell>
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
                <TableCell className="text-sm">
                  {new Date(payment.createdAt).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
