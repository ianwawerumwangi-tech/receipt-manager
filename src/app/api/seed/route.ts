import { NextResponse } from 'next/server';
import { dbConnect } from '@/lib/mongodb';
import { User } from '@/models/User';
import { Customer } from '@/models/Customer';
import { hashPassword } from '@/lib/auth';

export async function GET() {
  try {
    await dbConnect();

    const existingAdmin = await User.findOne({ email: 'lobbyenterprices@gmail.com' });
    if (!existingAdmin) {
      await User.create({
        name: 'Admin',
        email: 'lobbyenterprices@gmail.com',
        password: await hashPassword('LOBBY-ENT'),
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



    return NextResponse.json({
      message: 'Seed data created successfully',
      users: { admin: 'admin@example.com / admin123', staff: 'staff@example.com / staff123' },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Seed failed' }, { status: 500 });
  }
}
