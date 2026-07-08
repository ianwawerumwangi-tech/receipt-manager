import { NextResponse } from 'next/server';
import { exportPaymentsToExcel } from '@/services/export.service';
import { getSession } from '@/lib/auth';

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { buffer, filename } = await exportPaymentsToExcel();

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Export failed' },
      { status: 500 }
    );
  }
}
