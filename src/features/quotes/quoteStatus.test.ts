import { describe, expect, it } from 'vitest';
import type { QuoteProgress } from '../../lib/types';
import { matchesQuoteFilter, matchesQuoteSearch, quoteDisplayStatus } from './quoteStatus';

const q = (o: Partial<QuoteProgress>): QuoteProgress => ({
  id: 'q', number: 'BMS-Q-0007', status: 'sent', customer_id: 'c', customer_name: 'Mokoena Attorneys', title: 'Website redesign',
  issue_date: '2026-11-01', valid_until: '2026-12-01', total_cents: 100000, deposit_percent: 50, invoiced_cents: 0, paid_cents: 0,
  left_to_invoice_cents: 100000, draft_invoice_count: 0, is_expired: false, ...o,
});

describe('quoteDisplayStatus', () => {
  it('covers every state', () => {
    expect(quoteDisplayStatus(q({ status: 'draft' }))).toBe('draft');
    expect(quoteDisplayStatus(q({}))).toBe('sent');
    expect(quoteDisplayStatus(q({ is_expired: true }))).toBe('expired');
    expect(quoteDisplayStatus(q({ status: 'accepted' }))).toBe('accepted');
    expect(quoteDisplayStatus(q({ status: 'accepted', left_to_invoice_cents: 50000 }))).toBe('accepted');
    expect(quoteDisplayStatus(q({ status: 'accepted', left_to_invoice_cents: 0 }))).toBe('invoiced');
    expect(quoteDisplayStatus(q({ status: 'declined' }))).toBe('declined');
  });
});

describe('quote filters and search', () => {
  it('filters', () => {
    expect(matchesQuoteFilter(q({ is_expired: true }), 'open')).toBe(true);
    expect(matchesQuoteFilter(q({ status: 'accepted' }), 'open')).toBe(false);
    expect(matchesQuoteFilter(q({ status: 'declined' }), 'closed')).toBe(true);
    expect(matchesQuoteFilter(q({ status: 'draft' }), 'drafts')).toBe(true);
  });
  it('searches client, title and number', () => {
    expect(matchesQuoteSearch(q({}), 'mokoena')).toBe(true);
    expect(matchesQuoteSearch(q({}), 'redesign')).toBe(true);
    expect(matchesQuoteSearch(q({}), 'q-0007')).toBe(true);
    expect(matchesQuoteSearch(q({}), '7')).toBe(true);
    expect(matchesQuoteSearch(q({}), '70')).toBe(false);
  });
});
