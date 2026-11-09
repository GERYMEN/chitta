import type { TransactionType } from '../../../domain/transactions/transaction.types';
import type { AccountType } from '../../../domain/accounts/account.types';
import { CONFIDENCE_HIGH } from '../../../domain/transactions/transaction.rules';
import { formatRupeesPlain } from '../../../shared/utils/currency';
import { bankCanonicalForText, normalizeAccountKey } from '../normalizeAccountKey';
import { AccountKeyV1, normalizeAccountKeyV1 } from '../legacy/normalizeAccountKeyV1';
import { parseSender, SenderInfo } from './senders';
import { institutionDisplayName, V1_CANONICALS } from './institutions';
import {
  AmountHit,
  bindTransaction,
  BoundTxn,
  digest,
  Direction,
  extractPayee,
  extractReference,
  findAmounts,
  findVerbs,
  hasSalaryToken,
  isAtmCashWithdrawal,
  VerbHit,
} from './extract';

/**
 * R5 — SMS reader v2 (pure TS). Pipeline: sender stage → classifier →
 * extraction → confidence. See ongoing/roadmap/R5-sms-reading-v2.md.
 *
 * Privacy invariant: nothing returned here contains the SMS body or the
 * sender address. Only derived fields leave: amounts, a direction, a payee
 * label, the account last-4, a public institution id, a hashed reference.
 */
export const PARSER_VERSION = 2;

export type SmsLabel =
  | 'txn_debit'
  | 'txn_credit'
  | 'card_spend'
  | 'refund'
  | 'failed'
  | 'otp'
  | 'mandate_future'
  | 'collect_request'
  | 'bill_due'
  | 'statement'
  | 'loan_or_promo'
  | 'balance_info'
  | 'unknown_financial'
  | 'not_financial';

/** Labels that become a pending transaction. */
export const TRANSACTION_LABELS: ReadonlySet<SmsLabel> = new Set([
  'txn_debit',
  'txn_credit',
  'card_spend',
  'refund',
]);

export type NotUnderstoodReason =
  /** A money verb but no transaction amount (only a balance / nothing). */
  | 'no_amount'
  /** An amount but no debit/credit wording. */
  | 'no_direction'
  /** A financial sender, but no shape we know. */
  | 'unknown_format';

export interface SmsInput {
  id: string;
  address: string;
  body: string;
  date: number;
}

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
  /** R5: the class this transaction came from. */
  label?: SmsLabel;
  /** R5: a salary credit (SAL / SALARY / PAYROLL token). */
  salary?: boolean;
  /** R5: FNV-1a digest of the UPI/IMPS/NEFT reference (never the raw ref). */
  refDigest?: string | null;
  /**
   * R5-fix C1: the EXACT key parser v1 produced for this SMS (frozen v1
   * normalizer over the raw body), so decisions and account matches saved
   * under v1 keep routing. Undefined for rows built outside the reader.
   */
  legacyKey?: AccountKeyV1;
}

/** R5b input: a bill / statement message (never inserted as a transaction). */
export interface SmsNonTransaction {
  label: Exclude<SmsLabel, 'txn_debit' | 'txn_credit' | 'card_spend' | 'refund'>;
  /** Total due (bill/statement) or the reported balance, if any. */
  amountMinor: number | null;
  minDueMinor: number | null;
  lastFour: string | null;
}

/** Best guess for "Add as transaction" on a message that was not understood. */
export interface SmsBestGuess {
  type: Exclude<TransactionType, 'transfer'> | null;
  amountMinor: number | null;
  lastFour: string | null;
  occurredAt: string;
}

export interface SmsReadResult {
  label: SmsLabel;
  /** Canonical institution id ('unknown' if none) — public. */
  institution: string;
  senderKind: SenderInfo['kind'];
  transaction: ParsedSmsTransaction | null;
  nonTransaction: SmsNonTransaction | null;
  /** Set when the message should be listed in "Messages not understood". */
  notUnderstood: { reason: NotUnderstoodReason } | null;
}

// ---- class signals -----------------------------------------------------------

const OTP_RE =
  /\b(?:otp|one[\s-]?time[\s-]?password|verification\s+code|security\s+code)\b\s*(?:is|:|-)?\s*[:-]?\s*\d{4,8}\b|\b\d{4,8}\s+is\s+(?:your|the)\s+(?:otp|one[\s-]?time|verification|security)|\botp\b(?:[^.]|\.(?!\s)){0,90}?\bis\s*:?\s*\d{4,8}\b/i;
const OTP_WORD_RE = /\b(?:otp|one[\s-]?time[\s-]?password)\b/i;

const COLLECT_RE =
  /\bhas\s+requested\b|\brequested\s+(?:money|payment|rs|inr|₹)|\brequest(?:ing)?\s+money\b|\bcollect\s+request\b|\bpayment\s+request\b|\bon\s+approv(?:al|ing)\b/i;

const REFUND_RE = /\b(?:refund(?:ed)?|revers(?:al|ed)|chargeback|cash\s*back)\b/i;
/** C6: "Refund of Rs 500 … credited" — a refund even when a debit verb is nearer. */
const REFUND_EXPLICIT_RE =
  /\b(?:refund|reversal|cash\s*back)\s+(?:of\s+)?(?:rs\.?|inr\.?|₹)\s*[\d,]+(?:\.\d{1,2})?[^.]{0,60}?\b(?:credited|refunded|reversed|added)\b/i;

/** U2: a charge / penalty debit is real money out even when it names a failure. */
const CHARGE_RE = /\b(?:charges?|fees?|penalty|penal|bounce)\b/i;

const FAILED_RE =
  /\b(?:failed|declined|unsuccessful|could\s+not\s+be\s+(?:processed|completed)|not\s+(?:been\s+)?(?:processed|completed)|rejected|insufficient\s+(?:funds|balance|bal))\b/i;

const FUTURE_RE =
  /\bwill\s+be\s+(?:auto[\s-]?)?(?:debited|credited|deducted|charged|processed|reversed|refunded|paid|presented)\b|\bshall\s+be\s+debited\b|\b(?:due\s+)?to\s+be\s+(?:auto[\s-]?)?(?:debited|credited|deducted|charged|presented)\b|\bpre[\s-]?debit\b|\bis\s+scheduled\b|\bscheduled\s+(?:for|on)\b|\bupcoming\b|\bdue\s+for\s+debit\b|\bis\s+due\s+(?:on|by)\b/gi;
const MANDATE_RE =
  /\b(?:e-?mandate|mandate|auto[\s-]?pay|standing\s+instruction|nach|si)\b.{0,120}?\b(?:registered|created|set\s*up|activated|scheduled|will)\b/i;

const BILL_RE =
  /\b(?:min(?:imum)?\.?\s*(?:amt|amount)?\s*due|total\s*(?:amt|amount)?\s*due|amount\s+due|payment\s+due|due\s+(?:on|by|date)|is\s+due|bill\s+(?:is\s+)?generated|bill\s+of)\b/i;
const STATEMENT_RE = /\bstatement\b/i;

const PROMO_RE =
  /\b(?:pre[\s-]?approved|eligible|apply\s+now|limit\s+(?:has\s+been\s+)?(?:increased|enhanced|upgraded)|upgrade|offer|t\s*&\s*c|win|congratulations|get\s+up\s+to|instant\s+loan|click|loan\s+of\s+up\s+to)\b/i;

const BALANCE_RE = /\b(?:avl|avail(?:able)?|clear|closing|ledger)?\.?\s*bal(?:ance)?\b/i;

/** Account / card / rail words — required for a transaction from an unknown sender. */
const ACCOUNT_MENTION_RE =
  /\ba\/?c\b|\bacct\b|\baccount\b|\bcard\b|\bupi\b|\bvpa\b|\bwallet\b|\bbank\b|\bimps\b|\bneft\b|\brtgs\b/i;

const CARD_CONTEXT_RE = /\bcredit\s*card\b|\bdebit\s*card\b|\bcard\b/i;

const PAST_VERB_RE =
  /^(?:debited|debit|deducted|withdrawn|withdrawal|withdrew|spent|purchase[ds]?|charged|sent|paid|used|using|txn|transaction|transferred|trfd?|credited|credit|deposited|received|added|reversed|refunded|dr|cr)/i;

// ---- helpers ------------------------------------------------------------------

/**
 * The fraud-help footer ("If not you, call … / SMS BLOCK 1234 to 9…",
 * "Not You? Call …", "Not done by you? …") never supplies a payee, an
 * account or an amount (owner report 2026-11-06: v1 took the payee from
 * "to 9000000000" in that footer). Everything is read from the text before it.
 */
const FOOTER_RE =
  /\b(?:if\s+not\s+(?:you|u|done\s+by\s+you)\b|not\s+you\b|not\s+done\s+by\s+you\b|call\s+(?:us\s+(?:at|on)\s+)?\+?\d|sms\s+block\b|to\s+block\b|report\s+fraud\b)/i;

export function cutFooter(body: string): string {
  const m = FOOTER_RE.exec(body);
  return m ? body.slice(0, m.index).trim() : body;
}

function normalizeBody(body: string): string {
  return cutFooter(body.replace(/\s+/g, ' ').trim());
}

function insideAny(index: number, spans: ReadonlyArray<{ start: number; end: number }>): boolean {
  return spans.some(span => index >= span.start && index < span.end);
}

/** Abbreviations whose trailing '.' is not a sentence end ("Rs. 500", "A/c. no."). */
const ABBREVIATIONS = new Set([
  'rs', 'inr', 'no', 'nos', 'ac', 'a/c', 'acct', 'avl', 'bal', 'ref', 'txn', 'dt', 'info', 'amt',
  'pvt', 'ltd', 'mr', 'ms', 'mrs', 'dr', 'cr', 'st', 'sr', 'int', 'chq', 'vpa', 'upi', 'mob',
]);

function isSentenceBreak(body: string, i: number): boolean {
  const ch = body[i];
  if (ch === '!' || ch === '?' || ch === ';' || ch === '|') return true;
  if (ch !== '.') return false;
  if (i + 1 < body.length && !/\s/.test(body[i + 1])) return false; // "Rs.500", "01.11.26"
  const word = /([A-Za-z/]+)$/.exec(body.slice(Math.max(0, i - 6), i));
  if (word && (word[1].length === 1 || ABBREVIATIONS.has(word[1].toLowerCase()))) return false;
  return true;
}

/**
 * The sentence(s) holding the bound transaction (verb + amount). Footer /
 * advisory sentences ("Never share your OTP", "Beware of collect requests")
 * lie outside it.
 */
function coreOf(body: string, bound: BoundTxn): string {
  let start = Math.min(bound.verb.start, bound.amount.start);
  let end = Math.max(bound.verb.end, bound.amount.end);
  while (start > 0 && !isSentenceBreak(body, start - 1)) start--;
  while (end < body.length && !isSentenceBreak(body, end)) end++;
  return body.slice(start, end);
}

function futureSpans(body: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  FUTURE_RE.lastIndex = 0;
  for (let m = FUTURE_RE.exec(body); m; m = FUTURE_RE.exec(body)) {
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

/**
 * Account key, keeping v1 keys stable: a v1 bank name in the body wins
 * (v1 used the body only); otherwise a known sender's institution; otherwise
 * a v2-only body alias; otherwise 'unknown'.
 */
function bankCanonicalFor(body: string, sender: SenderInfo): string {
  const fromBody = bankCanonicalForText(body);
  if (V1_CANONICALS.has(fromBody)) return fromBody;
  if (sender.kind === 'known') return sender.institution;
  return fromBody;
}

const SENDER_PRIOR: Record<SenderInfo['kind'], number> = {
  known: 15,
  unknown_dlt: 5,
  promo: 0,
  personal: 0,
  other: 0,
};

/** Unknown senders never reach the top tier on wording alone. */
const SENDER_CAP: Record<SenderInfo['kind'], number> = {
  known: CONFIDENCE_HIGH,
  unknown_dlt: 85,
  promo: 0,
  personal: 0,
  other: 80,
};

/** C9: the ceiling for any parse that is not clean (see scoreConfidence). */
export const UNCERTAIN_CAP = 85;

interface ConfidenceSignals {
  sender: SenderInfo;
  bound: BoundTxn;
  hasLastFour: boolean;
  hasMerchant: boolean;
  hasReference: boolean;
  salary: boolean;
}

/**
 * Recomputed from signals (R5 T1e). Integer amounts are NOT penalised. The
 * ceiling stays CONFIDENCE_HIGH (90) = SMS_PARSER_MAX_CONFIDENCE.
 */
export function scoreConfidence(signals: ConfidenceSignals): number {
  const { sender, bound } = signals;
  let score = 30 + SENDER_PRIOR[sender.kind];
  if (sender.kind === 'unknown_dlt' && (sender.suffix === 'T' || sender.suffix === 'S')) score += 5;
  score += bound.distance <= 40 ? 20 : 10;
  score += bound.amount.prefixed ? 10 : 5;
  if (signals.hasLastFour) score += 10;
  if (signals.hasMerchant) score += 10;
  if (signals.hasReference) score += 5;
  let cap = SENDER_CAP[sender.kind];
  if (sender.kind === 'unknown_dlt' && (sender.suffix === 'T' || sender.suffix === 'S')) cap = 88;
  // C9: only a CLEAN parse reaches the top tier (= the default auto-approve
  // threshold, 90): known sender + verb within 40 chars of a currency-prefixed
  // amount + account last-4 + payee. Anything uncertain stays at <= 85.
  const clean =
    sender.kind === 'known' &&
    bound.distance <= 40 &&
    bound.amount.prefixed &&
    signals.hasLastFour &&
    signals.hasMerchant;
  if (!clean) cap = Math.min(cap, UNCERTAIN_CAP);
  // A salary credit from a known sender with an account is clean on its own.
  if (signals.salary && sender.kind === 'known' && signals.hasLastFour) {
    return CONFIDENCE_HIGH;
  }
  return Math.min(score, cap);
}

function labelForBound(bound: BoundTxn, body: string, sender: SenderInfo): SmsLabel {
  if (bound.verb.direction === 'credit') return 'txn_credit';
  if (isAtmCashWithdrawal(body)) return 'txn_debit'; // cash withdrawal at an ATM
  const card = sender.institutionKind === 'card' || CARD_CONTEXT_RE.test(body);
  return card ? 'card_spend' : 'txn_debit';
}

function firstAmount(amounts: AmountHit[], role: AmountHit['role']): number | null {
  return amounts.find(a => a.role === role)?.minor ?? null;
}

function nonTransaction(
  label: SmsNonTransaction['label'],
  amounts: AmountHit[],
  lastFour: string | null,
): SmsNonTransaction {
  const amountMinor =
    label === 'balance_info'
      ? firstAmount(amounts, 'balance')
      : firstAmount(amounts, 'due') ?? firstAmount(amounts, 'txn');
  return { label, amountMinor, minDueMinor: firstAmount(amounts, 'min_due'), lastFour };
}

// ---- entry ---------------------------------------------------------------------

/**
 * Full read of one SMS: its class, plus a transaction (txn classes), a typed
 * non-transaction (bill/statement/balance/…), or a "not understood" reason.
 */
export function readSmsMessage(msg: SmsInput): SmsReadResult {
  const sender = parseSender(msg.address);
  const body = normalizeBody(msg.body ?? '');
  const base = { institution: sender.institution, senderKind: sender.kind };
  const result = (
    label: SmsLabel,
    extra: Partial<Pick<SmsReadResult, 'transaction' | 'nonTransaction' | 'notUnderstood' | 'institution'>> = {},
  ): SmsReadResult => ({
    ...base,
    label,
    transaction: null,
    nonTransaction: null,
    notUnderstood: null,
    ...extra,
  });

  // a) Sender stage: promotional headers and personal numbers are dropped.
  if (sender.kind === 'promo' || sender.kind === 'personal' || body === '') {
    return result('not_financial');
  }

  const key = normalizeAccountKey(body);
  const lastFour = key.lastFour === '' ? null : key.lastFour;
  const institution = sender.kind === 'known' ? sender.institution : bankCanonicalForText(body);
  const amounts = findAmounts(body);
  const verbs = findVerbs(body);
  const bound = bindTransaction(amounts, verbs);
  const knownSender = sender.kind === 'known';
  const accountMention = ACCOUNT_MENTION_RE.test(body);
  const nt = (label: SmsNonTransaction['label']) =>
    result(label, { institution, nonTransaction: nonTransaction(label, amounts, lastFour) });

  // b) Classifier — targeted classes instead of blanket reject words.
  // U1: with a STRONG bound transaction verb, OTP / collect / failed / promo
  // wording only counts inside the transaction's own sentence (footers and
  // advisories elsewhere never drop a completed transaction).
  const future = futureSpans(body);
  const core = bound ? coreOf(body, bound) : body;
  // C5: a future marker in the transaction's own sentence makes it a notice.
  const coreIsFuture = bound != null && futureSpans(core).length > 0;
  const boundIsPast =
    bound != null &&
    !coreIsFuture &&
    !insideAny(bound.verb.start, future) &&
    PAST_VERB_RE.test(body.slice(bound.verb.start, bound.verb.end));
  const markerText = boundIsPast && !bound!.verb.weak ? core : body;

  if (OTP_RE.test(markerText) || (OTP_WORD_RE.test(body) && !bound)) return nt('otp');
  if (COLLECT_RE.test(markerText)) return nt('collect_request');

  // C6: refund / reversal only when the BOUND verb is a credit (or an explicit
  // "refund of Rs X … credited") — never flips a bound debit into income.
  const refund =
    boundIsPast &&
    REFUND_RE.test(body) &&
    (bound!.verb.direction === 'credit' || REFUND_EXPLICIT_RE.test(body));
  // U2: "… return charges debited …" is a real debit even with failure words.
  const chargeDebit = boundIsPast && bound!.verb.direction === 'debit' && CHARGE_RE.test(core);
  if (!refund && !chargeDebit && FAILED_RE.test(markerText)) return nt('failed');

  if (bound && !boundIsPast) return nt('mandate_future');

  if (bound && boundIsPast) {
    // Promotional copy that merely mentions "credited" (loan offers) — no account, no txn.
    if (PROMO_RE.test(markerText) && lastFour == null && !refund) return nt('loan_or_promo');
    // Unknown senders need an account / card / rail mention to count.
    if (!knownSender && !accountMention) return result('not_financial');
    const label: SmsLabel = refund ? 'refund' : labelForBound(bound, body, sender);
    return result(label, {
      institution,
      // U11: a card issuer's own sender (OneCard, SBI Card…) never means a UPI handle.
      transaction: buildTransaction(
        msg,
        body,
        sender,
        bound,
        label,
        key.accountKind === 'upi' && sender.institutionKind === 'card' ? 'credit_card' : key.accountKind,
        lastFour,
      ),
    });
  }

  // No bound past-tense transaction.
  if (BILL_RE.test(body)) return nt(STATEMENT_RE.test(body) ? 'statement' : 'bill_due');
  if (STATEMENT_RE.test(body) && amounts.length > 0) return nt('statement');
  if (future.length > 0 || MANDATE_RE.test(body)) return nt('mandate_future');
  if (PROMO_RE.test(body)) return nt('loan_or_promo');
  if (BALANCE_RE.test(body) && amounts.some(a => a.role === 'balance')) return nt('balance_info');

  const txnAmounts = amounts.filter(a => a.role === 'txn');
  const financial = knownSender
    ? amounts.length > 0 || verbs.length > 0
    : verbs.some(v => !v.weak) && accountMention && amounts.length > 0;
  if (!financial) return result('not_financial');

  const reason: NotUnderstoodReason =
    verbs.length > 0 && txnAmounts.length === 0
      ? 'no_amount'
      : txnAmounts.length > 0 && verbs.length === 0
      ? 'no_direction'
      : 'unknown_format';
  return result('unknown_financial', { institution, notUnderstood: { reason } });
}

function buildTransaction(
  msg: SmsInput,
  body: string,
  sender: SenderInfo,
  bound: BoundTxn,
  label: SmsLabel,
  accountKind: AccountType,
  lastFour: string | null,
): ParsedSmsTransaction {
  // C6: 'refund' is only labelled for a bound credit or an explicit "refund of Rs X credited".
  const direction: Direction = label === 'refund' ? 'credit' : bound.verb.direction;
  const type: TransactionType = direction === 'credit' ? 'income' : 'expense';
  const extracted = extractPayee(body, direction);
  // "withdrawn at <bank> banking point" — the bank itself is not a payee.
  const payee = extracted && bankCanonicalForText(extracted) !== 'unknown' ? null : extracted;
  const merchantName = payee ?? 'Unknown';
  const reference = extractReference(body);
  const salary = label === 'txn_credit' && hasSalaryToken(body);
  const bankCanonical = bankCanonicalFor(body, sender);
  const amountMinor = bound.amount.minor;
  const confidenceScore = scoreConfidence({
    sender,
    bound,
    hasLastFour: lastFour != null,
    hasMerchant: payee != null,
    hasReference: reference != null,
    salary,
  });
  return {
    type,
    amountMinor,
    merchantName,
    occurredAt: new Date(msg.date).toISOString(),
    confidenceScore,
    sanitizedPreview: `${type === 'expense' ? 'Debited' : 'Credited'} ${formatRupeesPlain(
      amountMinor,
    )} — ${merchantName}`,
    // UNCHANGED from v1 (sms-<id>-<date>): re-scans must dedupe against
    // items v1 already recorded. The reference only feeds `refDigest`.
    sourceReferenceHash: `sms-${msg.id}-${msg.date}`,
    bankName: institutionDisplayName(bankCanonical),
    bankCanonical,
    accountKind,
    lastFour,
    label,
    salary,
    refDigest: reference ? digest(reference) : null,
    legacyKey: normalizeAccountKeyV1(msg.body ?? ''),
  };
}

/** Best-effort prefill for "Add as transaction" (computed live, never stored). */
export function bestGuessForSms(msg: SmsInput): SmsBestGuess {
  const body = normalizeBody(msg.body ?? '');
  const amounts = findAmounts(body);
  const verbs = findVerbs(body);
  const bound = bindTransaction(amounts, verbs);
  const amount = bound?.amount ?? amounts.find(a => a.role === 'txn') ?? null;
  const verb: VerbHit | null = bound?.verb ?? verbs.find(v => !v.weak) ?? null;
  const lastFour = normalizeAccountKey(body).lastFour;
  return {
    type: verb ? (verb.direction === 'credit' ? 'income' : 'expense') : null,
    amountMinor: amount?.minor ?? null,
    lastFour: lastFour === '' ? null : lastFour,
    occurredAt: new Date(msg.date).toISOString(),
  };
}
