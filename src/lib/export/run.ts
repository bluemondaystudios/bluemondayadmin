// Browser side of the exports: fetch from Supabase, build the ZIP, save it to the phone.
// Loaded only when an export starts (it pulls in the PDF and ZIP libraries).

import bmLogo from '../../assets/bm-logo.png?inline';
import { requireSupabase } from '../supabase';
import type { FinancialYear } from '../dates';
import { todayISO } from '../dates';
import type { InvoiceWithDetails } from '../types';
import { buildInvoicePdf } from '../pdf/invoicePdf';
import { downloadFile } from '../sharePdf';
import { packEntries } from './pack';
import { fetchInvoices, fetchYearData } from './yearData';
import { fetchAll } from './fetchAll';
import { BACKUP_TABLES, backupEntries, type BackupData } from './backup';
import { backupName, packName } from './names';
import { buildZip, type ZipProgress } from './zip';

function invoicePdf(inv: InvoiceWithDetails): Uint8Array {
  inv.invoice_lines.sort((a, b) => a.position - b.position);
  return new Uint8Array(buildInvoicePdf({ invoice: inv, logoDataUrl: bmLogo }).output('arraybuffer'));
}

async function downloadReceipt(path: string): Promise<Uint8Array | null> {
  const { data, error } = await requireSupabase().storage.from('receipts').download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export interface ExportOutcome {
  fileName: string;
  sizeBytes: number;
}

export async function runExportPack(fy: FinancialYear, onProgress: (p: ZipProgress) => void): Promise<ExportOutcome> {
  const data = await fetchYearData(fy);
  const { entries } = packEntries(data, { invoicePdf, receipt: downloadReceipt });
  const { blob } = await buildZip(entries, onProgress);
  const fileName = `${packName(fy)}.zip`;
  downloadFile(new File([blob], fileName, { type: 'application/zip' }));
  return { fileName, sizeBytes: blob.size };
}

export async function runBackup(appVersion: string, onProgress: (p: ZipProgress) => void): Promise<ExportOutcome> {
  const db = requireSupabase();
  const tables = {} as BackupData['tables'];
  for (const t of BACKUP_TABLES) {
    const orderCol = t === 'business_settings' ? 'id' : t === 'team_members' ? 'user_id' : t === 'audit_log' ? 'id' : 'created_at';
    tables[t] = await fetchAll<Record<string, unknown>>((from, to) => {
      const q = db.from(t).select('*').order(orderCol);
      if (t === 'invoice_lines') return db.from(t).select('*').order('invoice_id').order('position').range(from, to);
      if (t === 'quote_lines') return db.from(t).select('*').order('quote_id').order('position').range(from, to);
      return q.range(from, to);
    });
  }
  const invoices = await fetchInvoices();
  const now = new Date();
  const root = backupName(todayISO(now));
  const entries = backupEntries(root, { tables, invoices }, { invoicePdf, receipt: downloadReceipt }, { generatedAt: now, appVersion });
  const { blob } = await buildZip(entries, onProgress);
  const fileName = `${root}.zip`;
  downloadFile(new File([blob], fileName, { type: 'application/zip' }));
  // Record it, for the reminder on Home
  const { error } = await db.from('business_settings').update({ last_backup_at: now.toISOString() }).eq('id', 1);
  if (error) throw error;
  return { fileName, sizeBytes: blob.size };
}
