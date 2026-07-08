import mongoose, { Schema, Document } from 'mongoose';

export interface IUserDocument extends Document {
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'staff';
  createdAt: Date;
}

const UserSchema = new Schema<IUserDocument>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ['admin', 'staff'], default: 'staff' },
  },
  { timestamps: true }
);

export const User = mongoose.models.User || mongoose.model<IUserDocument>('User', UserSchema);
