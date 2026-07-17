import mongoose, { Schema, Document } from 'mongoose';

export interface ICollectionDocument extends Document {
  name: string;
  description?: string;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
}

const CollectionSchema = new Schema<ICollectionDocument>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

export const Collection =
  mongoose.models.Collection || mongoose.model<ICollectionDocument>('Collection', CollectionSchema);
