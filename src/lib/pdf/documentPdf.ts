// The shared A4 layout for invoices and quotes, drawn with jsPDF on the device.
// Header (logo, wordmark, big title, meta) · From / To · lines · totals · stamps,
// notices and boxes · notes · footer. Callers fill in a DocSpec.

import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { BusinessSettings } from '../types';
import { formatZAR, plainSpaces } from '../money';
import { formatDate } from '../dates';
import { formatQuantity } from '../invoiceMath';
import { BRAND } from '../../brand';

type RGB = [number, number, number];
export const NAVY: RGB = [7, 27, 58];
export const YELLOW: RGB = [255, 211, 61];
export const GREEN: RGB = [47, 133, 90];
export const GREY: RGB = [100, 112, 134];
export const RED: RGB = [197, 48, 48];
const LINE: RGB = [225, 230, 238];
const PAPER: RGB = [244, 247, 251];

const PAGE_W = 210;
const PAGE_H = 297;
const M = 15;

export const money = (cents: number) => plainSpaces(formatZAR(cents));

export interface DocLine {
  date?: string | null;
  description: string;
  quantity: number;
  unitCents: number;
  amountCents: number;
}

export interface DocSpec {
  /** Big word top right: INVOICE or QUOTE. Never "Tax Invoice": the business is not VAT-registered. */
  title: string;
  pdfTitle: string;
  meta: [string, string][];
  seller: BusinessSettings;
  partyTitle: string;
  partyLines: string[];
  /** e.g. "Project: Website for Mokoena Attorneys" or "Deposit for quote BMS-Q-0001" */
  subtitle?: string | null;
  lines: DocLine[];
  totals: { label: string; cents: number; bold?: boolean }[];
  stamp?: { text: string; date: string | null; color: RGB } | null;
  notice?: { title: string; sub: string; color: RGB } | null;
  /** Bank details box with "Please use {reference} as your payment reference." */
  payment?: { reference: string; heading?: string } | null;
  boxes?: { title: string; lines: string[] }[];
  notes?: string | null;
  watermark?: { text: string; color: RGB } | null;
  logoDataUrl?: string;
  compress?: boolean;
}

const ENTITY: Record<string, string> = { sole_proprietor: 'Sole proprietor', pty_ltd: '(Pty) Ltd', other: '' };

function splitAddress(address: string): string[] {
  return address.split(/\n|,\s*/).map((p) => p.trim()).filter(Boolean);
}

/** Lines for the "From" block. */
export function sellerLines(s: BusinessSettings): string[] {
  const out = [s.trading_name];
  if (s.legal_name && s.legal_name !== s.trading_name) out.push(s.legal_name);
  if (s.registration_no) out.push(`Reg. no. ${s.registration_no}`);
  else if (s.entity_type && ENTITY[s.entity_type]) out.push(ENTITY[s.entity_type] as string);
  out.push(...splitAddress(s.address));
  if (s.phone) out.push(s.phone);
  if (s.email) out.push(s.email);
  return out;
}

/** Lines for the "Bill to" / "Quote for" block. */
export function customerLines(c: { name: string; contact_person: string | null; address: string | null; phone: string | null; email: string | null }): string[] {
  const out = [c.name];
  if (c.contact_person) out.push(`Attn: ${c.contact_person}`);
  if (c.address) out.push(...splitAddress(c.address));
  if (c.phone) out.push(c.phone);
  if (c.email) out.push(c.email);
  return out;
}

/** Bank details for the payment box, only the ones that are filled in. */
export function bankLines(s: BusinessSettings): [string, string][] {
  const rows: [string, string | null][] = [
    ['Bank', s.bank_name],
    ['Account name', s.account_name],
    ['Account number', s.account_no],
    ['Branch code', s.branch_code],
    ['Account type', s.account_type],
  ];
  return rows.filter((r): r is [string, string] => !!r[1] && r[1].trim() !== '');
}

export function buildDocumentPdf(spec: DocSpec): jsPDF {
  const { seller } = spec;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: spec.compress ?? true });
  doc.setProperties({ title: spec.pdfTitle, subject: spec.pdfTitle, author: seller.trading_name, creator: BRAND.appName });

  // ---------- Header ----------
  let y = M;
  if (spec.logoDataUrl) doc.addImage(spec.logoDataUrl, 'PNG', M, y, 16, 16);
  const textX = spec.logoDataUrl ? M + 20 : M;
  doc.setFont('helvetica', 'bold').setFontSize(17).setTextColor(...NAVY);
  doc.text(BRAND.wordmark, textX, y + 8);
  doc.setFontSize(8).setTextColor(...GREY);
  doc.text(BRAND.tagline, textX, y + 13, { charSpace: 1.2 });

  doc.setFont('helvetica', 'bold').setFontSize(26).setTextColor(...NAVY);
  doc.text(spec.title, PAGE_W - M, y + 9, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(10);
  spec.meta.forEach(([label, value], i) => {
    const ly = y + 16 + i * 5;
    doc.setTextColor(...GREY).text(label, PAGE_W - M - 34, ly, { align: 'right' });
    doc.setTextColor(...NAVY).setFont('helvetica', 'bold').text(plainSpaces(value), PAGE_W - M, ly, { align: 'right' });
    doc.setFont('helvetica', 'normal');
  });

  y = M + 16 + Math.max(spec.meta.length, 1) * 5 + 3;
  doc.setDrawColor(...YELLOW).setLineWidth(1.4).line(M, y, PAGE_W - M, y);
  y += 8;

  // ---------- From / To ----------
  const colW = (PAGE_W - 2 * M - 10) / 2;
  const block = (title: string, lines: string[], x: number): number => {
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...GREY).text(title.toUpperCase(), x, y, { charSpace: 0.3 });
    let by = y + 5;
    lines.forEach((line, i) => {
      doc.setFont('helvetica', i === 0 ? 'bold' : 'normal').setFontSize(i === 0 ? 11 : 9.5).setTextColor(...NAVY);
      const wrapped = doc.splitTextToSize(plainSpaces(line), colW) as string[];
      doc.text(wrapped, x, by);
      by += wrapped.length * (i === 0 ? 5 : 4.4);
    });
    return by;
  };
  const endFrom = block('From', sellerLines(seller), M);
  const endTo = block(spec.partyTitle, spec.partyLines, M + colW + 10);
  y = Math.max(endFrom, endTo) + 4;

  if (spec.subtitle) {
    const wrapped = doc.splitTextToSize(plainSpaces(spec.subtitle), PAGE_W - 2 * M) as string[];
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...NAVY).text(wrapped, M, y + 2);
    y += 4 + wrapped.length * 5;
  }

  // ---------- Lines ----------
  const withDates = spec.lines.some((l) => l.date);
  const head = [...(withDates ? ['Date'] : []), 'Description', 'Qty', 'Unit price', 'Amount'];
  const firstNum = withDates ? 2 : 1;
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [head],
    body: spec.lines.map((l) => [
      ...(withDates ? [l.date ? formatDate(l.date) : ''] : []),
      plainSpaces(l.description),
      formatQuantity(Number(l.quantity)),
      money(Number(l.unitCents)),
      money(Number(l.amountCents)),
    ]),
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: { top: 2.2, bottom: 2.2, left: 2, right: 2 }, textColor: NAVY, valign: 'top' },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold' },
    bodyStyles: { lineColor: LINE, lineWidth: { bottom: 0.2 } },
    columnStyles: {
      ...(withDates ? { 0: { cellWidth: 24 } } : {}),
      [firstNum - 1]: { cellWidth: 'auto' },
      [firstNum]: { cellWidth: 14, halign: 'right' },
      [firstNum + 1]: { cellWidth: 27, halign: 'right' },
      [firstNum + 2]: { cellWidth: 28, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'head' && data.column.index >= firstNum) data.cell.styles.halign = 'right';
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE_H - 25) {
      doc.addPage();
      y = M;
    }
  };

  // ---------- Totals ----------
  ensureSpace(8 + spec.totals.length * 7);
  const labelX = PAGE_W - M - 40;
  const totalsTop = y;
  spec.totals.forEach(({ label, cents, bold }) => {
    if (bold) doc.setDrawColor(...NAVY).setLineWidth(0.3).line(labelX - 30, y - 4, PAGE_W - M, y - 4);
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(bold ? 12 : 10).setTextColor(...(bold ? NAVY : GREY));
    doc.text(label, labelX, y, { align: 'right' });
    doc.setTextColor(...NAVY).text(money(cents), PAGE_W - M, y, { align: 'right' });
    y += bold ? 8 : 6;
  });

  // ---------- Stamp (left of the totals) ----------
  if (spec.stamp) {
    const angle = 8;
    const rad = (angle * Math.PI) / 180;
    const sx = M + 8;
    const sy = totalsTop + 15;
    const rotate = ([bx, by]: [number, number]): [number, number] => [sx + bx * Math.cos(rad) + by * Math.sin(rad), sy - bx * Math.sin(rad) + by * Math.cos(rad)];
    doc.setTextColor(...spec.stamp.color).setFont('helvetica', 'bold').setFontSize(spec.stamp.text.length > 5 ? 22 : 30);
    doc.text(spec.stamp.text, sx, sy, { angle });
    if (spec.stamp.date) doc.setFontSize(10).text(formatDate(spec.stamp.date), ...rotate([1, 7]), { angle });
    doc.setDrawColor(...spec.stamp.color).setLineWidth(1.1);
    const width = spec.stamp.text.length > 5 ? 56 : 40;
    const box = ([[-4, -13], [width, -13], [width, 10], [-4, 10]] as [number, number][]).map(rotate);
    for (let i = 0; i < 4; i++) {
      const a = box[i]!;
      const b = box[(i + 1) % 4]!;
      doc.line(a[0], a[1], b[0], b[1]);
    }
    y = Math.max(y, totalsTop + 28);
  }

  // ---------- Notice (e.g. void reason) ----------
  if (spec.notice) {
    const text = doc.splitTextToSize(plainSpaces(spec.notice.title), PAGE_W - 2 * M - 10) as string[];
    const boxH = 11 + text.length * 5;
    y += 2;
    ensureSpace(boxH + 4);
    doc.setDrawColor(...spec.notice.color).setLineWidth(0.6).roundedRect(M, y, PAGE_W - 2 * M, boxH, 2, 2, 'S');
    doc.setTextColor(...spec.notice.color).setFont('helvetica', 'bold').setFontSize(10).text(text, M + 5, y + 6);
    doc.setFont('helvetica', 'normal').setFontSize(8.5).text(plainSpaces(spec.notice.sub), M + 5, y + 6 + text.length * 5);
    y += boxH + 6;
  }

  // ---------- Information boxes (e.g. quote terms) ----------
  for (const box of spec.boxes ?? []) {
    const wrapped = box.lines.flatMap((l) => doc.splitTextToSize(plainSpaces(l), PAGE_W - 2 * M - 10) as string[]);
    const boxH = 12 + wrapped.length * 4.6;
    y += 2;
    ensureSpace(boxH + 4);
    doc.setFillColor(...PAPER).setDrawColor(...LINE).setLineWidth(0.2).roundedRect(M, y, PAGE_W - 2 * M, boxH, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...NAVY).text(box.title, M + 5, y + 7);
    doc.setFont('helvetica', 'normal').setFontSize(9.5).text(wrapped, M + 5, y + 13);
    y += boxH + 4;
  }

  // ---------- Payment box ----------
  if (spec.payment) {
    const bank = bankLines(seller);
    const boxH = 12 + Math.max(bank.length, 1) * 5 + 8;
    y += 2;
    ensureSpace(boxH + 4);
    doc.setFillColor(...PAPER).setDrawColor(...LINE).setLineWidth(0.2).roundedRect(M, y, PAGE_W - 2 * M, boxH, 2, 2, 'FD');
    let py = y + 7;
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...NAVY).text(spec.payment.heading ?? 'How to pay', M + 5, py);
    py += 6;
    doc.setFontSize(9.5);
    if (bank.length === 0) {
      doc.setFont('helvetica', 'normal').text(`Please contact us on ${seller.phone} for payment details.`, M + 5, py);
      py += 5;
    }
    bank.forEach(([label, value]) => {
      doc.setFont('helvetica', 'normal').setTextColor(...GREY).text(label, M + 5, py);
      doc.setTextColor(...NAVY).setFont('helvetica', 'bold').text(plainSpaces(value), M + 45, py);
      py += 5;
    });
    py += 1;
    const ref = spec.payment.reference;
    doc.setFont('helvetica', 'normal').setTextColor(...NAVY).text('Please use ', M + 5, py);
    const w1 = doc.getTextWidth('Please use ');
    doc.setFont('helvetica', 'bold').text(ref, M + 5 + w1, py);
    const w2 = doc.getTextWidth(ref);
    doc.setFont('helvetica', 'normal').text(' as your payment reference.', M + 5 + w1 + w2, py);
    y += boxH + 6;
  }

  // ---------- Notes ----------
  if (spec.notes && spec.notes.trim()) {
    const wrapped = doc.splitTextToSize(plainSpaces(spec.notes.trim()), PAGE_W - 2 * M) as string[];
    ensureSpace(8 + wrapped.length * 4.4);
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...GREY).text('NOTES', M, y, { charSpace: 0.3 });
    doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...NAVY).text(wrapped, M, y + 5);
    y += 8 + wrapped.length * 4.4;
  }

  // ---------- Watermark (every page) ----------
  if (spec.watermark) {
    for (let p = 1; p <= doc.getNumberOfPages(); p++) {
      doc.setPage(p);
      doc.saveGraphicsState();
      doc.setGState(doc.GState({ opacity: 0.16 }));
      doc.setTextColor(...spec.watermark.color).setFont('helvetica', 'bold').setFontSize(spec.watermark.text.length > 5 ? 80 : 120);
      doc.text(spec.watermark.text, 42, 215, { angle: 40 });
      doc.restoreGraphicsState();
    }
  }

  // ---------- Footer (every page) ----------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...LINE).setLineWidth(0.2).line(M, PAGE_H - 20, PAGE_W - M, PAGE_H - 20);
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...NAVY);
    if (seller.invoice_footer) doc.text(plainSpaces(seller.invoice_footer), PAGE_W / 2, PAGE_H - 14, { align: 'center' });
    doc.setFont('helvetica', 'normal').setTextColor(...GREY).text(BRAND.thanks, PAGE_W / 2, PAGE_H - 9, { align: 'center' });
    if (pages > 1) doc.setFontSize(8).text(`Page ${p} of ${pages}`, PAGE_W - M, PAGE_H - 9, { align: 'right' });
  }

  return doc;
}
