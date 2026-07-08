import mongoose, { Schema, Document } from 'mongoose';

export interface ISmsLogDocument extends Document {
  payment: mongoose.Types.ObjectId;
  phone: string;
  message: string;
  status: string;
  gatewayResponse?: string;
  sentAt: Date;
}

const SmsLogSchema = new Schema<ISmsLogDocument>(
  {
    payment: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
    phone: { type: String, required: true },
    message: { type: String, required: true },
    status: { type: String, required: true },
    gatewayResponse: { type: String },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const SmsLog =
  mongoose.models.SmsLog || mongoose.model<ISmsLogDocument>('SmsLog', SmsLogSchema);
