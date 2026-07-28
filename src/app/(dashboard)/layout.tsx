import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Sidebar } from '@/components/Sidebar';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-background">
      <Sidebar role={session.role} />
      <main className="flex-1 min-w-0 p-4 sm:p-6 md:p-8 overflow-auto w-full">{children}</main>
    </div>
  );
}
