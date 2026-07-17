import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { UsersClient } from './UsersClient';
import { getUsers } from '@/actions/user.actions';

export default async function UsersPage() {
  const session = await getSession();
  if (!session || session.role !== 'admin') redirect('/');

  const result = await getUsers();
  const users = 'error' in result ? [] : result;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Users</h1>
          <p className="text-muted-foreground">Manage system users</p>
        </div>
      </div>

      <UsersClient users={users as any} />
    </div>
  );
}
