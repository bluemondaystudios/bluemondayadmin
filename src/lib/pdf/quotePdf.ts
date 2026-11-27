// The quote PDF: same layout as invoices, titled QUOTE, with validity, the deposit and terms.

import type { jsPDF } from 'jspdf';
import type { QuoteWithDetails } from '../types';
import { formatDate } from '../dates';
import { depositCents, formatPercent } from '../quoteMath';
import { buildDocumentPdf, customerLines, GREEN, GREY, money } from './documentPdf';

export interface QuotePdfInput {
  quote: QuoteWithDetails;
  logoDataUrl?: string;
  compress?: boolean;
}

export function buildQuotePdf({ quote, logoDataUrl, compress = true }: QuotePdfInput): jsPDF {
  if (quote.status === 'draft' || !quote.issue_date || !quote.customer_snapshot || !quote.seller_snapshot) {
    throw new Error('Send the quote first: drafts have no PDF');
  }
  const total = Number(quote.total_cents);
  const deposit = depositCents(total, quote.deposit_percent);
  const meta: [string, string][] = [
    ['Quote no.', quote.number],
    ['Date', formatDate(quote.issue_date)],
  ];
  if (quote.valid_until) meta.push(['Valid until', formatDate(quote.valid_until)]);

  const terms: string[] = [`A ${formatPercent(quote.deposit_percent)} deposit of ${money(deposit)} is due before work starts.`];
  if (quote.terms?.trim()) terms.push(quote.terms.trim());
  terms.push(`To accept, reply to this message or call ${quote.seller_snapshot.phone}. We'll send an invoice for the deposit.`);

  return buildDocumentPdf({
    title: 'QUOTE',
    pdfTitle: `Quote ${quote.number}`,
    meta,
    seller: quote.seller_snapshot,
    partyTitle: 'Quote for',
    partyLines: customerLines(quote.customer_snapshot),
    subtitle: quote.title,
    lines: [...quote.quote_lines]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({ description: l.description, quantity: Number(l.quantity), unitCents: Number(l.unit_price_cents), amountCents: Number(l.amount_cents) })),
    totals: [
      { label: 'Total', cents: total, bold: true },
      { label: `Deposit (${formatPercent(quote.deposit_percent)})`, cents: deposit },
    ],
    stamp: quote.status === 'accepted' ? { text: 'ACCEPTED', date: quote.decided_at?.slice(0, 10) ?? null, color: GREEN } : null,
    watermark: quote.status === 'declined' ? { text: 'DECLINED', color: GREY } : null,
    boxes: [{ title: 'Payment terms', lines: terms }],
    notes: quote.notes,
    logoDataUrl,
    compress,
  });
}

export function quotePdfFile(input: QuotePdfInput, fileName: string): File {
  return new File([buildQuotePdf(input).output('blob')], fileName, { type: 'application/pdf' });
}
