interface SmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendSms(phone: string, message: string): Promise<SmsResult> {
  const apiUrl = process.env.BONGATECH_API_URL;
  const apiKey = process.env.BONGATECH_API_KEY;
  const senderId = process.env.BONGATECH_SENDER_ID;

  if (!apiKey || !senderId) {
    return { success: false, error: 'BongaTech not configured' };
  }

  try {
    const response = await fetch(apiUrl!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        to: phone,
        from: senderId,
        message,
      }),
    });

    const data = await response.json();

    if (response.ok) {
      return { success: true, messageId: data.messageId || data.id };
    }

    return { success: false, error: data.message || data.error || 'SMS failed' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export function buildSmsTemplate(params: {
  customerName: string;
  amount: number;
  receiptNumber: string;
}): string {
  return `Dear ${params.customerName},

We have received your payment of
KES ${params.amount.toLocaleString()}

Receipt No:
${params.receiptNumber}

Thank you.

Company Name`;
}
