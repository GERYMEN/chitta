import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { UncategorisedRow } from '../UncategorisedRow';
import { Transaction } from '../../../../domain/transactions/transaction.types';
import { useTransactionsStore } from '../../../transactions/state/transactionsStore';
import { getDatabase } from '../../../../data/db/connection';

jest.mock('../../../../data/db/connection', () => ({
  getDatabase: jest.fn(),
  runMigrations: jest.fn(async () => undefined),
}));

const RAW_BODY = 'QA-RAW-SMS-BODY Rs.50.00 debited';
const SMS_DATE = 1761400000000;
const mockReadSmsById = jest.fn();
jest.mock('../../../../native/android/sms/smsReader', () => ({
  readSmsById: (id: string) => mockReadSmsById(id),
}));
jest.mock('../../../../native/android/permissions/smsPermission', () => ({
  checkSmsPermission: jest.fn(async () => true),
  requestSmsPermission: jest.fn(async () => 'granted'),
}));

const PREVIEW = 'Debited ₹50.00 at QA-Merchant-12 — sanitized';

function tx(id: string, patch: Partial<Transaction>): Transaction {
  return {
    id,
    type: 'expense',
    status: 'pending',
    amountMinor: 5000,
    currency: 'INR',
    merchantName: 'QA-Merchant-12',
    categoryId: 'cat-uncategorised',
    accountId: 'acc-bank',
    paymentMethod: 'other',
    occurredAt: '2026-10-25T10:00:00.000Z',
    detectedAt: '2026-10-25T10:00:00.000Z',
    approvedAt: null,
    note: null,
    sourceType: 'sms',
    sourceReferenceHash: `sms-77-${SMS_DATE}`,
    sanitizedPreview: PREVIEW,
    confidenceScore: 90,
    parserVersion: 'sms-heuristic-v1',
    bulkBatchId: null,
    transferAccountId: null,
    linkedTransactionId: null,
    linkKind: null,
    createdAt: '2026-10-25T10:00:00.000Z',
    updatedAt: '2026-10-25T10:00:00.000Z',
    ...patch,
  };
}

const SMS_ROW = tx('s1', {});
const MANUAL_ROW = tx('m1', {
  merchantName: 'QA-Manual',
  sourceType: 'manual',
  sourceReferenceHash: null,
  sanitizedPreview: null,
  confidenceScore: null,
});
const ACCOUNT = { name: 'QA Delete Bank 9999', lastFour: '9999', deletedAt: null };

async function render(transaction: Transaction, handlers = { onOpen: jest.fn(), onChooseCategory: jest.fn() }) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(
      <UncategorisedRow transaction={transaction} account={ACCOUNT} {...handlers} />,
    );
  });
  return r;
}

const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAllByType(Text).map(t => [].concat(t.props.children).join(''));
const byTestId = (r: ReactTestRenderer.ReactTestRenderer, id: string) =>
  r.root.findAll(n => n.props.testID === id && typeof n.type !== 'string');

beforeEach(() => mockReadSmsById.mockReset());

describe('UncategorisedRow (R3b.1 F2)', () => {
  it('SMS row: merchant, amount, date + account, the SMS description and one "View original SMS" link', async () => {
    const r = await render(SMS_ROW);
    const all = texts(r);
    expect(all).toContain('QA-Merchant-12');
    expect(all).toContain('-₹50.00');
    expect(all.some(t => t.includes('QA Delete Bank 9999 ••••9999') && t.includes('Pending'))).toBe(true);
    expect(all).toContain('SMS description');
    expect(all).toContain(PREVIEW);
    expect(all.filter(t => t === 'View original SMS')).toHaveLength(1);
  });

  it('manual row: no SMS section at all', async () => {
    const r = await render(MANUAL_ROW);
    const all = texts(r);
    expect(all).toContain('QA-Manual');
    expect(all).not.toContain('SMS description');
    expect(all).not.toContain('View original SMS');
    expect(byTestId(r, 'quick-assign-sms')).toHaveLength(0);
  });

  it('the description is 2 lines and expands on tap', async () => {
    const r = await render(SMS_ROW);
    const previewText = () => r.root.findAllByType(Text).find(t => t.props.children === PREVIEW)!;
    expect(previewText().props.numberOfLines).toBe(2);
    await ReactTestRenderer.act(async () => {
      byTestId(r, 'quick-assign-preview')[0].props.onPress();
    });
    expect(previewText().props.numberOfLines).toBeUndefined();
  });

  it('row body opens the item; the chip opens the category picker', async () => {
    const handlers = { onOpen: jest.fn(), onChooseCategory: jest.fn() };
    const r = await render(SMS_ROW, handlers);
    await ReactTestRenderer.act(async () => {
      byTestId(r, 'quick-assign-open')[0].props.onPress();
    });
    expect(handlers.onOpen).toHaveBeenCalledWith(SMS_ROW);
    expect(handlers.onChooseCategory).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => {
      byTestId(r, 'quick-assign-category')[0].props.onPress();
    });
    expect(handlers.onChooseCategory).toHaveBeenCalledWith(SMS_ROW);
  });

  it('"View original SMS" reads live on demand; the raw text is never stored', async () => {
    mockReadSmsById.mockResolvedValue({ id: '77', address: 'AD-QASNDR', body: RAW_BODY, date: SMS_DATE });
    useTransactionsStore.setState({ transactions: [SMS_ROW] });
    const r = await render(SMS_ROW);
    expect(mockReadSmsById).not.toHaveBeenCalled();
    const link = r.root.findAllByType(Text).find(t => t.props.children === 'View original SMS')!;
    await ReactTestRenderer.act(async () => {
      link.props.onPress();
    });
    expect(mockReadSmsById).toHaveBeenCalledWith('77');
    expect(texts(r)).toContain(RAW_BODY); // shown in component state only
    expect(getDatabase).not.toHaveBeenCalled();
    expect(JSON.stringify(useTransactionsStore.getState())).not.toContain('QA-RAW-SMS-BODY');
    // Unmount drops it.
    await ReactTestRenderer.act(async () => {
      r.unmount();
    });
  });
});
