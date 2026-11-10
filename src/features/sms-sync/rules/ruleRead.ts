import type { AccountType } from '../../../domain/accounts/account.types';
import { CONFIDENCE_HIGH } from '../../../domain/transactions/transaction.rules';
import { formatRupeesPlain } from '../../../shared/utils/currency';
import { bankCanonicalForText } from '../normalizeAccountKey';
import { normalizeAccountKeyV1 } from '../legacy/normalizeAccountKeyV1';
import { cleanPayee, cleanVpa, toMinor } from '../parser/extract';
import { institutionDisplayName, V1_CANONICALS } from '../parser/institutions';
import type { SenderInfo } from '../parser/senders';
import { refDigestFor, smsContentHash } from '../smsIdentity';
import type {
  MoneyHint,
  NotUnderstoodReason,
  ParsedSmsTransaction,
  SmsInput,
  SmsLabel,
  SmsNonTransaction,
} from '../parser/readSms';
import { resolveRuleDate } from './ruleDates';
import type { RuleAccountType, RuleChainingRule, RuleMoneyKind, RuleRefType } from './rules.types';
import type { RuleEngineResult, RuleRecord } from './rulesEngine';

/**
 * R5g T3 — a rules-engine hit turned into the reader's result shapes.
 * Derived fields only: amounts, a direction, a payee label, last-4, a public
 * institution id, a salted reference digest. Never the body or the sender.
 */

/** Item 23: an event SMS (PNR, reminder…) — parsed, stored nowhere yet. */
export interface SmsEvent {
  eventType: string;
  patternUid: string;
  occursAt: string;
  hasPnr: boolean;
  hasLocation: boolean;
  reminderSpan: string | null;
}

/** Item 21: what sync needs to run a chaining rule for this record. */
export interface RuleChainInfo {
  rule: RuleChainingRule;
  /** The issuer / layer name (parent search stays within it unless a selector says otherwise). */
  issuer: string;
  incomplete: boolean;
  deleted: boolean;
}

export interface RuleRead {
  label: SmsLabel;
  institution: string;
  /** Every transaction record (reparse: up to 3), in order. */
  transactions: ParsedSmsTransaction[];
  nonTransaction: SmsNonTransaction | null;
  notUnderstood: { reason: NotUnderstoodReason } | null;
  event: SmsEvent | null;
  ignoreReason: string | null;
  patternUid: string;
  /** N1: the matched issuer's `format_verified` (template wins outright). */
  formatVerified: boolean;
}

export interface RuleReadContext {
  msg: SmsInput;
  sender: SenderInfo;
  salt: string | null;
  rulesVersion: number;
}

const MONEY_HINTS: Partial<Record<RuleMoneyKind, MoneyHint>> = {
  card_payment: 'card_payment',
  transfer: 'transfer',
  atm: 'atm',
  wallet_load: 'wallet_load',
  emi: 'emi',
  refund: 'refund',
};

const NON_TXN_ACCOUNTS: ReadonlySet<RuleAccountType> = new Set(['loan', 'utility', 'insurance']);
const CARD_ACCOUNTS: ReadonlySet<RuleAccountType> = new Set(['credit_card', 'debit_card']);
const WALLET_ACCOUNTS: ReadonlySet<RuleAccountType> = new Set(['wallet', 'prepaid', 'pay_later']);

/** Item 9: rule account_type → Tracker AccountType (null = non-transaction only). */
export function trackerAccountType(type: RuleAccountType): AccountType | null {
  if (type === 'bank' || type === 'debit_card') return 'bank';
  if (type === 'credit_card') return 'credit_card';
  if (WALLET_ACCOUNTS.has(type)) return 'other';
  return null;
}

/** Item 10: pan → lastFour (4+ digits → last 4) or lastDigits (3 digits with min_digits 3). */
export function panDigits(
  value: string | boolean | undefined,
  minDigits: number | undefined,
): { lastFour: string | null; lastDigits: string | null } {
  const digits = typeof value === 'string' ? value.replace(/\D/g, '') : '';
  if (typeof value !== 'string' || !/^[x*#.\s\d-]*\d$/i.test(value)) return { lastFour: null, lastDigits: null };
  if (digits.length >= 4) return { lastFour: digits.slice(-4), lastDigits: null };
  if (digits.length === 3 && minDigits === 3) return { lastFour: null, lastDigits: digits };
  return { lastFour: null, lastDigits: null };
}

function str(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function amountOf(value: string | boolean | undefined): number | null {
  const s = str(value);
  if (!s || !/^\d[\d,]*(?:\.\d{1,2})?$/.test(s)) return null;
  return toMinor(s);
}

function refTypeOf(record: RuleRecord): RuleRefType | null {
  const rules = record.pattern.def.data_fields.network_reference_id?.type_rule?.rules ?? [];
  const hit = rules.find(r => new RegExp(r.value, 'i').test(record.matched));
  return hit?.ref_type ?? null;
}

function merchantOf(record: RuleRecord): { name: string | null; constant: boolean } {
  const pos = record.pattern.def.data_fields.pos;
  const raw = str(record.fields.pos);
  const constant = raw != null && (pos?.group_id == null || record.typeRule?.pos_override != null);
  if (raw && constant) return { name: raw, constant: true };
  const cleaned = raw ? (raw.includes('@') ? cleanVpa(raw) : cleanPayee(raw)) : null;
  if (cleaned) return { name: cleaned, constant: false };
  const counterparty = str(record.fields.counterparty_name);
  return { name: counterparty ? cleanPayee(counterparty) : null, constant: false };
}

function accountTypeOf(record: RuleRecord): RuleAccountType {
  return record.typeRule?.acc_type_override ?? record.pattern.def.account_type;
}

function moneyKindOf(record: RuleRecord, direction: 'debit' | 'credit'): RuleMoneyKind {
  let kind = (str(record.fields.money_kind) as RuleMoneyKind | undefined) ?? (direction === 'credit' ? 'income' : 'spend');
  // Item 15: income_flag_override false on a credit = not income (a refund).
  const flag = record.posRule?.income_flag_override;
  if (direction === 'credit' && flag === false && kind === 'income') kind = 'refund';
  if (direction === 'credit' && flag === true && kind === 'refund') kind = 'income';
  return kind;
}

/** Item 26: the institution of a rule hit. */
function institutionOf(record: RuleRecord, engine: RuleEngineResult, sender: SenderInfo, body: string): string {
  if (!record.layer.def.scope) return record.layer.name;
  if (engine.issuer) return engine.issuer.name;
  if (sender.kind === 'known') return sender.institution;
  return bankCanonicalForText(body);
}

/** Same rule as readSms `bankCanonicalFor` (v1 body names keep v1 keys stable). */
function bankCanonicalOf(institution: string, body: string, accountType: RuleAccountType): string {
  if (WALLET_ACCOUNTS.has(accountType) && institution !== 'unknown') return institution;
  const fromBody = bankCanonicalForText(body);
  if (V1_CANONICALS.has(fromBody)) return fromBody;
  if (institution !== 'unknown') return institution;
  return fromBody;
}

const SENDER_CAP: Record<SenderInfo['kind'], number> = {
  known: CONFIDENCE_HIGH,
  unknown_dlt: 85,
  other: 80,
  promo: 0,
  personal: 0,
};

/**
 * Pipeline confidence for a template hit: known sender with amount + pan
 * (+ payee, or set_no_pos) → 90; anything less → 85; unknown senders keep
 * the reader's caps (85 / 80).
 */
export function ruleConfidence(input: {
  senderKind: SenderInfo['kind'];
  issuerResolved: boolean;
  hasPan: boolean;
  hasMerchant: boolean;
  setNoPos: boolean;
}): number {
  const kind = input.issuerResolved ? 'known' : input.senderKind;
  const clean = input.hasPan && (input.hasMerchant || input.setNoPos);
  return Math.min(clean ? CONFIDENCE_HIGH : 85, SENDER_CAP[kind]);
}

function transactionLabel(direction: 'debit' | 'credit', kind: RuleMoneyKind, accountType: RuleAccountType): SmsLabel {
  if (direction === 'credit') return kind === 'refund' ? 'refund' : 'txn_credit';
  return CARD_ACCOUNTS.has(accountType) && kind !== 'atm' ? 'card_spend' : 'txn_debit';
}

const BILL_STATEMENTS = new Set(['utility_bill', 'insurance_premium', 'pay_later_bill']);

function nonTransactionLabel(record: RuleRecord): SmsNonTransaction['label'] {
  const p = record.pattern.def;
  if (p.sms_type === 'balance') return 'balance_info';
  if (p.sms_type === 'statement') {
    return BILL_STATEMENTS.has(str(record.fields.statement_type) ?? '') ? 'bill_due' : 'statement';
  }
  if (p.sms_type === 'notice') {
    const notice = str(record.fields.notice_type) ?? '';
    if (notice === 'mandate_future') return 'mandate_future';
    if (notice === 'collect_request') return 'collect_request';
    if (notice === 'promo' || notice === 'loan_offer') return 'loan_or_promo';
    return 'bill_due';
  }
  // A transaction pattern on a loan / utility / insurance account, or create_txn false.
  if (p.sms_type === 'transaction') return p.create_txn === false ? 'balance_info' : 'statement';
  return 'failed';
}

function ignoreLabel(reason: string): SmsLabel {
  if (reason === 'otp') return 'otp';
  if (reason === 'promo') return 'loan_or_promo';
  if (reason === 'not_financial') return 'not_financial';
  return 'failed';
}

function buildTransaction(
  record: RuleRecord,
  index: number,
  ctx: RuleReadContext,
  engine: RuleEngineResult,
  body: string,
): ParsedSmsTransaction | 'foreign' | null {
  const p = record.pattern.def;
  const f = record.fields;
  const direction = f.transaction_type === 'credit' ? 'credit' : f.transaction_type === 'debit' ? 'debit' : null;
  const amountMinor = amountOf(f.amount);
  const accountType = accountTypeOf(record);
  const accountKind = trackerAccountType(accountType);
  if (!direction || amountMinor == null || accountKind == null || p.create_txn === false) return null;
  const currency = (str(f.currency) ?? p.data_fields.currency?.default ?? 'INR').toUpperCase();
  if (currency !== 'INR') return 'foreign';
  const kind = moneyKindOf(record, direction);
  const pan = panDigits(f.pan, p.data_fields.pan?.min_digits);
  const counterparty = panDigits(f.counterparty_pan, p.data_fields.counterparty_pan?.min_digits);
  const merchant = merchantOf(record);
  const setNoPos = p.data_fields.pos?.set_no_pos === true || record.typeRule?.set_no_pos === true;
  const institution = institutionOf(record, engine, ctx.sender, body);
  const bankCanonical = bankCanonicalOf(institution, body, accountType);
  const label = transactionLabel(direction, kind, accountType);
  const type = direction === 'credit' ? 'income' : 'expense';
  const merchantName = merchant.name ?? 'Unknown';
  const dateField = p.data_fields.date;
  const occurredMs = resolveRuleDate(str(f.date), dateField?.formats, ctx.msg.date, dateField?.use_sms_time === true);
  const ref = str(f.network_reference_id);
  const suffix = index === 0 ? '' : `#${index + 1}`;
  const contentHash = ctx.salt ? smsContentHash(ctx.salt, ctx.msg) : null;
  const moneyHint = MONEY_HINTS[kind];
  const category = str(f.category);
  const chaining = p.data_fields.chaining_rule;
  const accountNameOverride = p.account_name_override ?? record.layer.def.account_name_override;
  const setAsExpense = p.set_account_as_expense ?? record.layer.def.set_account_as_expense;
  return {
    type,
    amountMinor,
    merchantName,
    occurredAt: new Date(occurredMs).toISOString(),
    confidenceScore: ruleConfidence({
      senderKind: ctx.sender.kind,
      issuerResolved: engine.issuer != null,
      hasPan: pan.lastFour != null,
      hasMerchant: merchant.name != null,
      setNoPos,
    }),
    sanitizedPreview: `${type === 'expense' ? 'Debited' : 'Credited'} ${formatRupeesPlain(amountMinor)} — ${merchantName}`,
    sourceReferenceHash: `sms-${ctx.msg.id}-${ctx.msg.date}${suffix}`,
    bankName: institutionDisplayName(bankCanonical),
    bankCanonical,
    accountKind,
    lastFour: pan.lastFour,
    label,
    salary: direction === 'credit' && category === 'salary',
    refDigest: ref && ctx.salt ? refDigestFor(ctx.salt, ref) : null,
    ...(contentHash ? { smsContentHash: `${contentHash}${suffix}` } : {}),
    ...(counterparty.lastFour ? { counterpartyLastFour: counterparty.lastFour } : {}),
    ...(pan.lastDigits ? { lastDigits: pan.lastDigits } : {}),
    ...(moneyHint ? { moneyHint } : {}),
    legacyKey: normalizeAccountKeyV1(ctx.msg.body ?? ''),
    source: 'rule',
    patternUid: p.pattern_UID,
    rulesVersion: ctx.rulesVersion,
    moneyKind: kind,
    ...(accountType === 'debit_card' ? { panKind: 'debit_card' as const } : {}),
    ...(refTypeOf(record) ? { refType: refTypeOf(record) as RuleRefType } : {}),
    ...(category && category !== 'salary' ? { categoryHint: category } : {}),
    ...(str(f.category_hint) ? { categoryHint: str(f.category_hint) } : {}),
    ...(accountNameOverride ? { accountNameOverride } : {}),
    ...(setAsExpense ? { setAccountAsExpense: true } : {}),
    ...(setNoPos ? { setNoPos: true } : {}),
    ...(f.recurring === true ? { recurring: true } : {}),
    ...(amountOf(f.account_balance) != null ? { balanceMinor: amountOf(f.account_balance) as number } : {}),
    ...(chaining && f.enable_chaining === true
      ? {
          chain: {
            rule: chaining,
            issuer: record.layer.name,
            incomplete: p.data_fields.incomplete === true,
            deleted: p.data_fields.deleted === true,
          },
        }
      : {}),
  };
}

function eventOf(record: RuleRecord, ctx: RuleReadContext): SmsEvent {
  const f = record.fields;
  const dateField = record.pattern.def.data_fields.date;
  const occurs = resolveRuleDate(str(f.date), dateField?.formats, ctx.msg.date, dateField?.use_sms_time === true);
  return {
    eventType: str(f.event_type) ?? 'event',
    patternUid: record.pattern.def.pattern_UID,
    occursAt: new Date(occurs).toISOString(),
    hasPnr: str(f.pnr) != null,
    hasLocation: str(f.event_location) != null,
    reminderSpan: str(f.event_reminder_span) ?? null,
  };
}

/** Engine records → one rule-side read. Null when nothing matched. */
export function readFromRules(engine: RuleEngineResult, ctx: RuleReadContext): RuleRead | null {
  if (engine.records.length === 0) return null;
  const body = ctx.msg.body ?? '';
  const first = engine.records[0];
  const firstDef = first.pattern.def;
  const base: RuleRead = {
    label: 'not_financial',
    institution: institutionOf(first, engine, ctx.sender, body),
    transactions: [],
    nonTransaction: null,
    notUnderstood: null,
    event: null,
    ignoreReason: null,
    patternUid: firstDef.pattern_UID,
    formatVerified: first.layer.def.format_verified === true,
  };
  let foreign = false;
  const transactions: ParsedSmsTransaction[] = [];
  engine.records.forEach((record, index) => {
    if (record.pattern.def.sms_type !== 'transaction' || record.layer.def.scope === 'any_sender') return;
    const t = buildTransaction(record, index, ctx, engine, body);
    if (t === 'foreign') foreign = foreign || index === 0;
    else if (t) transactions.push(t);
  });

  if (firstDef.sms_type === 'transaction' && transactions.length > 0 && transactions[0].patternUid === firstDef.pattern_UID && !foreign) {
    return { ...base, label: transactions[0].label ?? 'txn_debit', transactions };
  }
  if (
    firstDef.sms_type === 'transaction' &&
    !foreign &&
    firstDef.create_txn !== false &&
    !NON_TXN_ACCOUNTS.has(accountTypeOf(first))
  ) {
    // A transaction template whose fields did not resolve (no amount…): no hit.
    return null;
  }
  if (foreign) {
    // T4(c): non-INR → not understood until R5e (no record).
    return { ...base, label: 'unknown_financial', notUnderstood: { reason: 'foreign_currency' } };
  }
  if (firstDef.sms_type === 'event') return { ...base, label: 'not_financial', event: eventOf(first, ctx) };
  if (firstDef.sms_type === 'ignore') {
    const reason = str(first.fields.ignore_reason) ?? 'failed';
    return { ...base, label: ignoreLabel(reason), ignoreReason: reason };
  }
  const label = nonTransactionLabel(first);
  const f = first.fields;
  const pan = panDigits(f.pan, firstDef.data_fields.pan?.min_digits);
  const amountMinor =
    label === 'balance_info'
      ? amountOf(f.account_balance) ?? amountOf(f.available_limit) ?? amountOf(f.amount)
      : amountOf(f.amount) ?? amountOf(f.outstanding_balance);
  return {
    ...base,
    label,
    transactions: [],
    nonTransaction: {
      label: label as SmsNonTransaction['label'],
      amountMinor,
      minDueMinor: amountOf(f.min_due_amount),
      lastFour: pan.lastFour,
    },
  };
}
