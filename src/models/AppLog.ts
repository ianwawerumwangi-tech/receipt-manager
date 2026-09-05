import mongoose, { Schema, Document } from 'mongoose';

export interface IAppLogDocument extends Document {
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'success';
  category: 'sms' | 'import' | 'auth' | 'collection' | 'system';
  action: string;
  message: string;
  recipient?: string;
  phone?: string;
  houseNo?: string;
  customerName?: string;
  collectionName?: string;
  collectionId?: mongoose.Types.ObjectId | string;
  recordId?: mongoose.Types.ObjectId | string;
  status: 'success' | 'failed' | 'pending';
  gatewayResponse?: string;
  error?: string;
  details?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const AppLogSchema = new Schema<IAppLogDocument>(
  {
    timestamp: { type: Date, default: Date.now, index: true },
    level: {
      type: String,
      enum: ['info', 'warn', 'error', 'success'],
      default: 'info',
      index: true,
    },
    category: {
      type: String,
      enum: ['sms', 'import', 'auth', 'collection', 'system'],
      default: 'system',
      index: true,
    },
    action: { type: String, required: true },
    message: { type: String, required: true },
    recipient: { type: String },
    phone: { type: String },
    houseNo: { type: String },
    customerName: { type: String },
    collectionName: { type: String },
    collectionId: { type: Schema.Types.ObjectId, ref: 'Collection' },
    recordId: { type: Schema.Types.ObjectId, ref: 'Record' },
    status: {
      type: String,
      enum: ['success', 'failed', 'pending'],
      default: 'success',
      index: true,
    },
    gatewayResponse: { type: String },
    error: { type: String },
    details: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

export const AppLog =
  mongoose.models.AppLog || mongoose.model<IAppLogDocument>('AppLog', AppLogSchema);
