export interface InvoiceTemplate {
  id: string;
  name: string;
  category: string;
  paybillOrBank: string;
  accountDetails: string;
  description: string;
  buildMessage: (params: { month: string; houseNo?: string; plotName?: string }) => string;
}

export const ALL_MONTHS = [
  { short: 'JAN', full: 'JANUARY' },
  { short: 'FEB', full: 'FEBRUARY' },
  { short: 'MAR', full: 'MARCH' },
  { short: 'APR', full: 'APRIL' },
  { short: 'MAY', full: 'MAY' },
  { short: 'JUN', full: 'JUNE' },
  { short: 'JUL', full: 'JULY' },
  { short: 'AUG', full: 'AUGUST' },
  { short: 'SEP', full: 'SEPTEMBER' },
  { short: 'OCT', full: 'OCTOBER' },
  { short: 'NOV', full: 'NOVEMBER' },
  { short: 'DEC', full: 'DECEMBER' },
];

export function getCurrentInvoiceMonth(): string {
  return new Date().toLocaleString('en-US', { month: 'long' }).toUpperCase();
}

export function extractMonthFromCollection(name: string): string | null {
  if (!name) return null;
  const upper = name.toUpperCase();
  for (const m of ALL_MONTHS) {
    const regex = new RegExp(`\\b(${m.full}|${m.short})\\b`, 'i');
    if (regex.test(upper)) {
      return m.full;
    }
  }
  return null;
}

export function formatSelectedMonths(months: string[]): string {
  if (!months || months.length === 0) return '';
  if (months.length === 1) return months[0];
  if (months.length === 2) return `${months[0]} & ${months[1]}`;
  return `${months.slice(0, -1).join(', ')} & ${months[months.length - 1]}`;
}

export function templateUsesHouseNo(template: InvoiceTemplate): boolean {
  if (!template) return false;
  const sample = template.buildMessage({ month: 'TEST', houseNo: 'SAMPLE_HSE_123' });
  return sample.includes('SAMPLE_HSE_123');
}

export function resolveInvoiceMessage(
  templateOrCustomText: string,
  params: {
    houseNo?: string;
    name?: string;
    month?: string;
    plotName?: string;
    balance?: string | number;
  }
): string {
  if (!templateOrCustomText) return '';
  let result = templateOrCustomText;

  const house = params.houseNo !== undefined ? String(params.houseNo).trim() : '';
  const name = params.name !== undefined ? String(params.name).trim() : 'Tenant';
  const month = params.month !== undefined ? String(params.month).trim() : '';
  const plot = params.plotName !== undefined ? String(params.plotName).trim() : '';
  const balance = params.balance !== undefined ? String(params.balance).trim() : '';

  result = result.replace(/\{houseNo\}|\{house_no\}|\{house\}|\{hseNo\}|\{hse\}/gi, house);
  result = result.replace(/\{name\}|\{tenant\}|\{customer\}|\{client\}/gi, name);
  result = result.replace(/\{month\}|\{months\}|\{period\}/gi, month);
  result = result.replace(/\{plotName\}|\{plot_name\}|\{plot\}|\{property\}/gi, plot);
  result = result.replace(/\{balance\}|\{bal\}|\{amount\}/gi, balance);

  return result;
}

export function extractPlotNameFromCollection(name: string): string {
  if (!name) return '';
  let clean = name.replace(/\s*-\s*(JAN|FEB|MAR|APR|MAY|JUN|JUNE|JUL|JULY|AUG|SEP|SEPT|OCT|NOV|DEC).*/i, '');
  clean = clean.replace(/\s+20\d\d.*/i, '');
  clean = clean.replace(/\s+Receipts$/i, '');
  clean = clean.replace(/\s+Water\s+Bill.*/i, '');
  return clean.trim();
}

export const INVOICE_TEMPLATES: InvoiceTemplate[] = [
  {
    id: 'sidian-111999',
    name: 'Sidian Bank Paybill 111999 (A/C 01001710003718)',
    category: 'Bank Paybill',
    paybillOrBank: 'Paybill 111999',
    accountDetails: 'A/C No. 01001710003718 (SIDIAN Bank)',
    description: 'Paybill 111999, A/C 01001710003718',
    buildMessage: ({ month }) =>
      `Dear Esteemed Tenant, your ${month} rent is due. Please pay by today. Pay via Paybill 111999, A/C No. 01001710003718 (SIDIAN Bank). Cash payments to staff are not accepted. Ignore if you have already paid. Thank you.`,
  },
  {
    id: 'equity-247247-063018',
    name: 'Equity Bank Paybill 247247 (A/C 0630184433574)',
    category: 'Equity Paybill',
    paybillOrBank: 'Equity Paybill 247247',
    accountDetails: 'A/C 0630184433574',
    description: 'Equity Paybill 247247, A/C 0630184433574, Forward to Max 0713251597',
    buildMessage: ({ month }) =>
      `Dear Tenant, your ${month} rent is due. Please pay by today to avoid distress action. Pay via Equity Bank Paybill 247247, A/C 0630184433574 (LUCY WANGARI). Forward the payment SMS to Max\n0713251597. Cash payments to staff are not accepted. Ignore if you have already paid. Thank you.`,
  },
  {
    id: 'absa-303030',
    name: 'ABSA Bank Paybill 303030 (A/C 2049844029)',
    category: 'Bank Paybill',
    paybillOrBank: 'Paybill 303030',
    accountDetails: 'A/C No. 2049844029 (ABSA Bank)',
    description: 'ABSA Bank Paybill 303030, A/C 2049844029, Forward to David 0746112221',
    buildMessage: ({ month }) =>
      `Dear Esteemed Tenant, your ${month} rent is due. Please pay by today to avoid distress action. Pay via Paybill 303030, A/C No. 2049844029 (ABSA Bank). Forward the payment SMS to David 0746112221 Cash to staff is not accepted or acknowledged. Ignore if you have already paid. Thank you`,
  },
  {
    id: 'mpesa-direct-0721813',
    name: 'M-Pesa Direct Payment (0721 813 403)',
    category: 'M-Pesa Direct',
    paybillOrBank: 'M-Pesa 0721 813 403',
    accountDetails: 'Phone 0721 813 403',
    description: 'M-Pesa 0721 813 403, Forward SMS to Yegon 0736 721 662',
    buildMessage: ({ month }) =>
      `Dear Esteemed Tenant, your ${month} rent is due. Please pay by today to avoid distress action. Pay via M-Pesa 0721 813 403 (ESTHER KARIUKI). Forward the payment SMS to Yegon 0736 721 662. Cash to staff is not accepted or acknowledged. Ignore if you have already paid. Thank you.`,
  },
  {
    id: 'equity-247247-057017',
    name: 'Equity Bank Paybill 247247 (A/C 0570177473159)',
    category: 'Equity Paybill',
    paybillOrBank: 'Equity Paybill 247247',
    accountDetails: 'A/C No. 0570177473159',
    description: 'Equity Paybill 247247, A/C 0570177473159, Forward to David 0746112221',
    buildMessage: ({ month }) =>
      `Dear Esteemed Tenant, your ${month} rent is due. Please pay by today to avoid distress action. Pay via Equity Bank Paybill 247247, A/C No. 0570177473159, A/C Name: Sarah Njoki. Forward the payment SMS to David\n0746112221. Cash to staff is not accepted or acknowledged. Ignore if you have already paid. Thank you.`,
  },
  {
    id: 'mpesa-880100-ncba',
    name: 'M-Pesa Paybill 880100 & NCBA Bank (A/C 711933#Plot/Hse & NCBA 1000559072)',
    category: 'Multi-Option',
    paybillOrBank: 'Paybill 880100 & NCBA Bank',
    accountDetails: 'Paybill 880100 A/C 711933#Plot/Hse & NCBA 1000559072',
    description: 'M-Pesa Paybill 880100 / NCBA Bank 1000559072, SMS to Asman 0104042414',
    buildMessage: ({ month, houseNo, plotName }) => {
      let plotAndHse = 'Plot Name/Hse No.';
      if (plotName && houseNo) {
        plotAndHse = `${plotName}/${houseNo}`;
      } else if (houseNo) {
        plotAndHse = houseNo;
      } else if (plotName) {
        plotAndHse = plotName;
      }
      return `Dear Esteemed Tenant, your ${month} rent is due. Please pay by today to avoid distress action.\n\nOption 1: M-PESA Paybill 880100, A/C: 711933#${plotAndHse}\n\nOption 2: NCBA Bank A/C No. 1000559072, Name: Joseph Mwangi Githinji.\n\nNo cash payments to staff are accepted. SMS confirmation to Asman 0104042414. Ignore if you have already paid. Thank you.`;
    },
  },
  {
    id: 'equity-247247-072130',
    name: 'Equity Bank Paybill 247247 (A/C 072130#Hse No.)',
    category: 'Equity Paybill',
    paybillOrBank: 'Equity Paybill 247247',
    accountDetails: 'A/C No. 072130#Hse No.',
    description: 'Equity Paybill 247247, A/C 072130#Hse No., Forward to David 0746112221',
    buildMessage: ({ month, houseNo }) => {
      const hseText = houseNo ? houseNo : 'Hse No.';
      return `Dear Esteemed Tenant, your ${month} rent is due. Please pay by today to avoid distress action. Pay via Equity Bank Paybill 247247, A/C No. 072130#${hseText} (ANNE WAMBUI). Forward the payment SMS to David\n0746112221. Cash to staff is not accepted or acknowledged. Ignore if you have already paid. Thank you.`;
    },
  },
  {
    id: 'caritas-899790',
    name: 'Caritas Bank Paybill 899790 (A/C 1004007002127)',
    category: 'Bank Paybill',
    paybillOrBank: 'Paybill 899790',
    accountDetails: 'A/C No. 1004007002127 (Caritas Bank)',
    description: 'Caritas Bank Paybill 899790, A/C 1004007002127, Forward to David 0721 813 403',
    buildMessage: ({ month }) =>
      `Dear Esteemed Tenant, your ${month} rent is due. Please pay by today to avoid distress action. Pay via Paybill 899790, A/C No. 1004007002127 (Caritas Bank). Forward the payment SMS to David 0721 813 403. Cash to staff is not accepted or acknowledged. Ignore if you have already paid. Thank you.`,
  },
  {
    id: 'paybill-4026352',
    name: 'Paybill 4026352 (A/C Plot Name & House No.)',
    category: 'Company Paybill',
    paybillOrBank: 'Paybill 4026352',
    accountDetails: 'Paybill 4026352 - A/C: Plot Name & House No.',
    description: 'Paybill 4026352, A/C: Plot Name & House No., Name: LOBBY ENTERPRISES LTD',
    buildMessage: ({ month, houseNo, plotName }) => {
      let plotAndHse = 'Plot Name & House No.';
      if (plotName && houseNo) {
        plotAndHse = `${plotName} & ${houseNo}`;
      } else if (houseNo) {
        plotAndHse = `House ${houseNo}`;
      } else if (plotName) {
        plotAndHse = plotName;
      }
      return `Dear Tenant, your ${month} rent is due. Please pay by today to avoid distress action. Pay via Paybill 4026352, A/C: ${plotAndHse}, A/C Name: LOBBY ENTERPRISES LTD. Cash payments to staff are not accepted. Ignore if you have already paid. Thank you.`;
    },
  },
];

const TEMPLATE_ID_ALIASES: Record<string, string> = {
  'lucy-equity-247247': 'equity-247247-063018',
  'esther-mpesa': 'mpesa-direct-0721813',
  'sarah-equity-247247': 'equity-247247-057017',
  'joseph-ncba-880100': 'mpesa-880100-ncba',
  'anne-equity-247247': 'equity-247247-072130',
  'lobby-4026352': 'paybill-4026352',
};

export function getInvoiceTemplate(id?: string): InvoiceTemplate {
  if (!id) return INVOICE_TEMPLATES[0];
  const resolvedId = TEMPLATE_ID_ALIASES[id] || id;
  return INVOICE_TEMPLATES.find((t) => t.id === resolvedId) || INVOICE_TEMPLATES[0];
}
