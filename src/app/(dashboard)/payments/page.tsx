import { getSession } from '@/lib/auth';
import { getPayments } from '@/services/payment.service';
import { PaymentsClient } from './PaymentsClient';

export default async function PaymentsPage() {
  const session = await getSession();
  const { payments, total, page, totalPages } = await getPayments({ limit: 100 });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Payments</h1>
          <p className="text-muted-foreground">{total} total payments</p>
        </div>
      </div>

      <PaymentsClient payments={payments as any} />
    </div>
  );
}
