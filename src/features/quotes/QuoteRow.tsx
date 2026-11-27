import { Link } from 'react-router';
import type { QuoteProgress } from '../../lib/types';
import { formatZAR } from '../../lib/money';
import { formatDate } from '../../lib/dates';
import { QuotePill } from '../../ui/QuotePill';
import { quoteDisplayStatus } from './quoteStatus';

export function QuoteRow({ q, showCustomer = true }: { q: QuoteProgress; showCustomer?: boolean }) {
  const status = quoteDisplayStatus(q);
  const sub = [showCustomer ? q.customer_name : null, q.title, q.issue_date ? formatDate(q.issue_date) : 'Not sent yet'].filter(Boolean).join(' · ');
  return (
    <li>
      <Link to={q.status === 'draft' ? `/quotes/${q.id}/edit` : `/quotes/${q.id}`} className="list-row">
        <span className="list-main">
          <strong>{q.number}</strong>
          <span className="muted small wrap">{sub}</span>
        </span>
        <span className="list-side">
          <span className="amount">{formatZAR(Number(q.total_cents))}</span>
          <QuotePill status={status} />
          {q.status === 'accepted' && Number(q.invoiced_cents) > 0 && Number(q.left_to_invoice_cents) > 0 ? (
            <span className="muted small">{formatZAR(Number(q.invoiced_cents))} invoiced</span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}
