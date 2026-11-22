import { useTransactionsStore } from '../transactions/state/transactionsStore';
import { saveTextFile } from '../../native/android/security/securityNative';
import { csvFileName, csvFromTransactions } from './csvExport';

export type CsvExportOutcome = { saved: true; rows: number } | { saved: false };

/**
 * R9a T3: Settings → "Export transactions (CSV)". Builds the CSV of approved
 * rows in memory and hands it to the system "save as" sheet (user-triggered,
 * user-chosen place, no permission). Nothing is logged or stored.
 */
export async function exportApprovedTransactionsCsv(now: Date = new Date()): Promise<CsvExportOutcome> {
  const { transactions, accounts, categories } = useTransactionsStore.getState();
  const csv = csvFromTransactions(transactions, accounts, categories);
  const rows = csv.split('\r\n').length - 1;
  const result = await saveTextFile(csv, csvFileName(now), 'text/csv');
  return result.saved ? { saved: true, rows } : { saved: false };
}
