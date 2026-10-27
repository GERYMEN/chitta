import { AccountType } from '../../domain/accounts/account.types';

/**
 * D4 — normalized, versioned account key (pure function).
 *
 * Replaces the inline `extractBankName`/`extractAccountKind`/`extractLastFour`
 * heuristics in `smsParser.ts` with a stable, deterministically-reproducible
 * key. The SAME input body always yields the SAME `AccountKey` (no randomness,
 * no clock). A later phase wires this in to drive `smsSyncLogic` grouping and
 * the `(bank_canonical, account_kind, last_four)` DB composite key.
 *
 * `normalizerVersion` is stored alongside every persisted key so a future
 * logic change can bump `ACCOUNT_KEY_NORMALIZER_VERSION` and ship a migration
 * to re-canonicalize existing rows.
 */

export const ACCOUNT_KEY_NORMALIZER_VERSION = 1;

export interface AccountKey {
  /** Canonical lowercase bank id, e.g. 'hdfc' | 'federal' | 'sbi' | 'unknown'. */
  bankCanonical: string;
  /** 'bank' | 'credit_card' | 'upi' — never 'cash'/'other' from SMS. */
  accountKind: AccountType;
  /** '' sentinel for unidentified; NEVER null/undefined. */
  lastFour: string;
  /** Always `ACCOUNT_KEY_NORMALIZER_VERSION`. */
  normalizerVersion: number;
}

/**
 * v1 bank alias map. NOT exhaustive — new/unknown banks fall through to
 * `'unknown'` (not a crash, not a wrong bank). Each alias resolves to one
 * canonical lowercase bank id. Ordered MOST-SPECIFIC-FIRST so longer tokens
 * win over shorter substrings (e.g. "State Bank of India" before "Bank of
 * India", "IDFC FIRST Bank" before "IDFC"). Cross-bank substrings are
 * deliberately placed before their shorter overlap: "State Bank of India" and
 * "Union Bank of India" both contain "Bank of India" (boi), so they must be
 * checked first.
 */
const BANK_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['State Bank of India', 'sbi'],
  ['Union Bank of India', 'union'],
  ['Punjab National Bank', 'pnb'],
  ['IDFC FIRST Bank', 'idfc'],
  ['IDFC First', 'idfc'],
  ['Kotak Mahindra', 'kotak'],
  ['Yes Bank', 'yes'],
  ['HDFC Bank', 'hdfc'],
  ['Federal Bank', 'federal'],
  ['ICICI Bank', 'icici'],
  ['Axis Bank', 'axis'],
  ['Canara Bank', 'canara'],
  ['Union Bank', 'union'],
  ['Bank of India', 'boi'],
  ['SBI Card', 'sbi'],
  ['HDFCBK', 'hdfc'],
  ['FEDBNK', 'federal'],
  ['SBICRD', 'sbi'],
  ['ICICIB', 'icici'],
  ['AXISBK', 'axis'],
  ['KOTAKB', 'kotak'],
  ['YESBNK', 'yes'],
  ['SBI', 'sbi'],
  ['HDFC', 'hdfc'],
  ['Federal', 'federal'],
  ['ICICI', 'icici'],
  ['Axis', 'axis'],
  ['Kotak', 'kotak'],
  ['PNB', 'pnb'],
  ['BOI', 'boi'],
  ['Canara', 'canara'],
  ['IDFC', 'idfc'],
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const BANK_ALIAS_ENTRIES: ReadonlyArray<{
  readonly regex: RegExp;
  readonly canonical: string;
}> = BANK_ALIASES.map(([alias, canonical]) => ({
  regex: new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i'),
  canonical,
}));

/** Credit-card wording wins over the looser "account" wording (check first). */
const CREDIT_CARD_PATTERN = /credit\s*card|card\s+ending|\bcc\b/i;
const BANK_ACCOUNT_PATTERN = /\ba\/?c\b|\baccount\b|bank\s+a\/?c/i;

/**
 * Four digits near an account/card keyword ("a/c", "acct", "account", "card")
 * — not just any 4 digits, which would false-match reference numbers or
 * balances. Covers "a/c X1859", "A/C *7302", "card ending 8123", "Acct XX1234",
 * "a/c ending 1859".
 */
const LAST_FOUR_PATTERN =
  /(?:a\/?c|acct|account|card)[^\d]{0,20}(?:ending\s*)?[x*]{0,6}\s*(\d{4})\b/i;

/**
 * Mask-prefixed 4 digits with no account/card keyword nearby, e.g. "XX1859",
 * "X1859", "*1859", "XXXX1859". The `(?:^|[^\w])` prefix stops this from
 * false-matching a bare 4-digit amount ("Rs.1859.00") while still catching the
 * masked-account forms that arrive without any keyword.
 */
const MASKED_LAST_FOUR_PATTERN = /(?:^|[^\w])[x*]{1,6}\s*(\d{4})(?![A-Za-z0-9])/i;

function matchBankCanonical(body: string): string {
  for (const { regex, canonical } of BANK_ALIAS_ENTRIES) {
    if (regex.test(body)) return canonical;
  }
  return 'unknown';
}

function extractAccountKind(body: string): AccountType {
  if (CREDIT_CARD_PATTERN.test(body)) return 'credit_card';
  if (BANK_ACCOUNT_PATTERN.test(body)) return 'bank';
  return 'upi';
}

function extractLastFour(body: string): string {
  const keywordMatch = body.match(LAST_FOUR_PATTERN);
  if (keywordMatch) return keywordMatch[1];

  const maskMatch = body.match(MASKED_LAST_FOUR_PATTERN);
  if (maskMatch) return maskMatch[1];

  return '';
}

export function normalizeAccountKey(body: string): AccountKey {
  return {
    bankCanonical: matchBankCanonical(body),
    accountKind: extractAccountKind(body),
    lastFour: extractLastFour(body),
    normalizerVersion: ACCOUNT_KEY_NORMALIZER_VERSION,
  };
}

/**
 * Canonical bank id for free text such as an account's user-given name
 * ("HDFC Salary Account" -> 'hdfc'), using the same alias map as SMS bodies.
 * Falls back to 'unknown' when no alias resolves. Pure.
 */
export function bankCanonicalForText(text: string): string {
  return matchBankCanonical(text);
}

/**
 * Stable string form for use as a Map key / DB composite key equality check.
 * Order matches the DB composite key: bank_canonical, account_kind, last_four.
 */
export function accountKeyToString(key: AccountKey): string {
  return `${key.bankCanonical}:${key.accountKind}:${key.lastFour}`;
}

/**
 * D10: the suggestion-decision key recorded when an account is soft-deleted.
 * bank_canonical comes from the account's name via the alias map ('unknown'
 * when nothing resolves), account_kind is the account type, last_four uses
 * the '' sentinel when the account has none. Pure.
 */
export function accountKeyForAccount(account: {
  name: string;
  type: AccountType;
  lastFour: string | null;
}): AccountKey {
  return {
    bankCanonical: bankCanonicalForText(account.name),
    accountKind: account.type,
    lastFour: account.lastFour ?? '',
    normalizerVersion: ACCOUNT_KEY_NORMALIZER_VERSION,
  };
}
