import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { dbConnect } from './mongodb';
import { User, IUserDocument } from '@/models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';

export interface JwtPayload {
  userId: string;
  email: string;
  role: 'admin' | 'staff';
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<JwtPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('session')?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function requireAuth(allowedRoles?: ('admin' | 'staff')[]) {
  const session = await getSession();
  if (!session) throw new Error('Unauthorized');
  if (allowedRoles && !allowedRoles.includes(session.role)) {
    throw new Error('Forbidden');
  }
  return session;
}

export async function seedAdmin() {
  await dbConnect();
  const existing = await User.findOne({ email: 'admin@example.com' });
  if (!existing) {
    await User.create({
      name: 'Admin',
      email: 'admin@example.com',
      password: await hashPassword('admin123'),
      role: 'admin',
    });
  }
}
