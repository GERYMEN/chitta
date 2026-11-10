/** R5g item 22 — "Check balance" contacts: verified tel: numbers only. */
import bundled from '../rules.json';
import type { RulesDocument } from '../rules.types';
import { compileRules } from '../rulesLoader';
import { checkBalanceContacts } from '../checkBalance';

const doc = bundled as unknown as RulesDocument;

describe('item 22: misc_information.get_balance', () => {
  it('bundled rules have no verified number → nothing is shown', () => {
    expect(checkBalanceContacts({ name: 'HDFC Bank', type: 'bank' }, compileRules(doc))).toEqual([]);
  });

  it('shows verified call / missed-call numbers for the matching account type only; never sms', () => {
    const copy = JSON.parse(JSON.stringify(doc)) as RulesDocument;
    copy.rules.find(r => r.name === 'hdfc')!.misc_information = {
      get_balance: [
        {
          account_type: 'bank',
          contact_info: [
            { type: 'missed_call', numbers: ['1800 000 0000'], verified: true },
            { type: 'call', numbers: ['18000000001'], verified: false },
            { type: 'sms', numbers: ['50000'], verified: true },
          ],
        },
        { account_type: 'credit_card', contact_info: [{ type: 'call', numbers: ['18000000002'], verified: true }] },
      ],
    };
    const rules = compileRules(copy);
    expect(checkBalanceContacts({ name: 'HDFC Bank', type: 'bank' }, rules)).toEqual([
      { type: 'missed_call', telUrl: 'tel:18000000000' },
    ]);
    expect(checkBalanceContacts({ name: 'HDFC Credit Card', type: 'credit_card' }, rules)).toEqual([
      { type: 'call', telUrl: 'tel:18000000002' },
    ]);
    expect(checkBalanceContacts({ name: 'My wallet', type: 'cash' }, rules)).toEqual([]);
  });
});
