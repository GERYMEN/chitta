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

/**
 * v2 (R5): more banks in the alias map (appended — every v1 alias keeps its
 * v1 result, except "Central Bank of India" and "South Indian Bank", which v1
 * misread as Bank of India / unknown), plus two last-four fallbacks
 * ("ending 1234" without a keyword, and a 5-digit masked card tail → its last
 * 4). Both only fill keys v1 left 'unknown' / ''.
 */
export const ACCOUNT_KEY_NORMALIZER_VERSION = 2;

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
  // v2: must precede 'Bank of India' / 'Indian Bank' (overlapping substrings).
  ['Central Bank of India', 'central'],
  ['South Indian Bank', 'sib'],
  ['Indian Overseas Bank', 'iob'],
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
  // v2 additions (after every v1 alias, so v1 results are unchanged).
  ['Bank of Baroda', 'bob'],
  ['BoB', 'bob'],
  ['Indian Bank', 'indian'],
  ['IOB', 'iob'],
  ['IndusInd Bank', 'indusind'],
  ['IndusInd', 'indusind'],
  ['CSB Bank', 'csb'],
  ['Kerala Gramin Bank', 'kgb'],
  ['Kerala Gramin', 'kgb'],
  ['AU Small Finance Bank', 'au'],
  ['AU Bank', 'au'],
  ['RBL Bank', 'rbl'],
  ['Bandhan Bank', 'bandhan'],
  ['DBS Bank', 'dbs'],
  ['Paytm Payments Bank', 'paytm'],
  ['Paytm', 'paytm'],
  ['Airtel Payments Bank', 'airtel'],
  ['American Express', 'amex'],
  ['Amex', 'amex'],
  ['OneCard', 'onecard'],
  ['Amazon Pay', 'amazonpay'],
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

/**
 * v2 (R5, owner report 2026-11-06): "… Bank Card XX1234 …" (a masked card
 * number with no "credit card" / "card ending" wording) is a card, not UPI.
 * A "Debit Card XX1234" stays with the v1 rules (bank a/c wording → bank,
 * otherwise upi) — v1 never called a debit card a credit card unless it said
 * "card ending".
 */
const MASKED_CARD_PATTERN = /\bcard\s*(?:no\.?\s*)?[x*]{1,8}\s*\d{3,5}\b/i;
const DEBIT_CARD_PATTERN = /\bdebit\s*card\b/i;

/** The v1 account-kind rule, unchanged (legacy decision keys use it). */
export function accountKindV1(body: string): AccountType {
  if (CREDIT_CARD_PATTERN.test(body)) return 'credit_card';
  if (BANK_ACCOUNT_PATTERN.test(body)) return 'bank';
  return 'upi';
}

/** U11: "Acct XX1234" or "A/cX1234" — an account word glued to its mask. */
const V2_BANK_ACCOUNT_PATTERN = /\bacct\b|\ba\/?c\s*[x*#.]+\s*\d{3,4}\b/i;

/** U3: HDFC "On HDFC Bank Card 1234" (an unmasked 4-digit card tail). */
const BANK_CARD_PATTERN = /\bbank\s+card\s*(?:no\.?\s*)?[x*]{0,8}\s*\d{4}\b/i;

function extractAccountKind(body: string): AccountType {
  // U3: a debit card draws on a bank account — never a credit card, even
  // when it says "card ending 1234" (v1's credit-card wording).
  if (DEBIT_CARD_PATTERN.test(body) && !/\bcredit\s*card\b/i.test(body)) return 'bank';
  const v1 = accountKindV1(body);
  if (v1 === 'upi' && (MASKED_CARD_PATTERN.test(body) || BANK_CARD_PATTERN.test(body))) {
    return 'credit_card';
  }
  // U11: "Acct XX1234" / "A/cX1234" (v1 missed both) is a bank account.
  if (v1 === 'upi' && V2_BANK_ACCOUNT_PATTERN.test(body)) return 'bank';
  return v1;
}

/** v2: "ending 1234" / "ending with XX1234" without an account/card keyword. */
const ENDING_LAST_FOUR_PATTERN = /\bending\s*(?:with\s*)?[x*]{0,6}\s*(\d{4})\b/i;

/** v2: a 5-digit masked card tail ("card ** 12345") → its last 4 digits. */
const MASKED_FIVE_PATTERN = /[x*]{2,}\s*\d(\d{4})(?![A-Za-z0-9])/i;

/**
 * R5d T0c: a long mask — mask characters then 5+ digits (SBI
 * "A/C XXXXX123456") → the last 4 of the digit run. Checked after every
 * earlier pattern, so it only fills a key v1 / v2 left ''.
 */
const LONG_MASK_PATTERN = /[x*]+\s*(\d{5,})(?![A-Za-z0-9])/i;

function extractLastFour(body: string): string {
  const keywordMatch = body.match(LAST_FOUR_PATTERN);
  if (keywordMatch) return keywordMatch[1];

  const maskMatch = body.match(MASKED_LAST_FOUR_PATTERN);
  if (maskMatch) return maskMatch[1];

  const endingMatch = body.match(ENDING_LAST_FOUR_PATTERN);
  if (endingMatch) return endingMatch[1];

  const fiveMatch = body.match(MASKED_FIVE_PATTERN);
  if (fiveMatch) return fiveMatch[1];

  const longMatch = body.match(LONG_MASK_PATTERN);
  if (longMatch) return longMatch[1].slice(-4);

  return '';
}

/** R5d T0d: an account/card word, a mask, then exactly 3 digits ("Acct XX888"). */
const LAST_DIGITS_PATTERN = /(?:a\/?c|acct|account|card)[^\d]{0,20}?[x*.#]+\s*(\d{3})(?![A-Za-z0-9])/i;

/**
 * R5d T0d: the 3 visible digits of a 3-digit account mask (ICICI "Acct
 * XX888"), or null. Only when no last-4 was found — it is NOT part of the
 * account key (lastFour stays ''); account matching uses it as a suffix
 * (unique match only).
 */
export function extractLastDigits(body: string): string | null {
  if (extractLastFour(body) !== '') return null;
  const m = LAST_DIGITS_PATTERN.exec(body);
  return m ? m[1] : null;
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
