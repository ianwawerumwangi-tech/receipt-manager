import mongoose, { Schema, Document } from 'mongoose';

export interface ICollectionDocument extends Document {
  name: string;
  description?: string;
  type?: 'rent_receipt' | 'water_bill' | 'invoice' | 'general';
  createdBy: mongoose.Types.ObjectId;
  defaultInvoiceTemplateId?: string;
  plotName?: string;
  createdAt: Date;
}

const CollectionSchema = new Schema<ICollectionDocument>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    type: {
      type: String,
      enum: ['rent_receipt', 'water_bill', 'invoice', 'general'],
      default: 'rent_receipt',
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    defaultInvoiceTemplateId: { type: String, trim: true },
    plotName: { type: String, trim: true },
  },
  { timestamps: true }
);

export const Collection =
  mongoose.models.Collection || mongoose.model<ICollectionDocument>('Collection', CollectionSchema);
