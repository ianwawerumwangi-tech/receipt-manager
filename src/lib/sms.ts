interface SmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export function formatPhoneNumber(phone: string): string {
  // Remove all non-numeric characters
  let cleaned = phone.replace(/\D/g, '');
  
  // If it starts with '0' and is 10 digits long, change '0' to '254'
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    cleaned = '254' + cleaned.substring(1);
  }
  
  // If it starts with '7' or '1' and is 9 digits long (local format without leading 0)
  if ((cleaned.startsWith('7') || cleaned.startsWith('1')) && cleaned.length === 9) {
    cleaned = '254' + cleaned;
  }
  
  return cleaned;
}

export async function sendSms(phone: string, message: string): Promise<SmsResult> {
  let apiUrl = process.env.BONGATECH_API_URL || 'https://bulk.bongatech.co.ke/api/v1/send-sms';
  if (apiUrl.includes('api.bongatech.co.ke/sms/v1/send') || apiUrl.includes('api.bongatech.co.ke')) {
    apiUrl = 'https://bulk.bongatech.co.ke/api/v1/send-sms';
  }
  const apiKey = process.env.BONGATECH_API_KEY || process.env.BONGATECH_API_TOKEN || process.env.BONGATECH_TOKEN || process.env.VERCEL_BONGATECH_API_KEY || process.env.VERCEL_BONGATECH_TOKEN;
  const senderId = process.env.BONGATECH_SENDER_ID || process.env.BONGATECH_SENDERID || process.env.VERCEL_BONGATECH_SENDER_ID;

  if (!apiKey || !senderId) {
    const missingKeys = [];
    if (!apiKey) missingKeys.push('API key/token (e.g., BONGATECH_API_KEY / BONGATECH_TOKEN)');
    if (!senderId) missingKeys.push('Sender ID (e.g., BONGATECH_SENDER_ID)');
    return {
      success: false,
      error: `BongaTech not configured: Missing ${missingKeys.join(' and ')}. Please configure these environment variables in your Vercel project settings.`
    };
  }

  const formattedPhone = formatPhoneNumber(phone);
  if (!formattedPhone) {
    return { success: false, error: 'Invalid phone number: Number contains no digits.' };
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        phone: formattedPhone,
        sender: senderId,
        message,
      }),
    });

    const responseText = await response.text();
    let data: any = {};
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error('[BongaTech SMS Error] API returned non-JSON response:', {
        status: response.status,
        responseText,
        phone: formattedPhone,
        sender: senderId
      });
      return {
        success: false,
        error: `API returned non-JSON response: "${responseText.substring(0, 150)}" (Status: ${response.status})`
      };
    }

    if (response.ok) {
      return { success: true, messageId: data.messageId || data.id || data.message };
    }

    let errorMsg = data.message || data.error || '';
    if (data.errors && typeof data.errors === 'object') {
      const detailedErrors = Object.entries(data.errors)
        .map(([field, msgs]) => `${field}: ${Array.isArray(msgs) ? msgs.join(', ') : String(msgs)}`)
        .join('; ');
      errorMsg = errorMsg ? `${errorMsg} (${detailedErrors})` : detailedErrors;
    }

    console.error('[BongaTech SMS Error] Failed API response:', {
      status: response.status,
      error: errorMsg,
      data,
      phone: formattedPhone,
      sender: senderId
    });

    return {
      success: false,
      error: errorMsg || `SMS failed (Status: ${response.status}). Response: ${responseText.substring(0, 150)}`
    };
  } catch (error) {
    console.error('[BongaTech SMS Error] Fetch or network exception:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error during SMS request' };
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
