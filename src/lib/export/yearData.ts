// Fetching a tax year's records (light: no PDF or ZIP code), shared by the Reports screen and the exports.

import { requireSupabase } from '../supabase';
import type { FinancialYear } from '../dates';
import type { BusinessSettings, InvoiceWithDetails } from '../types';
import { fetchAll } from './fetchAll';
import type { PackExpense, YearData } from './pack';

export async function fetchSettings(): Promise<BusinessSettings> {
  const s = await requireSupabase().from('business_settings').select('*').eq('id', 1).single();
  if (s.error) throw s.error;
  return s.data as BusinessSettings;
}

/** Invoice columns plus lines, payments and the quote number, for PDFs and reports. */
export const INVOICE_WITH_DETAILS = '*, invoice_lines(*), payments(*), quote:quotes(id, number, title)';

/** Issued and void invoices issued up to `until` (or all), with lines and payments. */
export async function fetchInvoices(until?: string): Promise<InvoiceWithDetails[]> {
  const db = requireSupabase();
  return fetchAll<InvoiceWithDetails>((from, to) => {
    let q = db.from('invoices').select(INVOICE_WITH_DETAILS).neq('status', 'draft');
    if (until) q = q.lte('issue_date', until);
    return q.order('seq').range(from, to);
  });
}

export async function fetchYearData(fy: FinancialYear): Promise<YearData> {
  const db = requireSupabase();
  const [settings, invoices, expenses] = await Promise.all([
    fetchSettings(),
    fetchInvoices(fy.end),
    fetchAll<PackExpense>((from, to) =>
      db.from('expenses').select('*').is('deleted_at', null).gte('spent_on', fy.start).lte('spent_on', fy.end).order('spent_on').order('id').range(from, to),
    ),
  ]);
  return { fy, settings, invoices, expenses };
}

