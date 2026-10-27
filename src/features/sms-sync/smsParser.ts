import { TransactionType } from '../../domain/transactions/transaction.types';
import { CONFIDENCE_HIGH } from '../../domain/transactions/transaction.rules';
import { AccountType } from '../../domain/accounts/account.types';
import { formatRupeesFromMinor } from '../../shared/utils/currency';
import type { SmsMessage } from '../../native/android/sms/smsReader';
import { normalizeAccountKey } from './normalizeAccountKey';

export interface ParsedSmsTransaction {
  type: TransactionType;
  amountMinor: number;
  merchantName: string;
  occurredAt: string;
  confidenceScore: number;
  sanitizedPreview: string;
  sourceReferenceHash: string;
  bankName: string;
  /** Canonical lowercase bank id from `normalizeAccountKey` ('unknown' if none). */
  bankCanonical: string;
  accountKind: AccountType;
  lastFour: string | null;
}

/**
 * v1 heuristic SMS parser (docs/PROJECT.md §14 is the multi-signal classifier;
 * this is a deliberately simpler regex-only first version — NOT that classifier).
 *
 * Privacy invariant: this function must NEVER return `msg.address` or
 * `msg.body`. Only derived, sanitized fields leave this module.
 */

/** Messages matching any of these are discarded as OTP/promotional, not financial. */
const REJECT_PATTERNS: RegExp[] = [
  /\botp\b/i,
  /one\s*time\s*password/i,
  /\bpromo\b/i,
  /\bpromotion\b/i,
  /\bcashback\b/i,
  /\boffer\b/i,
  /\bgrab\b/i,
  /\bgift\b/i,
  /\bwinner\b/i,
  /\bcongratulations\b/i,
  /\bavail\b/i,
  /\bclick\b/i,
];

/** Currency-prefixed amount: `rs`, `rs.`, `inr`, or `₹`, then digits with optional decimals. */
const AMOUNT_PATTERN = /(?:rs\.?|inr|₹)\s*([\d,]+\.?\d{0,2})/i;

const DEBIT_PATTERN = /debited|spent|paid|withdrawn/i;
const CREDIT_PATTERN = /credited|received|deposited/i;

/** Ordered by preference: `at` (card/POS), then `to` (UPI debit), then `from` (credit). */
const MERCHANT_PATTERNS: RegExp[] = [
  /\bat\s+([A-Za-z0-9&.\-_ ]{3,30})/i,
  /\bto\s+([A-Za-z0-9&.\-_ ]{3,30})/i,
  /\bfrom\s+([A-Za-z0-9&.\-_ ]{3,30})/i,
];

/** Leading noise words that mean the captured phrase is not a real merchant. */
const MERCHANT_LEADING_NOISE = new Set([
  'your',
  'my',
  'the',
  'a',
  'an',
  'account',
  'acct',
  'available',
  'avail',
  'balance',
  'bank',
  'via',
  'on',
  'in',
  'with',
  'remaining',
  'total',
  'up',
  'now',
]);

/** Trailing noise keywords that cut a captured merchant phrase short. */
const MERCHANT_STOP_WORDS =
  /\s+(?:on|in|via|for|with|ref|tran|trf|no|card|ac|acct|avail|available|bal|balance)\b/i;

function extractMerchant(body: string): string | null {
  for (const pattern of MERCHANT_PATTERNS) {
    const match = body.match(pattern);
    if (!match) continue;

    let merchant = match[1].trim().replace(/[.,;:!?]+$/, '').trim();
    if (!merchant) continue;

    merchant = merchant.split(MERCHANT_STOP_WORDS)[0].trim();
    if (!merchant) continue;

    const firstWord = merchant.split(/\s+/)[0].toLowerCase();
    if (MERCHANT_LEADING_NOISE.has(firstWord)) continue;

    return merchant;
  }
  return null;
}

/**
 * Human-facing display name for each canonical bank id (`normalizeAccountKey`
 * returns lowercase canonical ids like 'sbi'/'hdfc'; these read awkwardly as
 * suggestion labels, so we map them back to a natural capitalized name).
 * Unknown banks fall through to the established 'Unknown Bank' label.
 */
const BANK_DISPLAY_NAMES: Record<string, string> = {
  hdfc: 'HDFC',
  federal: 'Federal',
  sbi: 'SBI',
  icici: 'ICICI',
  axis: 'Axis',
  kotak: 'Kotak',
  pnb: 'PNB',
  boi: 'Bank of India',
  canara: 'Canara',
  union: 'Union Bank',
  yes: 'Yes Bank',
  idfc: 'IDFC',
  unknown: 'Unknown Bank',
};

function bankDisplayName(canonical: string): string {
  return BANK_DISPLAY_NAMES[canonical] ?? 'Unknown Bank';
}

export function parseSmsMessage(msg: SmsMessage): ParsedSmsTransaction | null {
  if (REJECT_PATTERNS.some(pattern => pattern.test(msg.body))) {
    return null;
  }

  const amountMatch = msg.body.match(AMOUNT_PATTERN);
  if (!amountMatch) {
    return null;
  }

  const rawAmount = amountMatch[1];
  const hadDecimals = rawAmount.includes('.');
  const amountMinor = Math.round(parseFloat(rawAmount.replace(/,/g, '')) * 100);

  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    return null;
  }

  let type: TransactionType;
  if (DEBIT_PATTERN.test(msg.body)) {
    type = 'expense';
  } else if (CREDIT_PATTERN.test(msg.body)) {
    type = 'income';
  } else {
    return null;
  }

  const extractedMerchant = extractMerchant(msg.body);
  const merchantName = extractedMerchant ?? 'Unknown';

  const key = normalizeAccountKey(msg.body);
  const bankName = bankDisplayName(key.bankCanonical);
  const accountKind = key.accountKind;
  const lastFour = key.lastFour === '' ? null : key.lastFour;

  let confidenceScore = CONFIDENCE_HIGH;
  if (merchantName === 'Unknown') {
    confidenceScore = 60;
  }
  if (!hadDecimals) {
    confidenceScore = Math.min(confidenceScore, 40);
  }

  const occurredAt = new Date(msg.date).toISOString();
  const sourceReferenceHash = `sms-${msg.id}-${msg.date}`;
  const sanitizedPreview = `${
    type === 'expense' ? 'Debited' : 'Credited'
  } ${formatRupeesFromMinor(amountMinor)} — ${merchantName}`;

  return {
    type,
    amountMinor,
    merchantName,
    occurredAt,
    confidenceScore,
    sanitizedPreview,
    sourceReferenceHash,
    bankName,
    bankCanonical: key.bankCanonical,
    accountKind,
    lastFour,
  };
}
