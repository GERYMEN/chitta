/**
 * R5g T4(b) — which R5 fixtures changed hands under N1. Class / type /
 * amount / last-4 of every fixture are still asserted by
 * parser/__tests__/readSms.fixtures.test.ts; this file pins WHO answered.
 */
import { readSmsMessage, readSmsWithReader } from '../../parser/readSms';
import {
  R5D_REVIEW_FIXTURES,
  SMS_FIXTURES,
  V1_REGRESSION_FIXTURES,
} from '../../../../test/fixtures/smsReader.fixture';

const DATE = Date.parse('2026-11-03T05:00:00.000Z');
const SPECIFIC = new Set(['otp', 'mandate_future', 'collect_request', 'bill_due', 'statement', 'loan_or_promo', 'balance_info', 'failed']);

const RULE_AGREEING = [
  'amex: spend (5-digit tail)',
  'axiscard: card payment received',
  'bob: Dr/Cr UPI debit',
  'boi: UPI credit',
  'boi: UPI debit',
  'hdfc: NEFT salary deposit',
  'hdfc: multi-line UPI sent (owner format)',
  'icici: UPI credit',
  'icici: UPI debit with payee credited',
  'icicicard: card payment received',
  'icicicard: spent using card',
  'icicicard: spent using card, "on <date> on MERCHANT ." + footer',
  'kotak: UPI received',
  'refund: failed txn reversal',
  'refund: merchant refund',
  'regression: "debited by 100.0" without Rs prefix',
  'regression: ICICI card: payee never from the SMS-BLOCK footer, kind never UPI',
  'review: card bill paid from a bank a/c (T0e)',
  'review: hdfc UPI credit from VPA',
  'review: hdfc UPI sent (multi-field)',
  'review: hdfc credit card spend',
  'review: icici 3-digit mask credit (T0d)',
  'review: icici 3-digit mask debit (T0d)',
  'review: icici credit card spend',
  'review: kotak UPI received',
  'review: kotak UPI sent',
  'review: reversal of a debit is a refund (T0a)',
  'review: sbi UPI debit unprefixed',
  'sbi: UPI debit, unprefixed amount',
  'sbicard: spend',
  'union: mobile banking debit',
];

it('R5 fixtures: 31 now via an agreeing template, 0 where the reader failed, 0 held', () => {
  const agree: string[] = [];
  const readerFailed: string[] = [];
  const held: string[] = [];
  for (const f of [...SMS_FIXTURES, ...V1_REGRESSION_FIXTURES, ...R5D_REVIEW_FIXTURES]) {
    const msg = { id: '7', address: f.address, body: f.body, date: DATE };
    const reader = readSmsWithReader(msg);
    const combined = readSmsMessage(msg);
    const name = `${f.group}: ${f.name}`;
    if (combined.ruleDisagreement) held.push(name);
    else if (combined.source === 'rule') {
      (reader.transaction || SPECIFIC.has(reader.label) ? agree : readerFailed).push(name);
    }
  }
  expect(agree.sort()).toEqual([...RULE_AGREEING].sort());
  expect(readerFailed).toEqual([]);
  expect(held).toEqual([]);
});
