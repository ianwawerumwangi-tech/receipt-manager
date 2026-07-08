export interface IUser {
  _id: string;
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'staff';
  createdAt: Date;
}

export interface ICustomer {
  _id: string;
  name: string;
  phone: string;
  email?: string;
  nationalId?: string;
  notes?: string;
  createdAt: Date;
}

export interface IPlot {
  _id: string;
  plotNumber: string;
  project: string;
  location: string;
  size: number;
  price: number;
  status: 'available' | 'reserved' | 'sold';
  customer?: string;
  createdAt: Date;
}

export interface IPayment {
  _id: string;
  receiptNumber: string;
  customer: { _id: string; name: string; phone: string };
  plot: { _id: string; plotNumber: string; project: string };
  amount: number;
  paymentMethod: string;
  reference: string;
  paymentDate: Date;
  recordedBy: { _id: string; name: string };
  smsStatus: 'pending' | 'sent' | 'failed';
  smsId?: string;
  notes?: string;
  createdAt: Date;
}

export interface ISmsLog {
  _id: string;
  payment: string;
  phone: string;
  message: string;
  status: string;
  gatewayResponse?: string;
  sentAt: Date;
}

export type DashboardData = {
  todayPayments: number;
  todayRevenue: number;
  smsSent: number;
  smsFailed: number;
  recentPayments: IPayment[];
};
