'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  UserCog,
  LogOut,
  Layers,
  Menu,
  X,
  Receipt,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { logout } from '@/actions/auth.actions';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/collections', label: 'Collections', icon: Layers },
  { href: '/users', label: 'Users', icon: UserCog },
];

export function Sidebar({ role }: { role: string }) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <>
      {/* Mobile Top Navigation Bar (Visible on screens < md) */}
      <header className="md:hidden sticky top-0 z-40 flex items-center justify-between px-4 py-3 bg-card border-b w-full">
        <div className="flex items-center gap-2">
          <Receipt className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-base font-bold leading-none">Receipt Manager</h1>
            <p className="text-xs text-muted-foreground capitalize">{role}</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle menu"
          className="p-2"
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </header>

      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex flex-col"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="bg-card w-4/5 max-w-xs h-full border-r flex flex-col p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 mb-4 border-b">
              <div className="flex items-center gap-2">
                <Receipt className="h-6 w-6 text-primary" />
                <div>
                  <h2 className="font-bold text-base">Receipt Manager</h2>
                  <p className="text-xs text-muted-foreground capitalize">{role}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMobileMenuOpen(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <nav className="flex-1 space-y-1">
              {navItems.map((item) => {
                if (item.href === '/users' && role !== 'admin') return null;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <span
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
                        pathname === item.href
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                      )}
                    >
                      <Icon className="h-5 w-5" />
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </nav>

            <div className="pt-4 border-t mt-auto">
              <form action={logout}>
                <Button variant="ghost" className="w-full justify-start text-destructive" type="submit">
                  <LogOut className="h-5 w-5 mr-2" />
                  Logout
                </Button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Desktop Sidebar (Visible on md and above) */}
      <aside className="hidden md:flex w-64 border-r bg-card flex-col h-screen sticky top-0 shrink-0">
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
    </>
  );
}
