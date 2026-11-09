import { Account, AccountType } from '../../domain/accounts/account.types';
import { activeAccounts } from '../../domain/accounts/account.rules';
import { redactLast4 } from '../../shared/privacy/redaction';
import { bankCanonicalForText } from './normalizeAccountKey';
import { institutionDisplayName } from './parser/institutions';
import type { SuggestionDecisionRow } from '../../data/repositories/account.repository';
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
  return suggestion.lastFour ? `${base} ••${redactLast4(suggestion.lastFour)}` : `${base} (no last 4)`;
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
  suggestion: Pick<SmsAccountSuggestion, 'accountKind' | 'lastFour'>,
): Account[] {
  // R5 (owner, 2026-11-06): every active account can be picked; compatible
  // ones first. An incompatible pick asks for confirmation (linkCompatibility).
  const rank = (account: Account) => (linkCompatibility(account, suggestion).ok ? 0 : 1);
  return activeAccounts(accounts)
    .map((account, index) => ({ account, index }))
    .sort((a, b) => rank(a.account) - rank(b.account) || a.index - b.index)
    .map(({ account }) => account);
}

export type LinkCompatibility =
  | { ok: true }
  /** Different kind (e.g. a card key onto a bank account) or a different last-4. */
  | { ok: false; reason: 'kind' | 'last_four' };

/**
 * R5: a detected key fits an account when the kinds match and the account's
 * last-4 is empty or the same. Anything else needs a confirmation.
 */
export function linkCompatibility(
  account: Pick<Account, 'type' | 'lastFour'>,
  suggestion: Pick<SmsAccountSuggestion, 'accountKind' | 'lastFour'>,
): LinkCompatibility {
  if (account.type !== suggestion.accountKind) return { ok: false, reason: 'kind' };
  const own = (account.lastFour ?? '').trim();
  if (own !== '' && suggestion.lastFour && own !== suggestion.lastFour) {
    return { ok: false, reason: 'last_four' };
  }
  return { ok: true };
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

/**
 * R5d T3b (owner decision O2, 2026-11-08): a debit card's SMS carry the
 * CARD's last-4, so they never match the bank account. When a 'bank' group's
 * institution has exactly ONE active bank account, "New accounts found"
 * suggests linking to it ("Looks like your debit card for …") — a
 * suggestion only: the user confirms and the normal link path records the
 * 'linked' decision. Null when there is no single candidate.
 */
export function debitCardLinkTarget(
  group: Pick<SuggestionGroup, 'bankCanonical' | 'suggestion'>,
  accounts: ReadonlyArray<Account>,
): Account | null {
  if (group.suggestion.accountKind !== 'bank' || group.bankCanonical === 'unknown') return null;
  const sameBank = activeAccounts(accounts).filter(
    account => account.type === 'bank' && bankCanonicalForText(account.name) === group.bankCanonical,
  );
  return sameBank.length === 1 ? sameBank[0] : null;
}

const KIND_LABEL: Record<AccountType, string> = {
  bank: 'Bank',
  credit_card: 'Credit Card',
  upi: 'UPI',
  cash: 'Cash',
  other: 'Other',
};

export interface LinkedNumber {
  /** `accountKeyToString` key of the 'linked' decision. */
  key: string;
  bankCanonical: string;
  accountKind: AccountType;
  /** '' when the linked key has no number. */
  lastFour: string;
  /** "HDFC · Bank · ••5678" (last-4 masked in the feedback screenshot). */
  label: string;
}

/**
 * R5d T3c: the card / account numbers linked to `accountId` (its 'linked'
 * decisions) — public bank id, kind and last-4 only; no SMS content.
 */
export function linkedNumbersFor(
  rows: ReadonlyArray<SuggestionDecisionRow>,
  accountId: string,
): LinkedNumber[] {
  return rows
    .filter(row => row.decision === 'linked' && row.accountId === accountId && row.bankCanonical && row.accountKind)
    .map(row => {
      const lastFour = row.lastFour ?? '';
      const kind = row.accountKind as AccountType;
      return {
        key: row.key,
        bankCanonical: row.bankCanonical as string,
        accountKind: kind,
        lastFour,
        label: `${institutionDisplayName(row.bankCanonical as string)} · ${KIND_LABEL[kind] ?? 'Other'} · ${
          lastFour ? `••${redactLast4(lastFour)}` : 'no number'
        }`,
      };
    });
}
