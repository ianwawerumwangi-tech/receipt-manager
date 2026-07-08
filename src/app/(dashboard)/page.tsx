import { getSession } from '@/lib/auth';
import { getDashboardData } from '@/services/payment.service';
import { DashboardCards } from '@/components/DashboardCards';
import { RecentPayments } from '@/components/RecentPayments';
import { ExportButton } from '@/components/ExportButton';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';

export default async function DashboardPage() {
  const session = await getSession();
  const data = await getDashboardData();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome back, {session?.email}
          </p>
        </div>
        <div className="flex gap-3">
          <ExportButton />
          <Link href="/payments/new">
            <Button>
              <PlusCircle className="h-4 w-4 mr-2" />
              New Payment
            </Button>
          </Link>
        </div>
      </div>

      <DashboardCards data={data} />

      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Recent Payments</h2>
        <RecentPayments payments={data.recentPayments as any} />
      </div>
    </div>
  );
}
