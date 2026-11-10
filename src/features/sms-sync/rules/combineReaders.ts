import { formatRupeesPlain } from '../../../shared/utils/currency';
import { parseSender } from '../parser/senders';
import type {
  ParsedSmsTransaction,
  SmsInput,
  SmsLabel,
  SmsReadOptions,
  SmsReadResult,
} from '../parser/readSms';
import { readFromRules } from './ruleRead';
import { runRulesEngine } from './rulesEngine';
import { activeRules } from './rulesLoader';

/**
 * R5g N1 (owner decision 2026-11-10) — template vs reader. Both run on every
 * SMS (pure, in memory); the reader's own behaviour is unchanged.
 *
 * - No pattern hit → the reader's result, exactly as before.
 * - Pattern hit, reader found no transaction and no specific class
 *   (unknown_financial / not_financial) → the template wins (source 'rule').
 * - Both found a transaction and they AGREE (same type, same paise, same
 *   last-4 when both have one) → the template's richer record (source 'rule').
 * - Anything else with a transaction on either side is a DISAGREEMENT → ONE
 *   pending item with the READER's values (the template's when only it has
 *   one), flagged `ruleDisagreement` = held from auto-approve.
 * - Neither side has a transaction → the reader's class.
 * - An issuer with `format_verified: true` → its template wins outright.
 *
 * The blacklist (item 3) is not a pattern hit: it only turns a reader
 * "unknown / not financial" result into 'otp'.
 */

/** Reader classes that are a real answer (not "could not read it"). */
const SPECIFIC_READER_LABELS: ReadonlySet<SmsLabel> = new Set([
  'otp',
  'mandate_future',
  'collect_request',
  'bill_due',
  'statement',
  'loan_or_promo',
  'balance_info',
  'failed',
]);

/** N1 agreement: same direction/type, same paise, same last-4 when both have one. */
export function transactionsAgree(reader: ParsedSmsTransaction, rule: ParsedSmsTransaction): boolean {
  if (reader.type !== rule.type || reader.amountMinor !== rule.amountMinor) return false;
  if (reader.lastFour != null && rule.lastFour != null && reader.lastFour !== rule.lastFour) return false;
  return true;
}

/** The template record, filling only what it lacks from the agreeing reader. */
function mergeAgreeing(rule: ParsedSmsTransaction, reader: ParsedSmsTransaction): ParsedSmsTransaction {
  const merchantName = rule.merchantName === 'Unknown' && !rule.setNoPos ? reader.merchantName : rule.merchantName;
  const lastFour = rule.lastFour ?? reader.lastFour;
  return {
    ...rule,
    merchantName,
    sanitizedPreview: `${rule.type === 'expense' ? 'Debited' : 'Credited'} ${formatRupeesPlain(rule.amountMinor)} — ${merchantName}`,
    lastFour,
    salary: rule.salary === true || reader.salary === true,
    refDigest: rule.refDigest ?? reader.refDigest ?? null,
    ...(lastFour == null && (rule.lastDigits ?? reader.lastDigits)
      ? { lastDigits: rule.lastDigits ?? reader.lastDigits }
      : {}),
    ...(rule.counterpartyLastFour ?? reader.counterpartyLastFour
      ? { counterpartyLastFour: rule.counterpartyLastFour ?? reader.counterpartyLastFour }
      : {}),
    ...(rule.moneyHint ?? reader.moneyHint ? { moneyHint: rule.moneyHint ?? reader.moneyHint } : {}),
  };
}

export function combineWithRules(
  msg: SmsInput,
  reader: SmsReadResult,
  options: SmsReadOptions = {},
): SmsReadResult {
  const rules = options.rules === undefined ? activeRules() : options.rules;
  const asReader: SmsReadResult = { ...reader, source: 'reader' };
  if (!rules) return asReader;
  const sender = parseSender(msg.address);
  if (sender.kind === 'promo' || sender.kind === 'personal') return asReader;

  const engine = runRulesEngine(rules, {
    header: sender.header,
    senderKind: sender.kind,
    body: msg.body ?? '',
    smsDate: msg.date,
  });
  const readerTxn = reader.transaction;
  const readerFailed = readerTxn == null && !SPECIFIC_READER_LABELS.has(reader.label);

  if (engine.blacklisted) {
    if (!readerFailed) return asReader;
    return {
      ...reader,
      label: 'otp',
      transaction: null,
      notUnderstood: null,
      nonTransaction: { label: 'otp', amountMinor: null, minDueMinor: null, lastFour: null },
      source: 'rule',
      patternUid: null,
    };
  }

  const rule = readFromRules(engine, {
    msg,
    sender,
    salt: options.salt ?? null,
    rulesVersion: rules.version,
  });
  if (!rule) return asReader;

  const ruleTxn = rule.transactions[0] ?? null;
  const ruleResult = (transaction: ParsedSmsTransaction | null = ruleTxn): SmsReadResult => ({
    label: rule.label,
    institution: rule.institution,
    senderKind: reader.senderKind,
    transaction,
    nonTransaction: rule.nonTransaction,
    notUnderstood: rule.notUnderstood,
    source: 'rule',
    patternUid: rule.patternUid,
    extraTransactions: rule.transactions.slice(1),
    event: rule.event,
    ignoreReason: rule.ignoreReason,
  });

  if (rule.formatVerified || readerFailed) return ruleResult();
  if (readerTxn && ruleTxn && transactionsAgree(readerTxn, ruleTxn)) {
    return ruleResult(mergeAgreeing(ruleTxn, readerTxn));
  }
  if (!readerTxn && !ruleTxn) return { ...asReader, patternUid: rule.patternUid };

  // Disagreement with a transaction on at least one side: ONE held item.
  if (readerTxn) {
    return {
      ...asReader,
      transaction: {
        ...readerTxn,
        ruleDisagreement: true,
        patternUid: rule.patternUid,
        rulesVersion: rules.version,
      },
      patternUid: rule.patternUid,
      ruleDisagreement: true,
    };
  }
  return {
    ...ruleResult({ ...(ruleTxn as ParsedSmsTransaction), ruleDisagreement: true }),
    extraTransactions: [],
    ruleDisagreement: true,
  };
}
