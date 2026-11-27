// Row shapes as PostgREST returns them (see supabase/migrations/0001_init.sql).
// bigint and numeric columns arrive as JSON numbers.

export type InvoiceStatus = 'draft' | 'issued' | 'void';
export type InvoiceKind = 'standard' | 'deposit' | 'balance';
export type PaymentMethod = 'eft' | 'cash' | 'card' | 'other';
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined';

export interface Customer {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface BusinessSettings {
  id: 1;
  trading_name: string;
  legal_name: string | null;
  entity_type: 'sole_proprietor' | 'pty_ltd' | 'other' | null;
  registration_no: string | null;
  income_tax_no: string | null;
  address: string;
  phone: string;
  email: string;
  bank_name: string | null;
  account_name: string | null;
  account_no: string | null;
  branch_code: string | null;
  account_type: string | null;
  invoice_prefix: string;
  quote_prefix: string;
  quote_valid_days: number;
  default_deposit_percent: number;
  quote_terms: string | null;
  payment_terms_days: number;
  invoice_footer: string | null;
  financial_year_start_month: number;
  last_backup_at: string | null;
  updated_at: string;
}

export interface InvoiceLine {
  id: string;
  invoice_id: string;
  position: number;
  service_date: string | null;
  description: string;
  quantity: number;
  unit_price_cents: number;
  amount_cents: number;
}

export interface Payment {
  id: string;
  invoice_id: string;
  paid_on: string;
  amount_cents: number;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  created_at: string;
}

export interface Invoice {
  id: string;
  seq: number | null;
  number: string | null;
  status: InvoiceStatus;
  customer_id: string;
  quote_id: string | null;
  kind: InvoiceKind;
  customer_snapshot: Customer | null;
  seller_snapshot: BusinessSettings | null;
  issue_date: string | null;
  due_date: string | null;
  notes: string | null;
  total_cents: number;
  void_reason: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
}

/** An invoice with its lines and payments embedded (one PostgREST request). */
export interface InvoiceWithDetails extends Invoice {
  invoice_lines: InvoiceLine[];
  payments: Payment[];
  /** The quote it was invoiced from, if any (embedded by PostgREST). */
  quote?: { id: string; number: string; title: string | null } | null;
}

/** A row of the invoice_balances view. */
export interface InvoiceBalance {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  customer_id: string;
  customer_name: string;
  issue_date: string | null;
  due_date: string | null;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  is_overdue: boolean | null;
  quote_id?: string | null;
  kind?: InvoiceKind;
}

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'eft', label: 'EFT' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
];

export function paymentMethodLabel(m: PaymentMethod): string {
  return PAYMENT_METHODS.find((p) => p.value === m)?.label ?? m;
}

export interface QuoteLine {
  id: string;
  quote_id: string;
  position: number;
  description: string;
  quantity: number;
  unit_price_cents: number;
  amount_cents: number;
}

export interface Quote {
  id: string;
  seq: number;
  number: string;
  status: QuoteStatus;
  customer_id: string;
  title: string | null;
  notes: string | null;
  terms: string | null;
  deposit_percent: number;
  total_cents: number;
  issue_date: string | null;
  valid_until: string | null;
  customer_snapshot: Customer | null;
  seller_snapshot: BusinessSettings | null;
  sent_at: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A quote with its lines and the invoices made from it. */
export interface QuoteWithDetails extends Quote {
  quote_lines: QuoteLine[];
  invoices: Pick<Invoice, 'id' | 'number' | 'status' | 'kind' | 'total_cents' | 'issue_date'>[];
}

/** A row of the quote_progress view. */
export interface QuoteProgress {
  id: string;
  number: string;
  status: QuoteStatus;
  customer_id: string;
  customer_name: string;
  title: string | null;
  issue_date: string | null;
  valid_until: string | null;
  total_cents: number;
  deposit_percent: number;
  invoiced_cents: number;
  paid_cents: number;
  left_to_invoice_cents: number;
  draft_invoice_count: number;
  is_expired: boolean;
}
