import { AccountType } from '../../../domain/accounts/account.types';

/**
 * R5-fix C1 — FROZEN copy of the v1 (R2 / pre-R5) account-key derivation.
 *
 * DO NOT EDIT. Decision rows ('linked' / 'added' / 'ignored' / 'deleted')
 * saved before the R5 upgrade are keyed by exactly what this function
 * returned for the RAW SMS body (parser v1 called `normalizeAccountKey(msg.body)`
 * with no whitespace folding and no footer cut). Reader v2 derives the same
 * v1 key from the same body with this copy so those decisions keep routing
 * exactly as they did — never a guessed 'unknown' variant.
 *
 * Source: normalizeAccountKey.ts at commit d76ee0e (ACCOUNT_KEY_NORMALIZER_VERSION 1).
 */

export interface AccountKeyV1 {
  bankCanonical: string;
  accountKind: AccountType;
  /** '' sentinel when v1 found none. */
  lastFour: string;
}

const BANK_ALIASES_V1: ReadonlyArray<readonly [string, string]> = [
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

const BANK_ALIAS_ENTRIES_V1 = BANK_ALIASES_V1.map(([alias, canonical]) => ({
  regex: new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i'),
  canonical,
}));

const CREDIT_CARD_PATTERN_V1 = /credit\s*card|card\s+ending|\bcc\b/i;
const BANK_ACCOUNT_PATTERN_V1 = /\ba\/?c\b|\baccount\b|bank\s+a\/?c/i;
const LAST_FOUR_PATTERN_V1 =
  /(?:a\/?c|acct|account|card)[^\d]{0,20}(?:ending\s*)?[x*]{0,6}\s*(\d{4})\b/i;
const MASKED_LAST_FOUR_PATTERN_V1 = /(?:^|[^\w])[x*]{1,6}\s*(\d{4})(?![A-Za-z0-9])/i;

function bankV1(body: string): string {
  for (const { regex, canonical } of BANK_ALIAS_ENTRIES_V1) {
    if (regex.test(body)) return canonical;
  }
  return 'unknown';
}

function kindV1(body: string): AccountType {
  if (CREDIT_CARD_PATTERN_V1.test(body)) return 'credit_card';
  if (BANK_ACCOUNT_PATTERN_V1.test(body)) return 'bank';
  return 'upi';
}

function lastFourV1(body: string): string {
  const keywordMatch = body.match(LAST_FOUR_PATTERN_V1);
  if (keywordMatch) return keywordMatch[1];
  const maskMatch = body.match(MASKED_LAST_FOUR_PATTERN_V1);
  if (maskMatch) return maskMatch[1];
  return '';
}

/** The exact key parser v1 produced for this RAW body. */
export function normalizeAccountKeyV1(rawBody: string): AccountKeyV1 {
  return {
    bankCanonical: bankV1(rawBody),
    accountKind: kindV1(rawBody),
    lastFour: lastFourV1(rawBody),
  };
}

/** `bank:kind:last4` — the v1 decision-key string. */
export function legacyKeyString(key: AccountKeyV1): string {
  return `${key.bankCanonical}:${key.accountKind}:${key.lastFour}`;
}
