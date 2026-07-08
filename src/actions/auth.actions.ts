'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { dbConnect } from '@/lib/mongodb';
import { User } from '@/models/User';
import { comparePassword, signToken, verifyToken } from '@/lib/auth';

export async function login(formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!email || !password) {
    return { error: 'Email and password are required' };
  }

  await dbConnect();

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user) {
    return { error: 'Invalid credentials' };
  }

  const valid = await comparePassword(password, user.password);
  if (!valid) {
    return { error: 'Invalid credentials' };
  }

  const token = signToken({
    userId: user._id.toString(),
    email: user.email,
    role: user.role,
  });

  const cookieStore = await cookies();
  cookieStore.set('session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24,
    path: '/',
  });

  redirect('/');
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete('session');
  redirect('/login');
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get('session')?.value;
  if (!token) return null;

  const payload = verifyToken(token);
  if (!payload) return null;

  await dbConnect();
  const user = await User.findById(payload.userId).lean();
  if (!user) return null;

  return {
    _id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
  };
}
