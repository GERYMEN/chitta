import type { AccountType } from '../../../domain/accounts/account.types';
import { bankCanonicalForText } from '../normalizeAccountKey';
import type { RuleAccountType } from './rules.types';
import { activeRules, CompiledRules } from './rulesLoader';

/**
 * R5g item 22 — issuer `misc_information.get_balance` → "Check balance" on
 * the account screen. A tel: link only: no SMS is ever sent and no new
 * permission is used (the dialer opens; the user places the call). Numbers
 * marked `verified: false` are NOT shown (none are verified yet).
 */

export interface CheckBalanceContact {
  type: 'missed_call' | 'call';
  telUrl: string;
}

const RULE_TYPES: Record<AccountType, ReadonlyArray<RuleAccountType>> = {
  bank: ['bank', 'debit_card'],
  credit_card: ['credit_card'],
  other: ['wallet', 'prepaid', 'pay_later'],
  upi: ['bank'],
  cash: [],
};

const NUMBER_RE = /^\+?\d{3,15}$/;

export function checkBalanceContacts(
  account: { name: string; type: AccountType },
  rules: CompiledRules | null = activeRules(),
): CheckBalanceContact[] {
  if (!rules) return [];
  const institution = bankCanonicalForText(account.name);
  const issuer = rules.issuers.find(i => i.name === institution);
  const wanted = RULE_TYPES[account.type];
  const out: CheckBalanceContact[] = [];
  for (const entry of issuer?.def.misc_information?.get_balance ?? []) {
    if (!wanted.includes(entry.account_type)) continue;
    for (const contact of entry.contact_info) {
      // 'sms' would mean sending an SMS — never offered.
      if (!contact.verified || contact.type === 'sms') continue;
      for (const raw of contact.numbers) {
        const number = raw.replace(/[\s-]/g, '');
        if (NUMBER_RE.test(number)) out.push({ type: contact.type, telUrl: `tel:${number}` });
      }
    }
  }
  return out;
}
