import mongoose, { Schema, Document } from 'mongoose';

export interface IPaymentDocument extends Document {
  receiptNumber: string;
  customer: mongoose.Types.ObjectId;
  amount: number;
  paymentMethod: string;
  reference: string;
  paymentDate: Date;
  recordedBy: mongoose.Types.ObjectId;
  smsStatus: 'pending' | 'sent' | 'failed';
  smsId?: string;
  notes?: string;
  createdAt: Date;
}

const PaymentSchema = new Schema<IPaymentDocument>(
  {
    receiptNumber: { type: String, required: true, unique: true, trim: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    amount: { type: Number, required: true },
    paymentMethod: { type: String, required: true, trim: true },
    reference: { type: String, trim: true },
    paymentDate: { type: Date, required: true, default: Date.now },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    smsStatus: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
    smsId: { type: String, trim: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

PaymentSchema.index({ paymentDate: -1 });

export const Payment =
  mongoose.models.Payment || mongoose.model<IPaymentDocument>('Payment', PaymentSchema);
