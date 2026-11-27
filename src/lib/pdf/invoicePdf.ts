// The invoice PDF (CLAUDE.md section 10), built from the invoice's snapshots so an old
// invoice always looks exactly as it did when it was issued. Never "Tax Invoice" or VAT.

import type { jsPDF } from 'jspdf';
import type { InvoiceWithDetails } from '../types';
import { formatDate } from '../dates';
import { sumCents } from '../invoiceMath';
import { buildDocumentPdf, customerLines, GREEN, RED, type DocSpec } from './documentPdf';

export { bankLines, customerLines, sellerLines } from './documentPdf';

export interface InvoicePdfInput {
  invoice: InvoiceWithDetails;
  /** The quote number this invoice comes from, if any (shown on the PDF). */
  quoteNumber?: string | null;
  /** PNG data URL of the logo. Optional so the PDF can be built in tests. */
  logoDataUrl?: string;
  /** Compress the PDF streams (default true). Tests turn it off to read the text. */
  compress?: boolean;
}

export interface PdfTotals {
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  /** Fully paid: the date of the last payment. */
  paidOn: string | null;
}

export function invoiceTotals(invoice: InvoiceWithDetails): PdfTotals {
  const paidCents = sumCents(invoice.payments.map((p) => Number(p.amount_cents)));
  const totalCents = Number(invoice.total_cents);
  const balanceCents = totalCents - paidCents;
  const fullyPaid = invoice.status === 'issued' && invoice.payments.length > 0 && balanceCents <= 0;
  const lastPayment = [...invoice.payments].sort((a, b) => a.paid_on.localeCompare(b.paid_on)).at(-1);
  return { totalCents, paidCents, balanceCents, paidOn: fullyPaid && lastPayment ? lastPayment.paid_on : null };
}

const KIND_SUBTITLE: Record<string, string> = { deposit: 'Deposit invoice', balance: 'Balance invoice' };

export function buildInvoicePdf({ invoice, quoteNumber: quoteNumberIn, logoDataUrl, compress = true }: InvoicePdfInput): jsPDF {
  let quoteNumber = quoteNumberIn;
  if (invoice.status === 'draft' || !invoice.number || !invoice.issue_date) {
    throw new Error('Only issued or void invoices have a PDF');
  }
  const seller = invoice.seller_snapshot;
  const customer = invoice.customer_snapshot;
  if (!seller || !customer) throw new Error('This invoice is missing its issued details');
  const totals = invoiceTotals(invoice);
  const isVoid = invoice.status === 'void';
  quoteNumber = quoteNumber ?? invoice.quote?.number ?? null;

  const meta: [string, string][] = [
    ['Invoice no.', invoice.number],
    ['Date', formatDate(invoice.issue_date)],
  ];
  if (invoice.due_date) meta.push(['Due', formatDate(invoice.due_date)]);
  if (quoteNumber) meta.push(['Quote', quoteNumber]);

  const kindText = invoice.kind && invoice.kind !== 'standard' ? KIND_SUBTITLE[invoice.kind] : null;
  const spec: DocSpec = {
    title: 'INVOICE',
    pdfTitle: `Invoice ${invoice.number}`,
    meta,
    seller,
    partyTitle: 'Bill to',
    partyLines: customerLines(customer),
    subtitle: kindText && quoteNumber ? `${kindText} for quote ${quoteNumber}` : kindText,
    lines: [...invoice.invoice_lines]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({ date: l.service_date, description: l.description, quantity: Number(l.quantity), unitCents: Number(l.unit_price_cents), amountCents: Number(l.amount_cents) })),
    totals: [
      { label: 'Total', cents: totals.totalCents },
      { label: 'Paid', cents: totals.paidCents },
      { label: 'Balance due', cents: isVoid ? 0 : Math.max(totals.balanceCents, 0), bold: true },
    ],
    stamp: totals.paidOn ? { text: 'PAID', date: totals.paidOn, color: GREEN } : null,
    notice: isVoid
      ? {
          title: `VOID: ${invoice.void_reason ?? ''}${invoice.voided_at ? ` (voided ${formatDate(invoice.voided_at.slice(0, 10))})` : ''}`,
          sub: 'This invoice was cancelled. Nothing is owed on it.',
          color: RED,
        }
      : null,
    payment: isVoid ? null : { reference: invoice.number },
    notes: invoice.notes,
    watermark: isVoid ? { text: 'VOID', color: RED } : null,
    logoDataUrl,
    compress,
  };
  return buildDocumentPdf(spec);
}

/** The PDF as a File, ready to share or download. */
export function invoicePdfFile(input: InvoicePdfInput, fileName: string): File {
  const blob = buildInvoicePdf(input).output('blob');
  return new File([blob], fileName, { type: 'application/pdf' });
}
