import { QUOTE_LABEL, QUOTE_TONE, type QuoteDisplay } from '../features/quotes/quoteStatus';

export function QuotePill({ status }: { status: QuoteDisplay }) {
  return <span className={`pill pill-${QUOTE_TONE[status]}`}>{QUOTE_LABEL[status]}</span>;
}
