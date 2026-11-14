/**
 * R5e T0 — reader parity: reader v2 sets the same moneyHint the templates do
 * (ATM, wallet top-up, EMI, own-account transfer, interest), so N1 agreement
 * holds and banks without a template get a meaning too. SYNTHETIC inputs
 * only (QA names, XX1234 / XX9999, refs 000000000xxx).
 */
import { readSmsMessage, readSmsWithReader, SmsReadResult } from '../readSms';
import { transactionsAgree } from '../../rules/combineReaders';

const DATE = Date.parse('2026-11-05T05:00:00.000Z');
const reader = (body: string, address: string): SmsReadResult =>
  readSmsWithReader({ id: '51', address, body, date: DATE });
const combined = (body: string, address: string): SmsReadResult =>
  readSmsMessage({ id: '51', address, body, date: DATE });

interface HintCase {
  name: string;
  address: string;
  body: string;
  type: 'expense' | 'income';
  amountMinor: number;
  lastFour: string | null;
  hint: string | undefined;
  counterpartyLastFour?: string;
  counterpartyInstitution?: string;
}

const CASES: HintCase[] = [
  // ---- atm ----
  { name: 'atm: withdrawn at ATM', address: 'AX-KOTAKB-S', body: 'Rs.2,000.00 withdrawn at ATM QA0001 from A/c XX1234 on 05-11-26. Avl Bal Rs.8,000.00', type: 'expense', amountMinor: 200000, lastFour: '1234', hint: 'atm' },
  { name: 'atm: debited for ATM cash withdrawal', address: 'AD-CANBNK-S', body: 'Your A/c XX1234 is debited by Rs.2,500.00 on 05-11-26 for ATM cash withdrawal at QA0003.', type: 'expense', amountMinor: 250000, lastFour: '1234', hint: 'atm' },
  { name: 'atm: unknown bank, cash withdrawal', address: 'AD-QABANK-S', body: 'Cash withdrawal of Rs.3,000.00 from your A/c XX1234 at ATM QA0002 on 05-11-26.', type: 'expense', amountMinor: 300000, lastFour: '1234', hint: 'atm' },
  { name: 'atm negative (U6): "ATM cum Debit Card" purchase stays a spend', address: 'AX-KOTAKB-S', body: 'Rs.500.00 spent using ATM cum Debit Card XX1234 at QA STORE on 03-11-26', type: 'expense', amountMinor: 50000, lastFour: '1234', hint: undefined },
  { name: 'atm negative: a cash deposit credit is not a withdrawal', address: 'AX-KOTAKB-S', body: 'Cash deposit of Rs.2,000.00 at ATM QA0001 credited to A/c XX1234 on 05-11-26.', type: 'income', amountMinor: 200000, lastFour: '1234', hint: undefined },

  // ---- wallet_load ----
  { name: 'wallet: bank debit added to a Paytm wallet', address: 'AD-SBIINB-S', body: 'Rs.500.00 debited from A/c XX1234 on 05-11-26 and added to your Paytm Wallet. Ref 000000000501', type: 'expense', amountMinor: 50000, lastFour: '1234', hint: 'wallet_load', counterpartyInstitution: 'paytm' },
  { name: 'wallet: bank debit for an Amazon Pay balance top-up', address: 'VM-ICICIB-S', body: 'Rs 1,000.00 debited from your A/c XX1234 on 05-11-26 for top-up of Amazon Pay balance. Ref 000000000502', type: 'expense', amountMinor: 100000, lastFour: '1234', hint: 'wallet_load', counterpartyInstitution: 'amazonpay' },
  { name: 'wallet: bank debit loaded to an unknown wallet', address: 'AD-QABANK-S', body: 'Rs.300.00 debited from A/c XX1234 on 05-11-26 to load money to QA wallet.', type: 'expense', amountMinor: 30000, lastFour: '1234', hint: 'wallet_load' },
  { name: "wallet: the wallet's own alert (credit from a bank a/c)", address: 'VM-IPAYTM-S', body: 'Rs.1,000.00 added to your Paytm Wallet from QA Bank A/c XX1234 on 05-11-26. Txn ID 000000000503', type: 'income', amountMinor: 100000, lastFour: null, hint: 'wallet_load', counterpartyLastFour: '1234' },
  { name: 'wallet negative: a payment FROM the wallet is a spend', address: 'VM-IPAYTM-S', body: 'Rs.200.00 paid from your Paytm Wallet to QA STORE on 05-11-26. Txn ID 000000000504', type: 'expense', amountMinor: 20000, lastFour: null, hint: undefined },
  { name: 'wallet negative: "Avl balance" is not a top-up', address: 'AD-SBIINB-S', body: 'Rs 500.00 debited from A/c XX1234 on 05-11-26 to QA PAYEE. Avl balance Rs 2,000.00', type: 'expense', amountMinor: 50000, lastFour: '1234', hint: undefined },

  // ---- emi ----
  { name: 'emi: towards EMI for a loan a/c', address: 'AD-SBIINB-S', body: 'Rs 12,500.00 debited from A/c XX1234 on 05-11-26 towards EMI for Loan A/c XX0099. Avl bal Rs 49,500.00', type: 'expense', amountMinor: 1250000, lastFour: '1234', hint: 'emi' },
  // R5e-FIX K3: the v2 key still names the loan a/c first, but the reader
  // now lands the debit on the bank a/c it left (was '0099' in R5e).
  { name: 'emi: "EMI of Rs … has been debited"', address: 'AD-QABANK-S', body: 'EMI of Rs.8,450.00 for your Loan A/c XX0099 has been debited from your A/c XX1234 on 05-11-26.', type: 'expense', amountMinor: 845000, lastFour: '1234', hint: 'emi' },
  { name: 'emi: loan instalment', address: 'AD-AXISBK-S', body: 'Your A/c XX1234 is debited with Rs.4,200.00 towards loan instalment on 05-11-26.', type: 'expense', amountMinor: 420000, lastFour: '1234', hint: 'emi' },
  { name: 'emi negative: "convert to EMI" advice on a card spend', address: 'AD-SBICRD-S', body: 'Rs.5,000.00 spent on Credit Card XX9999 at QA STORE on 05-11-26. Convert this purchase to EMI in the app.', type: 'expense', amountMinor: 500000, lastFour: '9999', hint: undefined },
  { name: 'emi negative: a "No Cost EMI" purchase is a spend', address: 'AD-SBICRD-S', body: 'Rs.2,000.00 spent on Credit Card XX9999 at QA STORE on No Cost EMI on 05-11-26', type: 'expense', amountMinor: 200000, lastFour: '9999', hint: undefined },

  // ---- transfer (own account) ----
  { name: 'transfer: to your own a/c', address: 'AD-SBIINB-S', body: 'Rs 5,000.00 transferred from A/c XX1234 to your own A/c XX9999 on 05-11-26. Ref 000000000505', type: 'expense', amountMinor: 500000, lastFour: '1234', hint: 'transfer', counterpartyLastFour: '9999' },
  { name: 'transfer: self transfer debit', address: 'AX-KOTAKB-S', body: 'Rs.2,000.00 debited from A/c XX1234 on 05-11-26 for self transfer. UPI Ref 000000000506', type: 'expense', amountMinor: 200000, lastFour: '1234', hint: 'transfer' },
  { name: 'transfer: self transfer credit names the sending a/c', address: 'AX-KOTAKB-S', body: 'Rs.2,000.00 credited to your A/c XX9999 on 05-11-26 by self transfer from A/c XX1234. UPI Ref 000000000507', type: 'income', amountMinor: 200000, lastFour: '9999', hint: 'transfer', counterpartyLastFour: '1234' },
  { name: "transfer negative: another person's a/c", address: 'AD-QABANK-S', body: 'Rs 5,000.00 transferred from A/c XX1234 to QA PAYEE A/c XX9999 on 05-11-26.', type: 'expense', amountMinor: 500000, lastFour: '1234', hint: undefined },
  { name: 'transfer negative: a payee named "Selfie"', address: 'AX-KOTAKB-S', body: 'Rs 500.00 debited from A/c XX1234 on 05-11-26 to QA Selfie Studio. UPI Ref 000000000508', type: 'expense', amountMinor: 50000, lastFour: '1234', hint: undefined },

  // ---- interest ----
  { name: 'interest: "Interest of Rs … credited"', address: 'AD-SBIINB-S', body: 'Interest of Rs 312.00 credited to your A/c XX1234 on 01-11-26.', type: 'income', amountMinor: 31200, lastFour: '1234', hint: 'interest' },
  { name: 'interest: credited towards interest', address: 'VM-ICICIB-S', body: 'Rs.1,045.00 credited to your Savings A/c XX1234 on 01-11-26 towards interest.', type: 'income', amountMinor: 104500, lastFour: '1234', hint: 'interest' },
  { name: 'interest: "Int.Pd" info tail', address: 'AX-KOTAKB-S', body: 'A/c XX1234 credited with Rs 88.00 on 30-09-26. Info: Int.Pd:01-07-26 to 30-09-26', type: 'income', amountMinor: 8800, lastFour: '1234', hint: 'interest' },
  { name: 'interest negative: a rate notice in another sentence', address: 'AD-QABANK-S', body: 'Rs 5,000.00 credited to your A/c XX1234 on 05-11-26 by QA PAYEE. Interest rates revised from 01-12-26.', type: 'income', amountMinor: 500000, lastFour: '1234', hint: undefined },
  { name: 'interest negative: interest DEBITED is not income', address: 'AD-QABANK-S', body: 'Interest of Rs 250.00 debited from your A/c XX1234 on 05-11-26.', type: 'expense', amountMinor: 25000, lastFour: '1234', hint: undefined },
];

describe('R5e T0 — reader moneyHint parity', () => {
  it.each(CASES.map(c => [c.name, c] as const))('%s', (_name, c) => {
    const t = reader(c.body, c.address).transaction;
    expect(t).not.toBeNull();
    // Type / amount / last-4 are never changed by a hint.
    expect(t!.type).toBe(c.type);
    expect(t!.amountMinor).toBe(c.amountMinor);
    expect(t!.lastFour).toBe(c.lastFour);
    expect(t!.moneyHint).toBe(c.hint);
    if (c.counterpartyLastFour) expect(t!.counterpartyLastFour).toBe(c.counterpartyLastFour);
    if (c.counterpartyInstitution) expect(t!.counterpartyInstitution).toBe(c.counterpartyInstitution);
  });

  it('has at least 3 positive cases per hint, plus negatives', () => {
    for (const hint of ['atm', 'wallet_load', 'emi', 'transfer', 'interest']) {
      expect(CASES.filter(c => c.hint === hint).length).toBeGreaterThanOrEqual(3);
    }
    expect(CASES.filter(c => c.hint === undefined).length).toBeGreaterThanOrEqual(10);
  });
});

describe('R5e T0 — N1 agreement with the templates', () => {
  it.each([
    ['sbi interest (template money_kind interest)', 'AD-SBIINB-S', 'Interest of Rs 312.00 credited to your A/c XX1234 on 01Nov26. -SBI', 'interest'],
    ['sbi ATM (template money_kind atm)', 'AD-SBIINB-S', 'Dear Customer, Rs.2,000 withdrawn at QA ATM 0001 from A/c XX1234 on 05Nov26 Txn# 0001. Avl Bal Rs 8,000.', 'atm'],
    ['paytm wallet credit (template money_kind wallet_load)', 'VM-IPAYTM-S', 'Rs.500 added to your Paytm Wallet from HDFC Bank A/c XX1234. Updated Balance: Rs.650', 'wallet_load'],
  ])('%s: reader and template give the same hint, no disagreement', (_name, address, body, hint) => {
    const r = reader(body, address);
    const c = combined(body, address);
    expect(r.transaction!.moneyHint).toBe(hint);
    expect(c.ruleDisagreement).toBeFalsy();
    expect(c.transaction!.moneyHint).toBe(hint);
  });

  it('a moneyHint difference alone is never an N1 disagreement', () => {
    const base = reader('Rs.2,000.00 withdrawn at ATM QA0001 from A/c XX1234 on 05-11-26.', 'AX-KOTAKB-S').transaction!;
    expect(transactionsAgree(base, { ...base, moneyHint: undefined })).toBe(true);
    expect(transactionsAgree(base, { ...base, moneyHint: 'transfer' })).toBe(true);
  });
});
