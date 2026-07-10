import mongoose, { Schema, Document } from 'mongoose';

export interface IFieldDocument extends Document {
  collectionId: mongoose.Types.ObjectId;
  name: string;
  type: 'text' | 'number' | 'date' | 'boolean' | 'textarea' | 'email' | 'phone' | 'relation';
  required: boolean;
  order: number;
  targetCollectionId?: mongoose.Types.ObjectId;
  createdAt: Date;
}

const FieldSchema = new Schema<IFieldDocument>(
  {
    collectionId: { type: Schema.Types.ObjectId, ref: 'Collection', required: true },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['text', 'number', 'date', 'boolean', 'textarea', 'email', 'phone', 'relation'],
      default: 'text',
    },
    required: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    targetCollectionId: { type: Schema.Types.ObjectId, ref: 'Collection' },
  },
  { timestamps: true }
);

FieldSchema.index({ collectionId: 1, order: 1 });

export const Field =
  mongoose.models.Field || mongoose.model<IFieldDocument>('Field', FieldSchema);
