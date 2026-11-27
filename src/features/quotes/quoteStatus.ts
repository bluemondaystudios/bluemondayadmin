import type { QuoteProgress, QuoteStatus } from '../../lib/types';

export type QuoteDisplay = 'draft' | 'sent' | 'expired' | 'accepted' | 'invoiced' | 'declined';

/** What a quote's pill says. Accepted quotes become "Invoiced" once fully invoiced. */
export function quoteDisplayStatus(q: Pick<QuoteProgress, 'status' | 'is_expired' | 'left_to_invoice_cents' | 'total_cents'>): QuoteDisplay {
  if (q.status === 'sent') return q.is_expired ? 'expired' : 'sent';
  if (q.status === 'accepted') return Number(q.total_cents) > 0 && Number(q.left_to_invoice_cents) <= 0 ? 'invoiced' : 'accepted';
  return q.status as Exclude<QuoteStatus, 'sent' | 'accepted'>;
}

export const QUOTE_LABEL: Record<QuoteDisplay, string> = {
  draft: 'Draft',
  sent: 'Sent',
  expired: 'Expired',
  accepted: 'Accepted',
  invoiced: 'Invoiced',
  declined: 'Declined',
};

export const QUOTE_TONE: Record<QuoteDisplay, 'grey' | 'navy' | 'amber' | 'green' | 'red'> = {
  draft: 'grey',
  sent: 'navy',
  expired: 'amber',
  accepted: 'green',
  invoiced: 'green',
  declined: 'grey',
};

export const QUOTE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Waiting' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'closed', label: 'Declined' },
] as const;
export type QuoteFilter = (typeof QUOTE_FILTERS)[number]['id'];

export function isQuoteFilter(v: string | null): v is QuoteFilter {
  return QUOTE_FILTERS.some((f) => f.id === v);
}

/** "Waiting" = sent (expired included: a client may still say yes). "Accepted" includes fully invoiced. */
export function matchesQuoteFilter(q: QuoteProgress, f: QuoteFilter): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'open':
      return q.status === 'sent';
    case 'accepted':
      return q.status === 'accepted';
    case 'drafts':
      return q.status === 'draft';
    case 'closed':
      return q.status === 'declined';
  }
}

export function matchesQuoteSearch(q: QuoteProgress, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  if (q.customer_name.toLowerCase().includes(t) || (q.title ?? '').toLowerCase().includes(t) || q.number.toLowerCase().includes(t)) return true;
  const digits = t.replace(/\D/g, '');
  return digits !== '' && Number(q.number.replace(/\D/g, '')) === Number(digits);
}
