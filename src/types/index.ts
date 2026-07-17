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

export interface IPayment {
  _id: string;
  receiptNumber: string;
  customer: { _id: string; name: string; phone: string };
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

export interface ICollection {
  _id: string;
  name: string;
  description?: string;
  createdBy: string;
  createdAt: Date;
  fieldCount?: number;
  recordCount?: number;
}

export interface IField {
  _id: string;
  collectionId: string;
  name: string;
  type: 'text' | 'number' | 'date' | 'boolean' | 'textarea' | 'email' | 'phone' | 'relation';
  required: boolean;
  order: number;
  targetCollectionId?: string;
}

export interface IRecord {
  _id: string;
  collectionId: string;
  data: Record<string, unknown>;
  createdBy: string;
  createdAt: Date;
}

export type FieldType = 'text' | 'number' | 'date' | 'boolean' | 'textarea' | 'email' | 'phone' | 'relation';
