// Quotes: reads and writes to Supabase. The rules (numbering, freezing once sent,
// snapshots, "only accepted quotes can be invoiced") are enforced by the database.

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { requireSupabase } from './supabase';
import { saveDraft } from './api';
import type { Quote, QuoteProgress, QuoteStatus, QuoteWithDetails } from './types';
import { quoteInvoiceLines, type QuoteInvoiceMode } from './quoteMath';
import { todayISO } from './dates';

function check<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data as T;
}

const PROGRESS_COLUMNS =
  'id, number, status, customer_id, customer_name, title, issue_date, valid_until, total_cents, deposit_percent, invoiced_cents, paid_cents, left_to_invoice_cents, draft_invoice_count, is_expired';

function invalidateQuotes(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['quotes'] }),
    qc.invalidateQueries({ queryKey: ['quote'] }),
    qc.invalidateQueries({ queryKey: ['customer-quotes'] }),
    qc.invalidateQueries({ queryKey: ['dashboard'] }),
  ]);
}

export function useQuoteList() {
  return useQuery({
    queryKey: ['quotes'],
    queryFn: async () => check<QuoteProgress[]>(await requireSupabase().from('quote_progress').select(PROGRESS_COLUMNS).order('number', { ascending: false })),
  });
}

export function useCustomerQuotes(customerId: string | undefined) {
  return useQuery({
    queryKey: ['customer-quotes', customerId],
    enabled: !!customerId,
    queryFn: async () =>
      check<QuoteProgress[]>(await requireSupabase().from('quote_progress').select(PROGRESS_COLUMNS).eq('customer_id', customerId!).order('number', { ascending: false })),
  });
}

export function useQuote(id: string | undefined) {
  return useQuery({
    queryKey: ['quote', id],
    enabled: !!id,
    queryFn: async () => {
      const q = check<QuoteWithDetails>(
        await requireSupabase()
          .from('quotes')
          .select('*, quote_lines(*), invoices(id, number, status, kind, total_cents, issue_date)')
          .eq('id', id!)
          .single(),
      );
      q.quote_lines.sort((a, b) => a.position - b.position);
      q.invoices.sort((a, b) => (a.issue_date ?? '9999').localeCompare(b.issue_date ?? '9999'));
      return q;
    },
  });
}

export interface QuoteLineInput {
  description: string;
  quantity: number;
  unit_price_cents: number;
}

export interface QuoteDraftInput {
  id?: string;
  customer_id: string;
  title: string | null;
  notes: string | null;
  terms: string | null;
  deposit_percent: number;
  lines: QuoteLineInput[];
}

/** Creates or updates a draft quote, replacing its lines. Returns the quote id. */
export async function saveQuoteDraft(input: QuoteDraftInput): Promise<string> {
  const db = requireSupabase();
  const fields = { customer_id: input.customer_id, title: input.title, notes: input.notes, terms: input.terms, deposit_percent: input.deposit_percent };
  let id = input.id;
  if (id) {
    check(await db.from('quotes').update(fields).eq('id', id).eq('status', 'draft').select('id').single());
    check(await db.from('quote_lines').delete().eq('quote_id', id));
  } else {
    id = check<Pick<Quote, 'id'>>(await db.from('quotes').insert(fields).select('id').single()).id;
  }
  if (input.lines.length > 0) {
    check(await db.from('quote_lines').insert(input.lines.map((l, i) => ({ ...l, quote_id: id, position: i + 1 }))));
  }
  return id;
}

export function useSaveQuoteDraft() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: saveQuoteDraft, onSuccess: () => invalidateQuotes(qc) });
}

/** Saves the draft, then marks it sent: the database dates it, snapshots the details and freezes it. */
export function useSendQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (draft: QuoteDraftInput) => {
      const id = await saveQuoteDraft(draft);
      // The phone's date, not the server's UTC date
      return check<Quote>(await requireSupabase().from('quotes').update({ status: 'sent', issue_date: todayISO() }).eq('id', id).select('*').single());
    },
    // Refresh in the background: awaiting it would let the editor redirect before the caller navigates
    onSettled: () => {
      void invalidateQuotes(qc);
    },
  });
}

export function useSetQuoteStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Exclude<QuoteStatus, 'draft'> }) =>
      check<Quote>(await requireSupabase().from('quotes').update({ status }).eq('id', id).select('*').single()),
    onSettled: () => invalidateQuotes(qc),
  });
}

export function useDeleteQuoteDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const rows = check<{ id: string }[]>(await requireSupabase().from('quotes').delete().eq('id', id).eq('status', 'draft').select('id'));
      if (rows.length === 0) throw new Error('Only draft quotes can be deleted.');
    },
    onSuccess: () => invalidateQuotes(qc),
  });
}

/** Copies a quote into a new draft (how a sent quote is revised). Returns the new id. */
export function useDuplicateQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (q: QuoteWithDetails) =>
      saveQuoteDraft({
        customer_id: q.customer_id,
        title: q.title,
        notes: q.notes,
        terms: q.terms,
        deposit_percent: Number(q.deposit_percent),
        lines: q.quote_lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unit_price_cents: Number(l.unit_price_cents) })),
      }),
    onSuccess: () => invalidateQuotes(qc),
  });
}

/** Makes a draft invoice (deposit, balance or full) from an accepted quote. Returns the invoice id. */
export function useInvoiceFromQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ quote, mode, invoicedCents }: { quote: QuoteWithDetails; mode: QuoteInvoiceMode; invoicedCents: number }) => {
      const lines = quoteInvoiceLines(
        { number: quote.number, title: quote.title, total_cents: Number(quote.total_cents), deposit_percent: Number(quote.deposit_percent), lines: quote.quote_lines },
        mode,
        invoicedCents,
      );
      return saveDraft({
        customer_id: quote.customer_id,
        notes: null,
        lines,
        quote_id: quote.id,
        kind: mode === 'full' ? 'standard' : mode,
      });
    },
    onSuccess: async () => {
      await Promise.all([invalidateQuotes(qc), qc.invalidateQueries({ queryKey: ['invoices'] })]);
    },
  });
}
