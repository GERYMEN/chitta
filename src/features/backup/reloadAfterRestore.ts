import { useTransactionsStore } from '../transactions/state/transactionsStore';
import { useSuggestionSession } from '../sms-sync/suggestionSession';
import { initTourOnLaunch, useTourStore } from '../tour/tourStore';
import { bumpDataEpoch } from '../../shared/state/dataEpoch';
import { useBackupStore } from './backupStore';
import { useNewAccountsStore } from '../sms-sync/newAccountsStore';
import { useBillsStore } from '../bills/state/billsStore';
import { useBudgetsStore } from '../budgets/state/budgetsStore';
import { useChainSuggestions } from '../sms-sync/rules/chaining';
import { initSecurityOnLaunch } from '../security/securitySettings';

/**
 * R4e: after a restore replaced every row, bring every in-memory store back
 * in line with SQLite — no app restart:
 * - transactions store: rows, accounts, categories, rules, dismissals,
 *   profile + approval settings, SMS sync start + cursor (filters and the
 *   selected period go back to defaults: they may name ids that are gone);
 * - the in-memory "New accounts found" session (it described the old data);
 * - the tour: stopped, then the launch rule runs on the restored
 *   `tour_completed_at` (a date → never shown; missing → marked done
 *   silently; '' = still owed → requested);
 * - the feedback button position (data epoch → it re-reads its setting);
 * - last backup date (device-local, unchanged by the restore — re-read anyway).
 */
export async function reloadAfterRestore(): Promise<void> {
  useSuggestionSession.getState().clear();
  useTourStore.setState({ active: false, index: 0, requested: false });
  await useTransactionsStore.getState().reloadFromDatabase();
  useTransactionsStore.setState({ isHydrated: true });
  bumpDataEpoch();
  await initTourOnLaunch(useTransactionsStore.getState().hasOnboarded).catch(() => undefined);
  await useBackupStore.getState().load();
  // R5-fix C2: the restored "new accounts found" summary.
  await useNewAccountsStore.getState().refresh();
  // R5b: the restored bills.
  await useBillsStore.getState().refresh();
  // R5c: the restored budgets (or none, for an older backup).
  await useBudgetsStore.getState().refresh();
  // R5i (G3): the restored chain suggestions (or none, for an older backup).
  await useChainSuggestions.getState().refresh();
  // R9a: the restored Hide amounts / secure screen preferences (or off).
  await initSecurityOnLaunch();
}
