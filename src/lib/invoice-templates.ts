export interface InvoiceTemplate {
  id: string;
  name: string;
  category: string;
  paybillOrBank: string;
  accountDetails: string;
  description: string;
  buildMessage: (params: { month: string; houseNo?: string; plotName?: string }) => string;
}

export function getCurrentInvoiceMonth(): string {
  return new Date().toLocaleString('en-US', { month: 'long' }).toUpperCase();
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
    name: 'SIDIAN Bank (Paybill 111999)',
    category: 'Bank Paybill',
    paybillOrBank: 'Paybill 111999',
    accountDetails: 'A/C No. 01001710003718 (SIDIAN Bank)',
    description: 'SIDIAN Bank Paybill 111999, A/C 01001710003718',
    buildMessage: ({ month }) =>
      `Dear Esteemed Tenant, your ${month} rent is due. Please pay by today. Pay via Paybill 111999, A/C No. 01001710003718 (SIDIAN Bank). Cash payments to staff are not accepted. Ignore if you have already paid. Thank you.`,
  },
  {
    id: 'lucy-equity-247247',
    name: 'LUCY WANGARI / Equity Bank (Paybill 247247)',
    category: 'Equity Paybill',
    paybillOrBank: 'Equity Paybill 247247',
    accountDetails: 'A/C 0630184433574 (LUCY WANGARI)',
    description: 'Equity Paybill 247247, A/C 0630184433574, Forward to Max 0713251597',
    buildMessage: ({ month }) =>
      `Dear Tenant, your ${month} rent is due. Please pay by today to avoid distress action. Pay via Equity Bank Paybill 247247, A/C 0630184433574 (LUCY WANGARI). Forward the payment SMS to Max\n0713251597. Cash payments to staff are not accepted. Ignore if you have already paid. Thank you.`,
  },
  {
    id: 'absa-303030',
    name: 'ABSA Bank (Paybill 303030)',
    category: 'Bank Paybill',
    paybillOrBank: 'Paybill 303030',
    accountDetails: 'A/C No. 2049844029 (ABSA Bank)',
    description: 'ABSA Bank Paybill 303030, A/C 2049844029, Forward to David 0746112221',
    buildMessage: ({ month }) =>
      `Dear Esteemed Tenant, your ${month} rent is due. Please pay by today to avoid distress action. Pay via Paybill 303030, A/C No. 2049844029 (ABSA Bank). Forward the payment SMS to David 0746112221 Cash to staff is not accepted or acknowledged. Ignore if you have already paid. Thank you`,
  },
  {
    id: 'esther-mpesa',
    name: 'ESTHER KARIUKI (M-Pesa 0721 813 403)',
    category: 'M-Pesa Direct',
    paybillOrBank: 'M-Pesa 0721 813 403',
    accountDetails: 'ESTHER KARIUKI',
    description: 'M-Pesa 0721 813 403 (ESTHER KARIUKI), Forward to Yegon 0736 721 662',
    buildMessage: ({ month }) =>
      `Dear Esteemed Tenant, your ${month} rent is due. Please pay by today to avoid distress action. Pay via M-Pesa 0721 813 403 (ESTHER KARIUKI). Forward the payment SMS to Yegon 0736 721 662. Cash to staff is not accepted or acknowledged. Ignore if you have already paid. Thank you.`,
  },
  {
    id: 'sarah-equity-247247',
    name: 'Sarah Njoki / Equity Bank (Paybill 247247)',
    category: 'Equity Paybill',
    paybillOrBank: 'Equity Paybill 247247',
    accountDetails: 'A/C No. 0570177473159 (Sarah Njoki)',
    description: 'Equity Paybill 247247, A/C 0570177473159, Forward to David 0746112221',
    buildMessage: ({ month }) =>
      `Dear Esteemed Tenant, your ${month} rent is due. Please pay by today to avoid distress action. Pay via Equity Bank Paybill 247247, A/C No. 0570177473159, A/C Name: Sarah Njoki. Forward the payment SMS to David\n0746112221. Cash to staff is not accepted or acknowledged. Ignore if you have already paid. Thank you.`,
  },
  {
    id: 'joseph-ncba-880100',
    name: 'Joseph Mwangi Githinji (Paybill 880100 / NCBA)',
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
    id: 'anne-equity-247247',
    name: 'ANNE WAMBUI / Equity Bank (Paybill 247247)',
    category: 'Equity Paybill',
    paybillOrBank: 'Equity Paybill 247247',
    accountDetails: 'A/C No. 072130#Hse No. (ANNE WAMBUI)',
    description: 'Equity Paybill 247247, A/C 072130#Hse No., Forward to David 0746112221',
    buildMessage: ({ month, houseNo }) => {
      const hseText = houseNo ? houseNo : 'Hse No.';
      return `Dear Esteemed Tenant, your ${month} rent is due. Please pay by today to avoid distress action. Pay via Equity Bank Paybill 247247, A/C No. 072130#${hseText} (ANNE WAMBUI). Forward the payment SMS to David\n0746112221. Cash to staff is not accepted or acknowledged. Ignore if you have already paid. Thank you.`;
    },
  },
  {
    id: 'caritas-899790',
    name: 'Caritas Bank (Paybill 899790)',
    category: 'Bank Paybill',
    paybillOrBank: 'Paybill 899790',
    accountDetails: 'A/C No. 1004007002127 (Caritas Bank)',
    description: 'Caritas Bank Paybill 899790, A/C 1004007002127, Forward to David 0721 813 403',
    buildMessage: ({ month }) =>
      `Dear Esteemed Tenant, your ${month} rent is due. Please pay by today to avoid distress action. Pay via Paybill 899790, A/C No. 1004007002127 (Caritas Bank). Forward the payment SMS to David 0721 813 403. Cash to staff is not accepted or acknowledged. Ignore if you have already paid. Thank you.`,
  },
  {
    id: 'lobby-4026352',
    name: 'LOBBY ENTERPRISES LTD (Paybill 4026352)',
    category: 'Company Paybill',
    paybillOrBank: 'Paybill 4026352',
    accountDetails: 'A/C: Plot Name & House No. (LOBBY ENTERPRISES LTD)',
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

export function getInvoiceTemplate(id?: string): InvoiceTemplate {
  return INVOICE_TEMPLATES.find((t) => t.id === id) || INVOICE_TEMPLATES[0];
}
