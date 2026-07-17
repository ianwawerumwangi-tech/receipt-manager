import mongoose, { Schema, Document } from 'mongoose';

export interface ICustomerDocument extends Document {
  name: string;
  phone: string;
  email?: string;
  nationalId?: string;
  notes?: string;
  createdAt: Date;
}

const CustomerSchema = new Schema<ICustomerDocument>(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    nationalId: { type: String, trim: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

export const Customer =
  mongoose.models.Customer || mongoose.model<ICustomerDocument>('Customer', CustomerSchema);
