// Turning an accepted quote into invoices: the deposit, the balance, or the full amount.
// Each becomes a normal draft invoice (gap-free number when issued) linked to the quote.

import { formatQuantity } from './invoiceMath';
import type { DraftLineInput } from './api';

export type QuoteInvoiceMode = 'deposit' | 'balance' | 'full';

export interface QuoteForInvoicing {
  number: string;
  title: string | null;
  total_cents: number;
  deposit_percent: number;
  lines: { description: string; quantity: number; unit_price_cents: number }[];
}

/** 50 -> "50%", 33.33 -> "33.33%", 12.5 -> "12.5%" */
export function formatPercent(p: number): string {
  return `${formatQuantity(Number(p))}%`;
}

/** Deposit in cents: total × percent, rounded half-up to the cent. */
export function depositCents(totalCents: number, percent: number): number {
  return Math.round((Number(totalCents) * Math.round(Number(percent) * 100)) / 10000);
}

function about(q: QuoteForInvoicing): string {
  return q.title ? `${q.number}: ${q.title}` : q.number;
}

/**
 * The lines for a new invoice from a quote.
 * @param invoicedCents what has already been invoiced from this quote (issued invoices)
 */
export function quoteInvoiceLines(q: QuoteForInvoicing, mode: QuoteInvoiceMode, invoicedCents: number): DraftLineInput[] {
  const total = Number(q.total_cents);
  if (mode === 'full') {
    if (invoicedCents > 0) throw new Error('Part of this quote has already been invoiced. Invoice the balance instead.');
    return q.lines.map((l) => ({ description: l.description, service_date: null, quantity: Number(l.quantity), unit_price_cents: Number(l.unit_price_cents) }));
  }
  if (mode === 'deposit') {
    if (invoicedCents > 0) throw new Error('A deposit or part of this quote has already been invoiced.');
    const amount = depositCents(total, q.deposit_percent);
    if (amount <= 0) throw new Error('This quote has no amount to invoice.');
    return [{ description: `Deposit (${formatPercent(q.deposit_percent)}) for quote ${about(q)}`, service_date: null, quantity: 1, unit_price_cents: amount }];
  }
  const balance = total - invoicedCents;
  if (balance <= 0) throw new Error('This quote has been fully invoiced.');
  return [{ description: `Balance for quote ${about(q)}`, service_date: null, quantity: 1, unit_price_cents: balance }];
}

/** What can be invoiced next, for the buttons on the quote screen. */
export function nextInvoiceOptions(q: QuoteForInvoicing, invoicedCents: number): { mode: QuoteInvoiceMode; amountCents: number }[] {
  const total = Number(q.total_cents);
  if (total <= 0) return [];
  if (invoicedCents <= 0) {
    return [
      { mode: 'deposit', amountCents: depositCents(total, q.deposit_percent) },
      { mode: 'full', amountCents: total },
    ];
  }
  const balance = total - invoicedCents;
  return balance > 0 ? [{ mode: 'balance', amountCents: balance }] : [];
}
