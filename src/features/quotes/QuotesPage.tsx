import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuoteList } from '../../lib/quotesApi';
import { friendlyError } from '../../lib/supabase';
import { PageHeader } from '../../ui/PageHeader';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { QuoteRow } from './QuoteRow';
import { QUOTE_FILTERS, isQuoteFilter, matchesQuoteFilter, matchesQuoteSearch, type QuoteFilter } from './quoteStatus';

export function QuotesPage() {
  const q = useQuoteList();
  const [params, setParams] = useSearchParams();
  const fp = params.get('filter');
  const filter: QuoteFilter = isQuoteFilter(fp) ? fp : 'all';
  const [search, setSearch] = useState('');
  const rows = useMemo(() => (q.data ?? []).filter((r) => matchesQuoteFilter(r, filter) && matchesQuoteSearch(r, search)), [q.data, filter, search]);
  const counts = useMemo(() => Object.fromEntries(QUOTE_FILTERS.map((f) => [f.id, (q.data ?? []).filter((r) => matchesQuoteFilter(r, f.id)).length])), [q.data]);

  return (
    <div className="page">
      <PageHeader title="Quotes">
        <Link to="/quotes/new" className="btn btn-primary btn-sm">
          <Icon name="plus" size={20} /> New
        </Link>
      </PageHeader>

      <div className="chips" role="tablist" aria-label="Filter quotes">
        {QUOTE_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className={`chip${filter === f.id ? ' is-active' : ''}`}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (f.id === 'all') next.delete('filter');
              else next.set('filter', f.id);
              setParams(next, { replace: true });
            }}
          >
            {f.label}
            {q.data && f.id !== 'all' && counts[f.id] ? <span className="chip-count">{counts[f.id]}</span> : null}
          </button>
        ))}
      </div>

      {(q.data?.length ?? 0) > 0 ? (
        <input className="input search" type="search" placeholder="Search number, client or project" aria-label="Search quotes" value={search} onChange={(e) => setSearch(e.target.value)} />
      ) : null}

      {q.isError ? <p className="alert alert-error">Couldn't load quotes. {friendlyError(q.error)}</p> : null}

      {q.data && q.data.length === 0 ? (
        <EmptyState icon="quote" title="No quotes yet">
          <p>Quote a client, send it as a PDF on WhatsApp, and turn it into a deposit invoice when they say yes.</p>
          <Link to="/quotes/new" className="btn btn-primary">
            New quote
          </Link>
        </EmptyState>
      ) : rows.length > 0 ? (
        <ul className="list card">
          {rows.map((r) => (
            <QuoteRow key={r.id} q={r} />
          ))}
        </ul>
      ) : q.data ? (
        <p className="muted center">{search ? `No quotes match “${search}”.` : 'No quotes here.'}</p>
      ) : null}
    </div>
  );
}
