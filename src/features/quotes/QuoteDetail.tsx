import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import bmLogo from '../../assets/bm-logo.png?inline';
import { useDuplicateQuote, useInvoiceFromQuote, useQuote, useSetQuoteStatus } from '../../lib/quotesApi';
import { friendlyError } from '../../lib/supabase';
import { formatZAR } from '../../lib/money';
import { formatDate, todayISO } from '../../lib/dates';
import { formatQuantity } from '../../lib/invoiceMath';
import { depositCents, formatPercent, nextInvoiceOptions, type QuoteInvoiceMode } from '../../lib/quoteMath';
import { quotePdfFile } from '../../lib/pdf/quotePdf';
import { invoiceFileName, quoteShareText, whatsAppLink } from '../../lib/share';
import { downloadFile, shareOrDownload } from '../../lib/sharePdf';
import { useOnline } from '../../lib/useOnline';
import type { QuoteWithDetails } from '../../lib/types';
import { PageHeader } from '../../ui/PageHeader';
import { ActionBar } from '../../ui/ActionBar';
import { Sheet } from '../../ui/Sheet';
import { Icon } from '../../ui/Icon';
import { QuotePill } from '../../ui/QuotePill';
import { quoteDisplayStatus } from './quoteStatus';

const KIND_LABEL: Record<string, string> = { deposit: 'Deposit', balance: 'Balance', standard: 'Full amount' };
const MODE_LABEL: Record<QuoteInvoiceMode, string> = { deposit: 'Invoice the deposit', balance: 'Invoice the balance', full: 'Invoice the full amount' };

export default function QuoteDetail() {
  const { id } = useParams();
  const q = useQuote(id);
  if (q.isError) return <p className="alert alert-error">Couldn't load this quote. {friendlyError(q.error)}</p>;
  if (!q.data) return <div className="page" aria-busy="true" />;
  if (q.data.status === 'draft') return <Navigate to={`/quotes/${q.data.id}/edit`} replace />;
  return <Detail quote={q.data} />;
}

function Detail({ quote }: { quote: QuoteWithDetails }) {
  const navigate = useNavigate();
  const location = useLocation();
  const online = useOnline();
  const setStatus = useSetQuoteStatus();
  const duplicate = useDuplicateQuote();
  const toInvoice = useInvoiceFromQuote();
  const [fallback, setFallback] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const justSent = (location.state as { justSent?: boolean } | null)?.justSent === true;

  const total = Number(quote.total_cents);
  const issued = quote.invoices.filter((i) => i.status === 'issued');
  const drafts = quote.invoices.filter((i) => i.status === 'draft');
  const invoicedCents = issued.reduce((s, i) => s + Number(i.total_cents), 0);
  const isExpired = quote.status === 'sent' && !!quote.valid_until && quote.valid_until < todayISO();
  const display = quoteDisplayStatus({ status: quote.status, is_expired: isExpired, left_to_invoice_cents: total - invoicedCents, total_cents: total });
  const customer = quote.customer_snapshot;
  const options = nextInvoiceOptions({ number: quote.number, title: quote.title, total_cents: total, deposit_percent: Number(quote.deposit_percent), lines: quote.quote_lines }, invoicedCents);
  const shareText = quoteShareText({ customerName: customer?.name ?? '', contactPerson: customer?.contact_person, number: quote.number, amountCents: total, validUntil: quote.valid_until });
  const busy = setStatus.isPending || duplicate.isPending || toInvoice.isPending;
  const error = setStatus.error ?? duplicate.error ?? toInvoice.error;

  const makeFile = () => quotePdfFile({ quote, logoDataUrl: bmLogo }, invoiceFileName(quote.number));
  const onShare = async () => {
    setPdfError(null);
    try {
      if ((await shareOrDownload(makeFile(), `Quote ${quote.number}`, shareText)) === 'downloaded') setFallback(true);
    } catch (err) {
      setPdfError(`Couldn't create the PDF. ${friendlyError(err)}`);
    }
  };

  async function makeInvoice(mode: QuoteInvoiceMode) {
    try {
      const id = await toInvoice.mutateAsync({ quote, mode, invoicedCents });
      navigate(`/invoices/${id}/edit`);
    } catch {
      // shown below
    }
  }

  return (
    <div className="page has-action-bar">
      <PageHeader title={quote.number} back="/quotes" sub={[customer?.name, quote.title].filter(Boolean).join(' · ')}>
        <QuotePill status={display} />
      </PageHeader>

      {justSent ? (
        <p className="alert alert-info" role="status">
          {quote.number} is ready. Tap <strong>Share</strong> to send it to {customer?.name ?? 'the client'}.
        </p>
      ) : null}

      <dl className="summary card">
        <div>
          <dt>Date</dt>
          <dd>{quote.issue_date ? formatDate(quote.issue_date) : '—'}</dd>
        </div>
        <div>
          <dt>Valid until</dt>
          <dd className={isExpired ? 'text-red' : undefined}>{quote.valid_until ? formatDate(quote.valid_until) : '—'}</dd>
        </div>
        <div>
          <dt>Deposit ({formatPercent(Number(quote.deposit_percent))})</dt>
          <dd className="amount">{formatZAR(depositCents(total, Number(quote.deposit_percent)))}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{quote.decided_at ? `${display === 'declined' ? 'Declined' : 'Accepted'} ${formatDate(quote.decided_at.slice(0, 10))}` : isExpired ? 'Expired, no reply' : 'Waiting for reply'}</dd>
        </div>
        <div className="summary-balance">
          <dt>Total</dt>
          <dd className="amount">{formatZAR(total)}</dd>
        </div>
      </dl>

      {quote.status === 'sent' ? (
        <section className="section card decide-card">
          <h2>Did {customer?.name ?? 'the client'} reply?</h2>
          {isExpired ? <p className="muted small">This quote has expired, but you can still record their answer.</p> : null}
          <div className="sheet-actions">
            <button type="button" className="btn btn-secondary" disabled={!online || busy} onClick={() => setStatus.mutate({ id: quote.id, status: 'declined' })}>
              Declined
            </button>
            <button type="button" className="btn btn-success grow" disabled={!online || busy} onClick={() => setStatus.mutate({ id: quote.id, status: 'accepted' })}>
              <Icon name="check" size={20} /> Accepted
            </button>
          </div>
        </section>
      ) : null}

      {quote.status === 'accepted' ? (
        <section className="section card decide-card">
          <h2>Invoicing</h2>
          <div className="progress-figures">
            <span>
              <span className="muted small block">Invoiced</span>
              <strong className="amount">{formatZAR(invoicedCents)}</strong>
            </span>
            <span>
              <span className="muted small block">Left to invoice</span>
              <strong className="amount">{formatZAR(Math.max(total - invoicedCents, 0))}</strong>
            </span>
          </div>
          {drafts.length > 0 ? (
            <p className="alert alert-warn">
              There's a draft invoice for this quote. Issue or delete it before making another.{' '}
              <Link to={`/invoices/${drafts[0]!.id}/edit`}>Open the draft</Link>
            </p>
          ) : options.length > 0 ? (
            <div className="stack">
              {options.map((o, i) => (
                <button key={o.mode} type="button" className={`btn btn-block ${i === 0 ? 'btn-primary' : 'btn-secondary'}`} disabled={!online || busy} onClick={() => void makeInvoice(o.mode)}>
                  {MODE_LABEL[o.mode]} · {formatZAR(o.amountCents)}
                </button>
              ))}
              <p className="muted small">This makes a draft invoice you can check before issuing it.</p>
            </div>
          ) : (
            <p className="muted">Fully invoiced.</p>
          )}
          {quote.invoices.length > 0 ? (
            <ul className="list sheet-list">
              {quote.invoices.map((inv) => (
                <li key={inv.id}>
                  <Link to={inv.status === 'draft' ? `/invoices/${inv.id}/edit` : `/invoices/${inv.id}`} className="list-row">
                    <span className="list-main">
                      <strong className={inv.status === 'void' ? 'struck' : undefined}>{inv.number ?? 'Draft'}</strong>
                      <span className="muted small">
                        {KIND_LABEL[inv.kind] ?? inv.kind}
                        {inv.status === 'void' ? ' · void' : inv.issue_date ? ` · ${formatDate(inv.issue_date)}` : ' · not issued yet'}
                      </span>
                    </span>
                    <span className="amount">{formatZAR(Number(inv.total_cents))}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {quote.status === 'declined' ? (
        <p className="alert alert-info">
          Declined. If they change their mind,{' '}
          <button type="button" className="btn-inline" disabled={!online || busy} onClick={() => setStatus.mutate({ id: quote.id, status: 'accepted' })}>
            mark it accepted
          </button>
          .
        </p>
      ) : null}

      {error ? <p className="alert alert-error">{friendlyError(error)}</p> : null}

      <section className="section">
        <h2>Lines</h2>
        <ul className="list card">
          {quote.quote_lines.map((l) => (
            <li key={l.id} className="list-row static">
              <span className="list-main">
                <strong className="wrap">{l.description}</strong>
                <span className="muted small">
                  {formatQuantity(Number(l.quantity))} × {formatZAR(Number(l.unit_price_cents))}
                </span>
              </span>
              <span className="amount">{formatZAR(Number(l.amount_cents))}</span>
            </li>
          ))}
        </ul>
        {quote.terms ? <p className="muted small pre">Terms: {quote.terms}</p> : null}
        {quote.notes ? <p className="muted pre">{quote.notes}</p> : null}
      </section>

      <section className="section">
        <h2>More</h2>
        <ul className="list card">
          <li>
            <button
              type="button"
              className="list-row"
              onClick={() => {
                try {
                  downloadFile(makeFile());
                } catch (err) {
                  setPdfError(`Couldn't create the PDF. ${friendlyError(err)}`);
                }
              }}
            >
              <span className="list-icon">
                <Icon name="download" />
              </span>
              <span className="list-main">
                <strong>Download PDF</strong>
              </span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className="list-row"
              disabled={!online || busy}
              onClick={async () => {
                try {
                  const newId = await duplicate.mutateAsync(quote);
                  navigate(`/quotes/${newId}/edit`);
                } catch {
                  // shown above
                }
              }}
            >
              <span className="list-icon">
                <Icon name="quote" />
              </span>
              <span className="list-main">
                <strong>{duplicate.isPending ? 'Copying…' : 'Duplicate as new draft'}</strong>
                <span className="muted small">To revise a sent quote, or quote a similar job</span>
              </span>
            </button>
          </li>
        </ul>
      </section>

      {pdfError ? <p className="alert alert-error">{pdfError}</p> : null}

      <ActionBar>
        <button type="button" className="btn btn-primary grow" onClick={() => void onShare()}>
          Share
        </button>
      </ActionBar>

      <Sheet open={fallback} onClose={() => setFallback(false)} title="PDF downloaded">
        <p>This browser can't attach files to WhatsApp directly. The PDF is in your downloads: attach it to the message.</p>
        <a className="btn btn-primary btn-block" href={whatsAppLink(customer?.phone, shareText)} target="_blank" rel="noreferrer">
          Open WhatsApp
        </a>
        <button
          type="button"
          className="btn btn-secondary btn-block"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(shareText);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? 'Copied' : 'Copy message'}
        </button>
        <p className="muted small">{shareText}</p>
      </Sheet>
    </div>
  );
}
