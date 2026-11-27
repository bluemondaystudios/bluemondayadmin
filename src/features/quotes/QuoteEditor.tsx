import { useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCustomers, useSettings } from '../../lib/api';
import { useDeleteQuoteDraft, useQuote, useSaveQuoteDraft, useSendQuote, type QuoteDraftInput } from '../../lib/quotesApi';
import { friendlyError } from '../../lib/supabase';
import { formatZAR, parseZAR, centsToDecimal } from '../../lib/money';
import { addDays, formatDate, todayISO } from '../../lib/dates';
import { formatQuantity, lineAmountCents, parseQuantity } from '../../lib/invoiceMath';
import { depositCents, formatPercent } from '../../lib/quoteMath';
import { useOnline } from '../../lib/useOnline';
import type { Customer, QuoteWithDetails } from '../../lib/types';
import { PageHeader } from '../../ui/PageHeader';
import { ActionBar } from '../../ui/ActionBar';
import { Field } from '../../ui/Field';
import { MoneyInput } from '../../ui/MoneyInput';
import { Sheet } from '../../ui/Sheet';
import { Icon } from '../../ui/Icon';
import { CustomerPicker } from '../invoices/CustomerPicker';
import { LINE_PRESETS } from '../invoices/presets';

const lineSchema = z.object({
  description: z.string().trim().min(1, 'Describe the work').max(500),
  quantity: z.string().refine((v) => parseQuantity(v) !== null, 'Enter a quantity, e.g. 1 or 12'),
  unit_price: z.string().refine((v) => parseZAR(v) !== null, 'Enter a price, e.g. 8 000'),
});

const schema = z.object({
  customer_id: z.string().min(1, 'Choose who the quote is for'),
  title: z.string().max(200),
  notes: z.string().max(2000),
  terms: z.string().max(2000),
  deposit_percent: z.string().refine((v) => {
    const n = Number(v.replace(',', '.'));
    return /^\d{1,3}([.,]\d{1,2})?$/.test(v.trim()) && n > 0 && n <= 100;
  }, 'Enter a deposit between 1 and 100%'),
  lines: z.array(lineSchema).min(1, 'Add at least one line'),
});

type FormValues = z.infer<typeof schema>;
type LineValues = FormValues['lines'][number];

const blankLine = (): LineValues => ({ description: '', quantity: '1', unit_price: '' });

function toDraft(v: FormValues, id?: string): QuoteDraftInput {
  return {
    id,
    customer_id: v.customer_id,
    title: v.title.trim() || null,
    notes: v.notes.trim() || null,
    terms: v.terms.trim() || null,
    deposit_percent: Number(v.deposit_percent.replace(',', '.')),
    lines: v.lines.map((l) => ({ description: l.description.trim(), quantity: parseQuantity(l.quantity)!, unit_price_cents: parseZAR(l.unit_price)! })),
  };
}

function liveAmount(l: Partial<LineValues> | undefined): number {
  const q = parseQuantity(l?.quantity ?? '');
  const p = parseZAR(l?.unit_price ?? '');
  return q !== null && p !== null ? lineAmountCents(q, p) : 0;
}

/** Route wrapper: loads the draft (when editing) before showing the form. */
export function QuoteEditorPage() {
  const { id } = useParams();
  const q = useQuote(id);
  const settings = useSettings();
  if (id && q.isError) return <p className="alert alert-error">Couldn't load this quote. {friendlyError(q.error)}</p>;
  if ((id && !q.data) || !settings.data) return <div className="page" aria-busy="true" />;
  // Not a draft any more: normally because it was just sent from this screen
  if (q.data && q.data.status !== 'draft') return <Navigate to={`/quotes/${id}`} replace state={{ justSent: q.data.status === 'sent' }} />;
  return <QuoteEditor key={id ?? 'new'} draft={q.data} defaults={{ deposit: Number(settings.data.default_deposit_percent), terms: settings.data.quote_terms ?? '', validDays: settings.data.quote_valid_days }} />;
}

function QuoteEditor({ draft, defaults }: { draft?: QuoteWithDetails; defaults: { deposit: number; terms: string; validDays: number } }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const online = useOnline();
  const customers = useCustomers();
  const save = useSaveQuoteDraft();
  const send = useSendQuote();
  const del = useDeleteQuoteDraft();

  const [pickingCustomer, setPickingCustomer] = useState(false);
  const [presetFor, setPresetFor] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<FormValues | null>(null);
  const [justPicked, setJustPicked] = useState<Customer | null>(null);
  const justSaved = (location.state as { saved?: boolean } | null)?.saved === true;

  const { control, register, handleSubmit, setValue, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: draft
      ? {
          customer_id: draft.customer_id,
          title: draft.title ?? '',
          notes: draft.notes ?? '',
          terms: draft.terms ?? '',
          deposit_percent: formatQuantity(Number(draft.deposit_percent)),
          lines: draft.quote_lines.map((l) => ({ description: l.description, quantity: formatQuantity(Number(l.quantity)), unit_price: centsToDecimal(Number(l.unit_price_cents)) })),
        }
      : { customer_id: params.get('customer') ?? '', title: '', notes: '', terms: defaults.terms, deposit_percent: formatQuantity(defaults.deposit), lines: [blankLine()] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const watchedLines = useWatch({ control, name: 'lines' });
  const customerId = useWatch({ control, name: 'customer_id' });
  const depositText = useWatch({ control, name: 'deposit_percent' });
  const total = (watchedLines ?? []).reduce((s, l) => s + liveAmount(l), 0);
  const depositPct = Number((depositText ?? '').replace(',', '.'));
  const deposit = depositPct > 0 && depositPct <= 100 ? depositCents(total, depositPct) : 0;
  const e = formState.errors;

  const customer = useMemo(
    () => (justPicked?.id === customerId ? justPicked : customers.data?.find((c) => c.id === customerId)),
    [customers.data, customerId, justPicked],
  );
  const busy = save.isPending || send.isPending || del.isPending;
  const error = save.error ?? send.error ?? del.error;
  const number = draft?.number ?? 'this quote';

  const onSave = handleSubmit(async (values) => {
    const id = await save.mutateAsync(toDraft(values, draft?.id));
    navigate(`/quotes/${id}/edit`, { replace: true, state: { saved: true } });
  });

  const confirmSend = async () => {
    if (!confirming) return;
    const q = await send.mutateAsync(toDraft(confirming, draft?.id)).catch(() => null);
    setConfirming(null);
    if (q) navigate(`/quotes/${q.id}`, { replace: true, state: { justSent: true } });
  };

  return (
    // Not a <form>: the client sheet contains its own form, and forms can't be nested.
    <div className="page has-action-bar">
      <PageHeader title={draft ? `Edit ${draft.number}` : 'New quote'} back="/quotes" sub="Quotes can be changed until they're sent." />

      {justSaved && !formState.isDirty ? (
        <p className="alert alert-info" role="status">
          Draft saved.
        </p>
      ) : null}

      <section className="section">
        <h2>Client</h2>
        <button type="button" className={`picker card${e.customer_id ? ' has-error' : ''}`} onClick={() => setPickingCustomer(true)}>
          {customer ? (
            <span className="list-main">
              <strong>{customer.name}</strong>
              <span className="muted small">{[customer.contact_person, customer.phone].filter(Boolean).join(' · ') || 'Tap to change'}</span>
            </span>
          ) : (
            <span className="list-main">
              <strong>Choose client</strong>
              <span className="muted small">Or add a new one</span>
            </span>
          )}
          <Icon name="chevron" className="muted" />
        </button>
        {e.customer_id ? (
          <span className="error-text" role="alert">
            {e.customer_id.message}
          </span>
        ) : null}
      </section>

      <Field id="q-title" label="Project" optional hint="e.g. New website for Mokoena Attorneys. Shown at the top of the quote.">
        <input id="q-title" className="input" autoComplete="off" {...register('title')} />
      </Field>

      <section className="section">
        <h2>Lines</h2>
        {fields.map((f, i) => {
          const le = e.lines?.[i];
          return (
            <fieldset key={f.id} className="card line-card">
              <legend className="visually-hidden">Line {i + 1}</legend>
              <div className="line-head">
                <span className="muted small">Line {i + 1}</span>
                {fields.length > 1 ? (
                  <button type="button" className="btn btn-link btn-danger-text" onClick={() => remove(i)}>
                    Remove
                  </button>
                ) : null}
              </div>
              <Field id={`q${i}-desc`} label="Description" error={le?.description?.message}>
                <div className="input-with-btn">
                  <input id={`q${i}-desc`} className="input" autoComplete="off" placeholder="What will you deliver?" {...register(`lines.${i}.description`)} />
                  <button type="button" className="btn btn-secondary" onClick={() => setPresetFor(i)}>
                    Pick
                  </button>
                </div>
              </Field>
              <div className="row-2">
                <Field id={`q${i}-qty`} label="Quantity" error={le?.quantity?.message} hint="e.g. pages, hours, months">
                  <input id={`q${i}-qty`} className="input" inputMode="decimal" autoComplete="off" {...register(`lines.${i}.quantity`)} />
                </Field>
                <Field id={`q${i}-price`} label="Unit price" error={le?.unit_price?.message}>
                  <MoneyInput id={`q${i}-price`} {...register(`lines.${i}.unit_price`)} />
                </Field>
              </div>
              <div className="line-amount">
                <span className="muted">Amount</span>
                <strong className="amount">{formatZAR(liveAmount(watchedLines?.[i]))}</strong>
              </div>
            </fieldset>
          );
        })}
        {e.lines?.root?.message || e.lines?.message ? <span className="error-text">{e.lines?.root?.message ?? e.lines?.message}</span> : null}
        <button type="button" className="btn btn-secondary btn-block" onClick={() => append(blankLine(), { shouldFocus: false })}>
          <Icon name="plus" size={20} /> Add line
        </button>
      </section>

      <div className="total-row card">
        <span>Total</span>
        <strong className="amount">{formatZAR(total)}</strong>
      </div>

      <section className="section">
        <div className="row-2">
          <Field id="q-deposit" label="Deposit" error={e.deposit_percent?.message}>
            <div className="suffix-input">
              <input id="q-deposit" className="input" inputMode="decimal" autoComplete="off" {...register('deposit_percent')} />
              <span aria-hidden="true">%</span>
            </div>
          </Field>
          <div className="field">
            <span className="label">Deposit amount</span>
            <strong className="amount deposit-amount">{formatZAR(deposit)}</strong>
          </div>
        </div>
        <Field id="q-terms" label="Payment terms" optional hint="Printed on the quote">
          <textarea id="q-terms" className="input" rows={2} {...register('terms')} />
        </Field>
        <Field id="q-notes" label="Notes" optional hint="e.g. what's included, timelines">
          <textarea id="q-notes" className="input" rows={3} {...register('notes')} />
        </Field>
      </section>

      {error ? (
        <p className="alert alert-error" role="alert">
          {friendlyError(error)}
        </p>
      ) : null}

      {draft ? (
        <button
          type="button"
          className="btn btn-link btn-danger-text"
          disabled={!online || busy}
          onClick={async () => {
            if (!window.confirm(`Delete draft ${draft.number}? It hasn't been sent, so nothing is lost from your records.`)) return;
            try {
              await del.mutateAsync(draft.id);
              navigate('/quotes', { replace: true });
            } catch {
              // shown above
            }
          }}
        >
          Delete draft
        </button>
      ) : null}

      <ActionBar>
        <button type="button" className="btn btn-secondary" disabled={!online || busy} onClick={() => void onSave()}>
          {save.isPending ? 'Saving…' : 'Save draft'}
        </button>
        <button type="button" className="btn btn-primary grow" disabled={!online || busy} onClick={() => void handleSubmit((v) => setConfirming(v))()}>
          Send quote
        </button>
      </ActionBar>

      <CustomerPicker
        open={pickingCustomer}
        onClose={() => setPickingCustomer(false)}
        onPick={(c) => {
          setJustPicked(c);
          setValue('customer_id', c.id, { shouldDirty: true, shouldValidate: formState.isSubmitted });
        }}
      />

      <Sheet open={presetFor !== null} onClose={() => setPresetFor(null)} title="Choose a service">
        <ul className="list card sheet-list">
          {LINE_PRESETS.map((p) => (
            <li key={p}>
              <button
                type="button"
                className="list-row"
                onClick={() => {
                  if (presetFor !== null) setValue(`lines.${presetFor}.description`, p, { shouldDirty: true, shouldValidate: formState.isSubmitted });
                  setPresetFor(null);
                }}
              >
                {p}
              </button>
            </li>
          ))}
        </ul>
        <p className="muted small">You can edit the description after picking.</p>
      </Sheet>

      <Sheet open={confirming !== null} onClose={() => setConfirming(null)} title={`Send ${number}?`}>
        <p>After this the quote can't be edited. To change it later, duplicate it and send the new version.</p>
        <dl className="details">
          <div>
            <dt>Client</dt>
            <dd>{customer?.name ?? ''}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd className="amount">{formatZAR(total)}</dd>
          </div>
          <div>
            <dt>Deposit</dt>
            <dd className="amount">
              {formatZAR(deposit)} ({formatPercent(depositPct || 0)})
            </dd>
          </div>
          <div>
            <dt>Valid until</dt>
            <dd>{formatDate(addDays(todayISO(), defaults.validDays))}</dd>
          </div>
        </dl>
        <div className="sheet-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setConfirming(null)} disabled={send.isPending}>
            Not yet
          </button>
          <button type="button" className="btn btn-primary grow" onClick={() => void confirmSend()} disabled={!online || send.isPending}>
            {send.isPending ? 'Sending…' : 'Send quote'}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
