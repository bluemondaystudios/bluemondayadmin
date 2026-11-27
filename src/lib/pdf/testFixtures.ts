// Example data for tests and previews only. Made-up clients; never real records.
import type { BusinessSettings, Customer, InvoiceWithDetails } from '../types';

export const sampleSettings: BusinessSettings = {
  id: 1,
  trading_name: 'Blue Monday Studios',
  legal_name: null,
  entity_type: 'sole_proprietor',
  registration_no: null,
  income_tax_no: null,
  address: 'Polokwane, Limpopo, South Africa',
  phone: '081 403 5023',
  email: 'info@bluemondaystudios.co.za',
  bank_name: 'Example Bank',
  account_name: 'Blue Monday Studios',
  account_no: '0000000000',
  branch_code: '000000',
  account_type: 'Business cheque',
  invoice_prefix: 'BMS-',
  quote_prefix: 'BMS-Q-',
  quote_valid_days: 30,
  default_deposit_percent: 50,
  quote_terms: 'The balance is due on completion, before the final files or site go live.',
  payment_terms_days: 7,
  invoice_footer: 'Websites • Branding • Digital systems',
  financial_year_start_month: 3,
  last_backup_at: null,
  updated_at: '2026-11-01T00:00:00Z',
};

export const sampleCustomer: Customer = {
  id: 'c1',
  name: 'Mokoena Attorneys',
  contact_person: 'Thabo Mokoena',
  phone: '082 000 0000',
  email: 'office@example.com',
  address: '1 Example Street, Polokwane',
  notes: null,
  archived: false,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};

export function sampleInvoice(overrides: Partial<InvoiceWithDetails> = {}): InvoiceWithDetails {
  return {
    id: 'i1',
    seq: 1,
    number: 'BMS-0001',
    status: 'issued',
    customer_id: 'c1',
    quote_id: null,
    kind: 'standard',
    customer_snapshot: sampleCustomer,
    seller_snapshot: sampleSettings,
    issue_date: '2026-11-26',
    due_date: '2026-12-03',
    notes: 'Thank you for choosing us for your new website.',
    total_cents: 222500,
    void_reason: null,
    voided_at: null,
    created_at: '2026-11-26T08:00:00Z',
    updated_at: '2026-11-26T08:00:00Z',
    invoice_lines: [
      { id: 'l1', invoice_id: 'i1', position: 1, service_date: '2026-11-25', description: 'Website content updates', quantity: 2, unit_price_cents: 85000, amount_cents: 170000 },
      { id: 'l2', invoice_id: 'i1', position: 2, service_date: '2026-11-25', description: 'Consulting (hours)', quantity: 1.5, unit_price_cents: 35000, amount_cents: 52500 },
    ],
    payments: [],
    ...overrides,
  };
}
