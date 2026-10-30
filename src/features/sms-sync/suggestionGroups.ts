import { Account, AccountType } from '../../domain/accounts/account.types';
import { activeAccounts } from '../../domain/accounts/account.rules';
import { ParsedSmsTransaction } from './smsParser';
import { decisionKeyFor, SmsAccountSuggestion, suggestionKeyFor } from './smsSyncLogic';

/**
 * R2b: one "New Accounts Found" card — a suggested account plus the SMS
 * candidates waiting for it. Lives only in memory (the suggestion session);
 * nothing here is persisted until the user adds/links the account. Items are
 * parser output: `sanitizedPreview` is the only SMS-derived text, never the
 * raw body or sender.
 */
export interface SuggestionGroup {
  /** `suggestionKeyFor` — card identity. */
  key: string;
  /** `decisionKeyFor` — the normalized key an Add/Link/Ignore decision uses. */
  decisionKey: string;
  bankCanonical: string;
  suggestion: SmsAccountSuggestion;
  /** Newest first. */
  items: ParsedSmsTransaction[];
}

/**
 * Group unmatched candidates per suggested account (same key as
 * `groupUnmatchedIntoSuggestions`), keeping the candidates themselves.
 * Groups are sorted by count descending (ties: newest activity first); the
 * items of a group newest first.
 */
export function groupUnmatchedCandidates(unmatched: ParsedSmsTransaction[]): SuggestionGroup[] {
  const byKey = new Map<string, SuggestionGroup>();

  for (const candidate of unmatched) {
    const key = suggestionKeyFor(candidate);
    const existing = byKey.get(key);
    if (existing) {
      existing.items.push(candidate);
      existing.suggestion.messageCount += 1;
    } else {
      byKey.set(key, {
        key,
        decisionKey: decisionKeyFor(candidate),
        bankCanonical: candidate.bankCanonical,
        suggestion: {
          bankName: candidate.bankName,
          accountKind: candidate.accountKind,
          lastFour: candidate.lastFour,
          messageCount: 1,
        },
        items: [candidate],
      });
    }
  }

  const groups = Array.from(byKey.values());
  for (const group of groups) {
    group.items.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  }
  return groups.sort((a, b) => {
    const byCount = b.items.length - a.items.length;
    if (byCount !== 0) return byCount;
    return Date.parse(b.items[0].occurredAt) - Date.parse(a.items[0].occurredAt);
  });
}

const UNKNOWN_BANK = 'Unknown Bank';

const KIND_SUFFIX: Record<AccountType, string> = {
  bank: 'Bank',
  credit_card: 'Credit Card',
  upi: 'UPI',
  cash: 'Cash',
  other: '',
};

/**
 * Proposed account name WITHOUT the last four — what the Add account form is
 * prefilled with (the last four has its own field and the app's account label
 * appends it). "HDFC Bank", "SBI Credit Card", "Union Bank", "Unknown bank".
 */
export function proposedAccountBaseName(
  suggestion: Pick<SmsAccountSuggestion, 'bankName' | 'accountKind'>,
): string {
  const unknown = suggestion.bankName === UNKNOWN_BANK;
  const bank = unknown ? 'Unknown bank' : suggestion.bankName;
  const suffix = KIND_SUFFIX[suggestion.accountKind];
  if (suffix === '') return bank;
  // "Union Bank" / "Bank of India" / "Unknown bank" already say "bank".
  if (suggestion.accountKind === 'bank' && /\bbank\b/i.test(bank)) return bank;
  return `${bank} ${suffix}`;
}

/**
 * Card title: "HDFC Bank ••1234", "SBI Credit Card ••5368",
 * "Unknown bank (no last 4)".
 */
export function proposedAccountTitle(
  suggestion: Pick<SmsAccountSuggestion, 'bankName' | 'accountKind' | 'lastFour'>,
): string {
  const base = proposedAccountBaseName(suggestion);
  return suggestion.lastFour ? `${base} ••${suggestion.lastFour}` : `${base} (no last 4)`;
}

export interface GroupSummary {
  count: number;
  /** ISO, oldest / newest item; null when empty. */
  firstAt: string | null;
  lastAt: string | null;
  /** Sum of income items (minor units). */
  inMinor: number;
  /** Sum of expense items (minor units). */
  outMinor: number;
}

export function summarizeGroup(
  items: ReadonlyArray<Pick<ParsedSmsTransaction, 'type' | 'amountMinor' | 'occurredAt'>>,
): GroupSummary {
  let firstMs = Infinity;
  let lastMs = -Infinity;
  let inMinor = 0;
  let outMinor = 0;
  let firstAt: string | null = null;
  let lastAt: string | null = null;
  for (const item of items) {
    const ms = Date.parse(item.occurredAt);
    if (ms < firstMs) {
      firstMs = ms;
      firstAt = item.occurredAt;
    }
    if (ms > lastMs) {
      lastMs = ms;
      lastAt = item.occurredAt;
    }
    if (item.type === 'income') inMinor += item.amountMinor;
    else outMinor += item.amountMinor;
  }
  return { count: items.length, firstAt, lastAt, inMinor, outMinor };
}

/** "3 new accounts · 27 transactions waiting". */
export function suggestionsSummaryLine(groups: ReadonlyArray<Pick<SuggestionGroup, 'items'>>): string {
  const accounts = groups.length;
  const waiting = groups.reduce((sum, group) => sum + group.items.length, 0);
  return `${accounts} new account${accounts === 1 ? '' : 's'} · ${waiting} transaction${
    waiting === 1 ? '' : 's'
  } waiting`;
}

/** "N transaction(s) waiting". */
export function waitingLabel(count: number): string {
  return `${count} transaction${count === 1 ? '' : 's'} waiting`;
}

/**
 * "Link to existing" targets: ACTIVE accounts of the same kind that have no
 * last four (an account with a last four already matches its own SMS).
 */
export function linkableAccounts(
  accounts: ReadonlyArray<Account>,
  suggestion: Pick<SmsAccountSuggestion, 'accountKind'>,
): Account[] {
  return activeAccounts(accounts).filter(
    account =>
      account.type === suggestion.accountKind &&
      (account.lastFour == null || account.lastFour.trim() === ''),
  );
}

function shortDate(iso: string, withYear: boolean): string {
  const date = new Date(iso);
  const month = date.toLocaleDateString('en-IN', { month: 'short' });
  return withYear ? `${date.getDate()} ${month} ${date.getFullYear()}` : `${date.getDate()} ${month}`;
}

/** "3 Oct – 28 Oct 2026", "28 Oct 2026" (same day), "30 Dec 2025 – 2 Jan 2026". */
export function formatShortDateRange(firstIso: string, lastIso: string): string {
  const first = new Date(firstIso);
  const last = new Date(lastIso);
  const sameDay =
    first.getFullYear() === last.getFullYear() &&
    first.getMonth() === last.getMonth() &&
    first.getDate() === last.getDate();
  if (sameDay) return shortDate(lastIso, true);
  const sameYear = first.getFullYear() === last.getFullYear();
  return `${shortDate(firstIso, !sameYear)} – ${shortDate(lastIso, true)}`;
}
