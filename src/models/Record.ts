import mongoose, { Schema, Document } from 'mongoose';

export interface IRecordDocument extends Document {
  collectionId: mongoose.Types.ObjectId;
  data: Map<string, unknown>;
  order?: number;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
}

const RecordSchema = new Schema<IRecordDocument>(
  {
    collectionId: { type: Schema.Types.ObjectId, ref: 'Collection', required: true },
    data: { type: Map, of: Schema.Types.Mixed, default: {} },
    order: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

RecordSchema.index({ collectionId: 1, order: 1, createdAt: 1 });

export const Record =
  mongoose.models.Record || mongoose.model<IRecordDocument>('Record', RecordSchema);

