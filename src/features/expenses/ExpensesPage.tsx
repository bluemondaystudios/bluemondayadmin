import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useExpenseQueue, useExpenses, useReceiptUrls } from '../../lib/expensesApi';
import { friendlyError } from '../../lib/supabase';
import { formatZAR } from '../../lib/money';
import { formatMonth } from '../../lib/dates';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '../../lib/expenseCategories';
import { useOnline } from '../../lib/useOnline';
import { PageHeader } from '../../ui/PageHeader';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { groupByMonth } from './grouping';
import { ExpenseRow, type ExpenseListItem } from './ExpenseRow';

export function ExpensesPage() {
  const location = useLocation();
  const online = useOnline();
  const q = useExpenses();
  const queued = useExpenseQueue();
  const [category, setCategory] = useState('');
  const savedState = location.state as { saved?: string; offline?: boolean } | null;

  const paths = useMemo(() => (q.data ?? []).map((x) => x.receipt_path).filter((p): p is string => !!p), [q.data]);
  const urls = useReceiptUrls(paths);

  const all: ExpenseListItem[] = useMemo(() => {
    const serverIds = new Set((q.data ?? []).map((x) => x.id));
    const fromQueue = queued
      .filter((i) => !serverIds.has(i.row.id))
      .map((i) => ({
        id: i.row.id,
        spent_on: i.row.spent_on,
        amount_cents: i.row.amount_cents,
        category: i.row.category as ExpenseCategory,
        supplier: i.row.supplier,
        thumbUrl: null,
        hasReceipt: !!i.row.receipt_path,
        queued: { bytes: i.receipt, lastError: i.lastError },
      }));
    const fromServer = (q.data ?? []).map((x) => ({
      id: x.id,
      spent_on: x.spent_on,
      amount_cents: Number(x.amount_cents),
      category: x.category,
      supplier: x.supplier,
      thumbUrl: x.receipt_path ? (urls.data?.[x.receipt_path] ?? null) : null,
      hasReceipt: !!x.receipt_path,
    }));
    return [...fromQueue, ...fromServer];
  }, [q.data, queued, urls.data]);

  const filtered = all.filter((x) => !category || x.category === category);
  const groups = groupByMonth(filtered);

  return (
    <div className="page">
      <PageHeader title="Expenses" back="/more">
        <Link to="/expenses/new" className="btn btn-primary btn-sm">
          <Icon name="camera" size={20} /> Log
        </Link>
      </PageHeader>

      {savedState?.saved ? (
        <p className="alert alert-info" role="status">
          {savedState.offline ? "Expense saved on this phone. It will upload by itself when you're back online." : 'Expense saved.'}
        </p>
      ) : null}

      {queued.length > 0 ? (
        <p className="alert alert-warn">
          {queued.length === 1 ? '1 expense is' : `${queued.length} expenses are`} waiting to upload.
          {online
            ? ' Uploading now…'
            : ` ${queued.length === 1 ? 'It' : 'They'} will upload by ${queued.length === 1 ? 'itself' : 'themselves'} when you're back online. Don't clear this browser's data or uninstall the app until then.`}
        </p>
      ) : null}

      {all.length > 0 ? (
        <div className="filters">
          <select className="input" aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {q.isError ? (
        <p className="alert alert-error">
          {online ? `Couldn't load expenses. ${friendlyError(q.error)}` : "You're offline, so only expenses saved on this phone are shown."}
        </p>
      ) : null}

      {q.data && all.length === 0 ? (
        <EmptyState icon="receipt" title="No expenses yet">
          <p>Snap the slip each time you pay for fuel, tolls or repairs. Every expense lowers your tax.</p>
          <Link to="/expenses/new" className="btn btn-primary">
            Log expense
          </Link>
        </EmptyState>
      ) : null}

      {groups.map((g) => (
        <section key={g.month} className="section">
          <div className="section-head">
            <h2>{formatMonth(g.month)}</h2>
            <span className="amount">{formatZAR(g.totalCents)}</span>
          </div>
          <ul className="list card">
            {g.items.map((x) => (
              <ExpenseRow key={x.id} item={x} />
            ))}
          </ul>
        </section>
      ))}

      {all.length > 0 && filtered.length === 0 ? <p className="muted center">No expenses match these filters.</p> : null}
    </div>
  );
}
