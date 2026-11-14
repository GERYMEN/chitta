/**
 * R5e-FIX P1–P5 + K3 — reader hints look only at the transaction's own
 * clause (word boundaries; fees, FD/RD maturity, promo / advice text never
 * add a meaning), and an EMI debit that names both a loan a/c and the
 * owner's bank a/c lands on the bank a/c. A hint never changes type /
 * amount; only K3 moves a last-4 (the loan a/c is never the owner's a/c).
 * SYNTHETIC inputs only (QA names, XX1234 / XX7777 / XX0099).
 */
import { readSmsMessage, readSmsWithReader, SmsReadResult } from '../readSms';
import { normalizeAccountKey } from '../../normalizeAccountKey';

const DATE = Date.parse('2026-11-05T05:00:00.000Z');
const SBI = 'AD-SBIINB-S';
const QA = 'AD-QABANK-S';
const reader = (body: string, address: string): SmsReadResult =>
  readSmsWithReader({ id: '61', address, body, date: DATE });
const combined = (body: string, address: string): SmsReadResult =>
  readSmsMessage({ id: '61', address, body, date: DATE });

interface Case {
  name: string;
  address: string;
  body: string;
  type: 'expense' | 'income';
  amountMinor: number;
  lastFour: string | null;
  hint: string | undefined;
}

const CASES: Case[] = [
  // ---- P1: FD / RD maturity, "interest free", loan offers are not interest postings ----
  { name: 'P1 FD maturity proceeds (principal and interest)', address: SBI, body: 'Rs.105,000.00 credited to A/c XX1234 on 05-11-26 towards FD maturity proceeds principal and interest', type: 'income', amountMinor: 10500000, lastFour: '1234', hint: undefined },
  { name: 'P1 FD matured, including interest', address: SBI, body: 'FD XX7777 matured. Rs.105,000.00 credited to A/c XX1234 on 05-11-26 including interest', type: 'income', amountMinor: 10500000, lastFour: '1234', hint: undefined },
  { name: 'P1 RD closure (principal + interest)', address: QA, body: 'Rs.60,000.00 credited to A/c XX1234 on 05-11-26 on closure of RD XX7777 (principal + interest)', type: 'income', amountMinor: 6000000, lastFour: '1234', hint: undefined },
  { name: 'P1 a narration "LOAN INTEREST" on an ordinary credit', address: QA, body: 'Rs.5,000.00 credited to A/c XX1234 on 05-11-26 by NEFT from QA PAYEE LOAN INTEREST', type: 'income', amountMinor: 500000, lastFour: '1234', hint: undefined },
  { name: 'P1 kept: interest credited', address: SBI, body: 'Interest of Rs 312.00 credited to your A/c XX1234 on 01-11-26.', type: 'income', amountMinor: 31200, lastFour: '1234', hint: 'interest' },
  { name: 'P1 kept: credited towards interest', address: 'VM-ICICIB-S', body: 'Rs.1,045.00 credited to your Savings A/c XX1234 on 01-11-26 towards interest.', type: 'income', amountMinor: 104500, lastFour: '1234', hint: 'interest' },
  { name: 'P1 kept: Int.Pd info tail', address: 'AX-KOTAKB-S', body: 'A/c XX1234 credited with Rs 88.00 on 30-09-26. Info: Int.Pd:01-07-26 to 30-09-26', type: 'income', amountMinor: 8800, lastFour: '1234', hint: 'interest' },

  // ---- P2: ATM fees are charges, not cash withdrawals ----
  { name: 'P2 ATM annual maintenance charges', address: SBI, body: 'Rs.21.00 debited from A/c XX1234 on 05-11-26 as ATM annual maintenance charges', type: 'expense', amountMinor: 2100, lastFour: '1234', hint: undefined },
  { name: 'P2 ATM txn charges beyond free limit', address: SBI, body: 'Rs.23.60 debited from A/c XX1234 on 05-11-26 for ATM txn charges beyond free limit', type: 'expense', amountMinor: 2360, lastFour: '1234', hint: undefined },
  { name: 'P2 kept: withdrawn at ATM', address: 'AX-KOTAKB-S', body: 'Rs.2,000.00 withdrawn at ATM QA0001 from A/c XX1234 on 05-11-26. Avl Bal Rs.8,000.00', type: 'expense', amountMinor: 200000, lastFour: '1234', hint: 'atm' },

  // ---- P3: an ATM footer in another sentence never makes a UPI payment a withdrawal ----
  { name: 'P3 "Withdraw cash from any ATM" footer', address: SBI, body: 'Rs.200.00 debited from A/c XX1234 on 05-11-26 UPI to QA PAYEE. Withdraw cash from any ATM', type: 'expense', amountMinor: 20000, lastFour: '1234', hint: undefined },
  { name: 'P3 ", use ATM for cash" advice clause', address: QA, body: 'Rs.200.00 debited from A/c XX1234 on 05-11-26 to QA PAYEE, use ATM for cash', type: 'expense', amountMinor: 20000, lastFour: '1234', hint: undefined },
  { name: 'P3 kept: ATM cash withdrawal', address: 'AD-CANBNK-S', body: 'Your A/c XX1234 is debited by Rs.2,500.00 on 05-11-26 for ATM cash withdrawal at QA0003.', type: 'expense', amountMinor: 250000, lastFour: '1234', hint: 'atm' },

  // ---- P4: "to Self Help Group" / "from Self Employed" are payees ----
  { name: 'P4 to Self Help Group', address: SBI, body: 'Rs.800.00 debited from A/c XX1234 on 05-11-26 to Self Help Group QA SHG', type: 'expense', amountMinor: 80000, lastFour: '1234', hint: undefined },
  { name: 'P4 from Self Employed payer', address: SBI, body: 'Rs.800.00 credited to A/c XX1234 on 05-11-26 from Self Employed QA PAYEE', type: 'income', amountMinor: 80000, lastFour: '1234', hint: undefined },
  { name: 'P4 to self-service kiosk', address: QA, body: 'Rs.800.00 debited from A/c XX1234 on 05-11-26 to self-service kiosk QA STORE', type: 'expense', amountMinor: 80000, lastFour: '1234', hint: undefined },
  { name: 'P4 kept: self transfer', address: 'AX-KOTAKB-S', body: 'Rs.2,000.00 debited from A/c XX1234 on 05-11-26 for self transfer. UPI Ref 000000000506', type: 'expense', amountMinor: 200000, lastFour: '1234', hint: 'transfer' },
  { name: 'P4 kept: "to self" ends the phrase', address: QA, body: 'Rs.2,000.00 debited from A/c XX1234 on 05-11-26 to self. UPI Ref 000000000509', type: 'expense', amountMinor: 200000, lastFour: '1234', hint: 'transfer' },

  // ---- P5: advice / promo clauses never add a wallet / transfer / EMI meaning ----
  { name: 'P5 ", add money to wallet and earn cashback"', address: SBI, body: 'Rs.200.00 debited from A/c XX1234 on 05-11-26 to QA PAYEE, add money to wallet and earn cashback', type: 'expense', amountMinor: 20000, lastFour: '1234', hint: undefined },
  { name: 'P5 ", from your own account never share OTP"', address: SBI, body: 'Rs.200.00 debited from A/c XX1234 on 05-11-26 to QA PAYEE, from your own account never share OTP', type: 'expense', amountMinor: 20000, lastFour: '1234', hint: undefined },
  { name: 'P5 ", pay via EMI at just Rs 900"', address: 'AD-SBICRD-S', body: 'Rs.5,000.00 spent on Card XX1234 at QA STORE on 05-11-26, pay via EMI at just Rs 900', type: 'expense', amountMinor: 500000, lastFour: '1234', hint: undefined },
  { name: 'P5 "EMI available at 0% cost"', address: SBI, body: 'Rs.5,000.00 debited from A/c XX1234 on 05-11-26 to QA PAYEE EMI available at 0% cost', type: 'expense', amountMinor: 500000, lastFour: '1234', hint: undefined },
  { name: 'P5 kept: added to your Paytm Wallet', address: SBI, body: 'Rs.500.00 debited from A/c XX1234 on 05-11-26 and added to your Paytm Wallet. Ref 000000000501', type: 'expense', amountMinor: 50000, lastFour: '1234', hint: 'wallet_load' },
  { name: 'P5 kept: to your own a/c', address: SBI, body: 'Rs 5,000.00 transferred from A/c XX1234 to your own A/c XX9999 on 05-11-26. Ref 000000000505', type: 'expense', amountMinor: 500000, lastFour: '1234', hint: 'transfer' },
  { name: 'P5 kept: towards EMI for a loan a/c', address: SBI, body: 'Rs 12,500.00 debited from A/c XX1234 on 05-11-26 towards EMI for Loan A/c XX0099. Avl bal Rs 49,500.00', type: 'expense', amountMinor: 1250000, lastFour: '1234', hint: 'emi' },

  // ---- K3: the EMI debit names the loan a/c first; the money left the bank a/c ----
  { name: 'K3 EMI of Rs … for your Loan A/c … debited from your A/c', address: QA, body: 'EMI of Rs.8,450.00 for your Loan A/c XX0099 has been debited from your A/c XX1234 on 05-11-26.', type: 'expense', amountMinor: 845000, lastFour: '1234', hint: 'emi' },
  { name: 'K3 loan a/c instalment debited from a/c', address: SBI, body: 'Instalment of Rs.4,200.00 towards Loan Account XX0099 debited from A/c XX1234 on 05-11-26.', type: 'expense', amountMinor: 420000, lastFour: '1234', hint: 'emi' },
];

describe('R5e-FIX — reader hints from the transaction clause only (P1–P5) and the EMI bank a/c (K3)', () => {
  it.each(CASES.map(c => [c.name, c] as const))('%s', (_name, c) => {
    for (const result of [reader(c.body, c.address), combined(c.body, c.address)]) {
      const t = result.transaction;
      expect(t).not.toBeNull();
      expect(t!.type).toBe(c.type);
      expect(t!.amountMinor).toBe(c.amountMinor);
      expect(t!.lastFour).toBe(c.lastFour);
      expect(t!.moneyHint).toBe(c.hint);
    }
  });

  it('K3 leaves the v2/v3 account key itself unchanged (only the reader picks the bank a/c)', () => {
    const body = 'EMI of Rs.8,450.00 for your Loan A/c XX0099 has been debited from your A/c XX1234 on 05-11-26.';
    expect(normalizeAccountKey(body).lastFour).toBe('0099');
  });
});
