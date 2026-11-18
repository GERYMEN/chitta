import type { SmsReadResult } from './parser/readSms';
import type { Account } from '../../domain/accounts/account.types';
import type { BillKind } from '../../domain/bills/bill.types';
import type { SmsBillInput } from '../../data/repositories/bill.repository';
import { activeAccounts } from '../../domain/accounts/account.rules';
import { bankCanonicalForText } from './normalizeAccountKey';
import { institutionDisplayName } from './parser/institutions';
import { smsContentHash } from './smsIdentity';

/**
 * R5b (D-d): the SMS non-transaction classes that become OPEN BILLS. A
 * balance_info / otp / collect_request / promo / failed / not_financial never
 * does.
 */
const BILL_CLASSES: ReadonlySet<string> = new Set(['bill_due', 'statement', 'mandate_future']);

function billKindFor(label: string, account: Account | null): BillKind {
  if (label === 'statement') return 'card_statement';
  if (label === 'mandate_future') return 'scheduled_debit';
  // bill_due: a pay-later account's bill vs a generic biller bill.
  if (account?.type === 'pay_later') return 'pay_later';
  return 'biller';
}

/**
 * D-d: map a bill to an account through the existing identity keys (last-4 +
 * bank). A card statement prefers a card / pay-later account; otherwise any
 * active account of the same bank + last-4. No match → null (label from the
 * issuer).
 */
export function matchBillAccount(
  nt: { lastFour: string | null; label: string },
  institution: string,
  accounts: ReadonlyArray<Account>,
): Account | null {
  const active = activeAccounts(accounts);
  const bank = institution && institution !== 'unknown' ? institution : null;
  const sameBankLast4 = active.filter(
    a =>
      a.lastFour != null &&
      nt.lastFour != null &&
      a.lastFour.slice(-4) === nt.lastFour.slice(-4) &&
      (bank == null || bankCanonicalForText(a.name) === bank),
  );
  if (sameBankLast4.length === 0) return null;
  if (nt.label === 'statement') {
    const card = sameBankLast4.find(a => a.type === 'credit_card' || a.type === 'pay_later');
    if (card) return card;
  }
  return sameBankLast4[0];
}

/**
 * Turn a read SMS into an open-bill input (D-d), or null when it is not a
 * bill class, has no amount, or (for a card statement) carries no last-4.
 * `payee` is a known issuer DISPLAY name or the matched account's name — never
 * raw SMS text or a sender number.
 */
export function billInputFromSms(
  read: Pick<SmsReadResult, 'nonTransaction' | 'institution'>,
  msg: { address: string; body: string; date: number },
  salt: string | null,
  accounts: ReadonlyArray<Account>,
): SmsBillInput | null {
  const nt = read.nonTransaction;
  if (!nt || !BILL_CLASSES.has(nt.label)) return null;
  if (nt.amountMinor == null || nt.amountMinor <= 0) return null;
  const account = matchBillAccount(nt, read.institution, accounts);
  const kind = billKindFor(nt.label, account);
  const issuerName =
    read.institution && read.institution !== 'unknown'
      ? institutionDisplayName(read.institution)
      : null;
  const payee = account?.name ?? issuerName ?? 'Bill';
  return {
    accountId: account?.id ?? null,
    kind,
    payee,
    amountDueMinor: nt.amountMinor,
    minDueMinor: nt.minDueMinor,
    statementDate: nt.statementDate ?? null,
    dueDate: nt.dueDate ?? null,
    sourceHash: salt ? smsContentHash(salt, msg) : null,
  };
}
