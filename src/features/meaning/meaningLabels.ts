import type { Account, AccountType } from '../../domain/accounts/account.types';
import { accountDisplayLabel } from '../../domain/accounts/account.rules';
import type { Transaction } from '../../domain/transactions/transaction.types';
import type {
  MeaningKind,
  MeaningRule,
  MeaningSide,
  MeaningSuggestion,
  MeaningTarget,
} from '../../domain/meaning/meaning.types';
import {
  candidateFromSuggestion,
  resolveMeaningTarget,
  targetAccountTypes,
} from '../../domain/meaning/meaning.rules';
import { redactLast4 } from '../../shared/privacy/redaction';
import { institutionDisplayName } from '../sms-sync/parser/institutions';
import { bankOfAccount } from '../sms-sync/moneyMeaning';

/**
 * R5e T3 — every string the meaning card and the "Automatic money rules"
 * list show. Pure (no React); account last-4 go through redactLast4 so the
 * feedback screenshot masks them like everywhere else.
 */

const CHIP: Record<MeaningKind, string> = {
  card_payment: 'Card bill payment',
  atm: 'Cash withdrawal',
  wallet_load: 'Wallet top-up',
  transfer: 'Transfer to own account',
};

export function meaningChipLabel(
  kind: MeaningKind,
  side: MeaningSide = 'out',
): string {
  if (kind === 'transfer' && side === 'in') return 'Transfer from own account';
  return CHIP[kind];
}

/** One line under the chip: why this is not an expense. */
export function meaningExplainer(kind: MeaningKind, side: MeaningSide): string {
  if (kind === 'card_payment') {
    return side === 'out'
      ? 'Paying the card bill repeats spends already counted on the card.'
      : 'This payment came from one of your accounts — not income.';
  }
  if (kind === 'atm')
    return 'Cash moved from your bank to your wallet — not spent yet.';
  if (kind === 'wallet_load') {
    return side === 'out'
      ? 'Money moved into your wallet — not spent yet.'
      : 'Your wallet was loaded from your bank — not income.';
  }
  return 'Money moved between your own accounts.';
}

export interface AddAccountPrefill {
  name: string;
  type: AccountType;
  lastFour: string | null;
}

/** "Add <credit card ••9999 | Cash | Paytm> account" + the AddAccount prefill. */
export function missingAccountAction(
  suggestion: Pick<
    MeaningSuggestion,
    'kind' | 'bankCanonical' | 'counterpartyKey'
  >,
  accountId: string,
): { label: string; prefill: AddAccountPrefill } {
  const c = candidateFromSuggestion(suggestion, accountId);
  const bank =
    c.bankCanonical !== 'unknown'
      ? institutionDisplayName(c.bankCanonical)
      : '';
  const four = c.counterpartyLastFour ?? null;
  if (c.kind === 'atm')
    return {
      label: 'Add Cash account',
      prefill: { name: 'Cash', type: 'cash', lastFour: null },
    };
  if (c.kind === 'card_payment' && c.side === 'out') {
    return {
      label: four
        ? `Add credit card ••${redactLast4(four)} account`
        : 'Add credit card account',
      prefill: {
        name: `${bank ? `${bank} ` : ''}Credit Card`,
        type: 'credit_card',
        lastFour: four,
      },
    };
  }
  if (c.kind === 'wallet_load' && c.side === 'out') {
    const wallet = c.counterpartyInstitution
      ? institutionDisplayName(c.counterpartyInstitution)
      : null;
    return {
      label: wallet ? `Add ${wallet} account` : 'Add wallet account',
      prefill: { name: wallet ?? 'Wallet', type: 'other', lastFour: null },
    };
  }
  // The other own account (a transfer, or the bank behind a card / wallet credit).
  return {
    label: four ? `Add account ••${redactLast4(four)}` : 'Add account',
    prefill: {
      name: c.kind === 'transfer' && bank ? `${bank} account` : 'Bank account',
      type: 'bank',
      lastFour: four,
    },
  };
}

export type MeaningAction =
  | { kind: 'confirm'; target: Account }
  | { kind: 'choose' }
  | { kind: 'add'; prefill: AddAccountPrefill };

export interface MeaningCardModel {
  side: MeaningSide;
  chip: string;
  explainer: string;
  resolved: MeaningTarget;
  action: MeaningAction;
  primaryLabel: string;
  primaryA11y: string;
  /** "It's an expense" (out) / "It's income" (in). */
  secondaryLabel: string;
  pickerTypes: ReadonlyArray<AccountType>;
}

/**
 * The card for one OPEN suggestion, re-resolved LIVE against the current
 * accounts and rules (so "Add account" → back resolves the target).
 */
export function meaningCardModel(
  suggestion: MeaningSuggestion,
  transaction: Pick<Transaction, 'accountId' | 'type'>,
  accounts: ReadonlyArray<Account>,
  rules: ReadonlyArray<MeaningRule>,
): MeaningCardModel {
  const candidate = candidateFromSuggestion(suggestion, transaction.accountId);
  const side = candidate.side;
  const resolved = resolveMeaningTarget(
    candidate,
    accounts,
    rules,
    bankOfAccount,
  );
  const target = resolved.target
    ? accounts.find(a => a.id === resolved.target) ?? null
    : null;
  const pickerTypes = targetAccountTypes(suggestion.kind, side);
  const direction = side === 'out' ? 'to' : 'from';
  let action: MeaningAction;
  let primaryLabel: string;
  let primaryA11y: string;
  if (target) {
    const label = accountDisplayLabel(target);
    action = { kind: 'confirm', target };
    primaryLabel = `Confirm transfer ${direction} ${label}`;
    primaryA11y = `Confirm transfer ${direction} ${label}`;
  } else if (resolved.reason === 'ambiguous') {
    action = { kind: 'choose' };
    primaryLabel = 'Choose account';
    primaryA11y = `Choose the account the money moved ${direction}`;
  } else {
    const missing = missingAccountAction(suggestion, transaction.accountId);
    action = { kind: 'add', prefill: missing.prefill };
    primaryLabel = missing.label;
    primaryA11y = missing.label;
  }
  return {
    side,
    chip: meaningChipLabel(suggestion.kind, side),
    explainer: meaningExplainer(suggestion.kind, side),
    resolved,
    action,
    primaryLabel,
    primaryA11y,
    secondaryLabel: side === 'out' ? "It's an expense" : "It's income",
    pickerTypes,
  };
}

export const AUTOMATIC_NEXT_TIME = 'Do this automatically next time';

/** R5e-FIX M5 (R3b.1): why an expense with linked refunds is not offered a transfer. */
export const REFUND_LINKED_NOTE =
  'This expense has a linked refund, so it stays an expense. Unlink the refund first to record it as a transfer.';

/** Snackbar after a confirm (the action slot is Undo). */
export function confirmedSnackbarText(
  target: Pick<Account, 'name' | 'lastFour' | 'deletedAt'> | undefined,
  remembered: boolean,
  side: MeaningSide = 'out',
): string {
  const base = `Recorded as a transfer ${
    side === 'out' ? 'to' : 'from'
  } ${accountDisplayLabel(target)}`;
  return remembered ? `${base} · next time automatically` : base;
}

/** Settings → "Automatic money rules": "Axis · Card bill payment · ••9999 → QA Axis Credit Card ••••9999". */
export function meaningRuleLabel(
  rule: MeaningRule,
  accounts: ReadonlyArray<Account>,
): string {
  const c = candidateFromSuggestion(rule, '');
  const bank = institutionDisplayName(rule.bankCanonical);
  const counterparty = c.counterpartyLastFour
    ? `••${redactLast4(c.counterpartyLastFour)}`
    : c.counterpartyLastDigits
    ? `••${redactLast4(c.counterpartyLastDigits)}`
    : c.counterpartyInstitution
    ? institutionDisplayName(c.counterpartyInstitution)
    : null;
  const parts = [
    bank,
    meaningChipLabel(rule.kind, c.side),
    ...(counterparty ? [counterparty] : []),
  ];
  const target = accounts.find(a => a.id === rule.targetAccountId);
  return `${parts.join(' · ')} → ${accountDisplayLabel(target)}`;
}
