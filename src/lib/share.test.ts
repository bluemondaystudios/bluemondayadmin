import { describe, expect, it } from 'vitest';
import { greetingName, invoiceFileName, invoiceShareText, quoteShareText, whatsAppLink } from './share';

describe('invoiceShareText', () => {
  it('matches the agreed wording', () => {
    expect(invoiceShareText({ customerName: 'Thabo Nkosi', number: 'BMS-0001', amountCents: 222500 })).toBe(
      'Hi Thabo, please find invoice BMS-0001 for R 2 225,00 attached. Thank you, Blue Monday Studios.',
    );
  });
  it('greets the contact person of an organisation', () => {
    expect(invoiceShareText({ customerName: 'Pretoria Girls High', contactPerson: 'Mrs Dlamini', number: 'BMS-0002', amountCents: 100 })).toMatch(/^Hi Mrs Dlamini,/);
    expect(greetingName('Pretoria Girls High', 'Lerato Dlamini')).toBe('Lerato');
    expect(greetingName('Dr Mokoena')).toBe('Dr Mokoena');
  });
  it('keeps organisation names whole', () => {
    expect(greetingName('Mokoena Family')).toBe('Mokoena Family');
    expect(greetingName('Mokoena Attorneys')).toBe('Mokoena Attorneys');
  });
  it('uses plain spaces in the amount', () => {
    expect(invoiceShareText({ customerName: 'A', number: 'X', amountCents: 123456700 })).toContain('R 1 234 567,00');
  });
});

describe('whatsAppLink', () => {
  it('converts the number and encodes the text', () => {
    expect(whatsAppLink('082 123 4567', 'Hi there & thanks')).toBe('https://wa.me/27821234567?text=Hi%20there%20%26%20thanks');
  });
  it('works without a number', () => {
    expect(whatsAppLink(null, 'x')).toBe('https://wa.me/?text=x');
    expect(whatsAppLink('nonsense', 'x')).toBe('https://wa.me/?text=x');
  });
});

describe('invoiceFileName', () => {
  it('names the PDF after the invoice', () => {
    expect(invoiceFileName('EDR-0001')).toBe('EDR-0001.pdf');
    expect(invoiceFileName('EDR/2026 01')).toBe('EDR_2026_01.pdf');
  });
});

describe('quoteShareText', () => {
  it('mentions the total and how long it is valid', () => {
    expect(quoteShareText({ customerName: 'Mokoena Attorneys', contactPerson: 'Thabo Mokoena', number: 'BMS-Q-0001', amountCents: 1100000, validUntil: '2026-12-27' })).toBe(
      "Hi Thabo, please find quote BMS-Q-0001 for R 11 000,00 attached. It's valid until 27 Dec 2026. Thank you, Blue Monday Studios.",
    );
  });
});
