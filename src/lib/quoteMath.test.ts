import { describe, expect, it } from 'vitest';
import { depositCents, formatPercent, nextInvoiceOptions, quoteInvoiceLines, type QuoteForInvoicing } from './quoteMath';

const q: QuoteForInvoicing = {
  number: 'BMS-Q-0001',
  title: 'Website for Mokoena Attorneys',
  total_cents: 1100000,
  deposit_percent: 50,
  lines: [
    { description: 'Website design and build', quantity: 1, unit_price_cents: 800000 },
    { description: 'Hosting and maintenance (months)', quantity: 12, unit_price_cents: 25000 },
  ],
};

describe('deposits', () => {
  it('works out the deposit to the cent', () => {
    expect(depositCents(1100000, 50)).toBe(550000);
    expect(depositCents(100000, 33.33)).toBe(33330);
    expect(depositCents(99999, 50)).toBe(50000); // 499.995 -> 500.00 (half up)
    expect(depositCents(1000, 12.5)).toBe(125);
  });
  it('formats percentages', () => {
    expect(formatPercent(50)).toBe('50%');
    expect(formatPercent(33.33)).toBe('33.33%');
    expect(formatPercent(12.5)).toBe('12.5%');
  });
});

describe('quoteInvoiceLines', () => {
  it('deposit: one line for the percentage', () => {
    expect(quoteInvoiceLines(q, 'deposit', 0)).toEqual([
      { description: 'Deposit (50%) for quote BMS-Q-0001: Website for Mokoena Attorneys', service_date: null, quantity: 1, unit_price_cents: 550000 },
    ]);
  });
  it('balance: whatever has not been invoiced yet', () => {
    expect(quoteInvoiceLines(q, 'balance', 550000)).toEqual([
      { description: 'Balance for quote BMS-Q-0001: Website for Mokoena Attorneys', service_date: null, quantity: 1, unit_price_cents: 550000 },
    ]);
    expect(quoteInvoiceLines({ ...q, title: null }, 'balance', 100000)[0]).toMatchObject({ description: 'Balance for quote BMS-Q-0001', unit_price_cents: 1000000 });
  });
  it('full: copies the quote lines', () => {
    expect(quoteInvoiceLines(q, 'full', 0)).toEqual([
      { description: 'Website design and build', service_date: null, quantity: 1, unit_price_cents: 800000 },
      { description: 'Hosting and maintenance (months)', service_date: null, quantity: 12, unit_price_cents: 25000 },
    ]);
  });
  it('refuses to invoice twice', () => {
    expect(() => quoteInvoiceLines(q, 'deposit', 550000)).toThrow(/already/);
    expect(() => quoteInvoiceLines(q, 'full', 1)).toThrow(/balance/);
    expect(() => quoteInvoiceLines(q, 'balance', 1100000)).toThrow(/fully invoiced/);
  });
});

describe('nextInvoiceOptions', () => {
  it('offers deposit or full first, then the balance, then nothing', () => {
    expect(nextInvoiceOptions(q, 0)).toEqual([
      { mode: 'deposit', amountCents: 550000 },
      { mode: 'full', amountCents: 1100000 },
    ]);
    expect(nextInvoiceOptions(q, 550000)).toEqual([{ mode: 'balance', amountCents: 550000 }]);
    expect(nextInvoiceOptions(q, 1100000)).toEqual([]);
    expect(nextInvoiceOptions({ ...q, total_cents: 0 }, 0)).toEqual([]);
  });
});
