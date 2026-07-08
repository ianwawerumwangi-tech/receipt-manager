'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Receipt, IndianRupee, MessageCircle, AlertTriangle } from 'lucide-react';
import type { DashboardData } from '@/types';

export function DashboardCards({ data }: { data: DashboardData }) {
  const cards = [
    {
      title: "Today's Payments",
      value: data.todayPayments,
      icon: Receipt,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      title: "Today's Revenue",
      value: `KES ${data.todayRevenue.toLocaleString()}`,
      icon: IndianRupee,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    {
      title: 'SMS Sent',
      value: data.smsSent,
      icon: MessageCircle,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
    {
      title: 'Failed SMS',
      value: data.smsFailed,
      icon: AlertTriangle,
      color: 'text-red-600',
      bg: 'bg-red-50',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
              <div className={`p-2 rounded-full ${card.bg}`}>
                <Icon className={`h-4 w-4 ${card.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value}</div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
