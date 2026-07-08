import { NextResponse } from 'next/server';
import { dbConnect } from '@/lib/mongodb';
import { User } from '@/models/User';
import { Customer } from '@/models/Customer';
import { Plot } from '@/models/Plot';
import { hashPassword } from '@/lib/auth';

export async function GET() {
  try {
    await dbConnect();

    const existingAdmin = await User.findOne({ email: 'admin@example.com' });
    if (!existingAdmin) {
      await User.create({
        name: 'Admin',
        email: 'admin@example.com',
        password: await hashPassword('admin123'),
        role: 'admin',
      });
    }

    const existingStaff = await User.findOne({ email: 'staff@example.com' });
    if (!existingStaff) {
      await User.create({
        name: 'Staff User',
        email: 'staff@example.com',
        password: await hashPassword('staff123'),
        role: 'staff',
      });
    }

    const customerCount = await Customer.countDocuments();
    if (customerCount === 0) {
      await Customer.create([
        { name: 'John Doe', phone: '+254712345678', email: 'john@example.com' },
        { name: 'Jane Smith', phone: '+254798765432', email: 'jane@example.com' },
        { name: 'Bob Johnson', phone: '+25475551234', nationalId: '12345678' },
      ]);
    }

    const plotCount = await Plot.countDocuments();
    if (plotCount === 0) {
      await Plot.create([
        { plotNumber: 'PLT-001', project: 'Green Valley', location: 'Nairobi', size: 0.25, price: 2500000, status: 'available' },
        { plotNumber: 'PLT-002', project: 'Green Valley', location: 'Nairobi', size: 0.5, price: 4500000, status: 'available' },
        { plotNumber: 'PLT-003', project: 'Sunset Hills', location: 'Kiambu', size: 0.3, price: 3200000, status: 'available' },
        { plotNumber: 'PLT-004', project: 'Sunset Hills', location: 'Kiambu', size: 1.0, price: 8000000, status: 'available' },
        { plotNumber: 'PLT-005', project: 'Riverside Estate', location: 'Machakos', size: 0.5, price: 5000000, status: 'available' },
      ]);
    }

    return NextResponse.json({
      message: 'Seed data created successfully',
      users: { admin: 'admin@example.com / admin123', staff: 'staff@example.com / staff123' },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Seed failed' }, { status: 500 });
  }
}
