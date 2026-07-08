'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Receipt,
  Users,
  MapPin,
  UserCog,
  LogOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { logout } from '@/actions/auth.actions';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/payments', label: 'Payments', icon: Receipt },
  { href: '/customers', label: 'Customers', icon: Users },
  { href: '/plots', label: 'Plots', icon: MapPin },
  { href: '/users', label: 'Users', icon: UserCog },
];

export function Sidebar({ role }: { role: string }) {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r bg-card flex flex-col h-screen sticky top-0">
      <div className="p-6 border-b">
        <h1 className="text-xl font-bold">Receipt Manager</h1>
        <p className="text-sm text-muted-foreground capitalize">{role}</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          if (item.href === '/users' && role !== 'admin') return null;
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}>
              <span
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  pathname === item.href
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t">
        <form action={logout}>
          <Button variant="ghost" className="w-full justify-start" type="submit">
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>
        </form>
      </div>
    </aside>
  );
}
