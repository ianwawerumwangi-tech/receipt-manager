import mongoose, { Schema, Document } from 'mongoose';

export interface IPlotDocument extends Document {
  plotNumber: string;
  project: string;
  location: string;
  size: number;
  price: number;
  status: 'available' | 'reserved' | 'sold';
  customer?: mongoose.Types.ObjectId;
  createdAt: Date;
}

const PlotSchema = new Schema<IPlotDocument>(
  {
    plotNumber: { type: String, required: true, trim: true },
    project: { type: String, required: true, trim: true },
    location: { type: String, required: true, trim: true },
    size: { type: Number, required: true },
    price: { type: Number, required: true },
    status: { type: String, enum: ['available', 'reserved', 'sold'], default: 'available' },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer' },
  },
  { timestamps: true }
);

export const Plot = mongoose.models.Plot || mongoose.model<IPlotDocument>('Plot', PlotSchema);
