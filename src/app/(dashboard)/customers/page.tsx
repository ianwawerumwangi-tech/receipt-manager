import { getSession } from '@/lib/auth';
import { CustomersClient } from './CustomersClient';
import { getCustomers } from '@/actions/customer.actions';

export default async function CustomersPage() {
  const session = await getSession();
  const customers = await getCustomers();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Customers</h1>
          <p className="text-muted-foreground">{customers.length} customers</p>
        </div>
      </div>

      <CustomersClient customers={customers} isAdmin={session?.role === 'admin'} />
    </div>
  );
}
