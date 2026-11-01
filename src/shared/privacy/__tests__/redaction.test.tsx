import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import {
  REDACTED_AMOUNT,
  REDACTED_LAST4,
  REDACTED_TEXT,
  redactLast4,
  redactText,
  setRedacted,
} from '../redaction';
import { formatRupeesFromMinor, formatRupeesPlain } from '../../utils/currency';
import { AmountText } from '../../ui/AmountText';
import { TransactionRow } from '../../ui/TransactionRow';
import { accountDisplayLabel } from '../../../domain/accounts/account.rules';
import { describeActivity } from '../../../features/activity/activityFeed';
import { refundForLabel } from '../../../features/refunds/refundLabels';
import { duplicateRowLine } from '../../../features/duplicates/duplicateLabels';

function texts(renderer: ReactTestRenderer.ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map(node => {
    const children = node.props.children;
    return Array.isArray(children) ? children.join('') : String(children);
  });
}

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach(renderer => renderer.unmount());
    setRedacted(false);
  });
});

describe('R4c redaction flag', () => {
  it('formatRupeesFromMinor masks every amount while on; formatRupeesPlain never does', () => {
    expect(formatRupeesFromMinor(123456)).toBe('₹1,235');
    setRedacted(true);
    expect(formatRupeesFromMinor(123456)).toBe(REDACTED_AMOUNT);
    expect(formatRupeesFromMinor(-5000, { showPaise: true })).toBe(REDACTED_AMOUNT);
    expect(formatRupeesPlain(123456)).toBe('₹1,235');
    setRedacted(false);
    expect(formatRupeesFromMinor(123456, { showPaise: true })).toBe('₹1,234.56');
  });

  it('text + last-4 helpers', () => {
    expect(redactText('QA-Merchant-01')).toBe('QA-Merchant-01');
    expect(redactLast4('9999')).toBe('9999');
    setRedacted(true);
    expect(redactText('QA-Merchant-01')).toBe(REDACTED_TEXT);
    expect(redactText('')).toBe('');
    expect(redactText(null)).toBeNull();
    expect(redactLast4('9999')).toBe(REDACTED_LAST4);
  });

  it('accountDisplayLabel masks last-4 (active + deleted)', () => {
    const account = { name: 'QA Bank', lastFour: '9999', deletedAt: null };
    expect(accountDisplayLabel(account)).toBe('QA Bank ••••9999');
    setRedacted(true);
    expect(accountDisplayLabel(account)).toBe(`QA Bank ••••${REDACTED_LAST4}`);
    expect(accountDisplayLabel({ ...account, deletedAt: '2026-10-01T00:00:00.000Z' })).not.toContain('9999');
  });

  it('AmountText re-renders masked when the flag flips, and back', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(<AmountText amountMinor={25075} type="expense" />);
    });
    mounted.push(renderer);
    expect(texts(renderer)).toEqual(['-₹251']);
    act(() => setRedacted(true));
    expect(texts(renderer)).toEqual([REDACTED_AMOUNT]);
    act(() => setRedacted(false));
    expect(texts(renderer)).toEqual(['-₹251']);
  });

  it('TransactionRow masks the merchant and the amount', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <TransactionRow
          merchantName="QA-Merchant-07"
          subtitle="Food · Today"
          amountMinor={9900}
          type="income"
          status="approved"
          icon={null}
        />,
      );
    });
    mounted.push(renderer);
    expect(texts(renderer)).toContain('QA-Merchant-07');
    act(() => setRedacted(true));
    const masked = texts(renderer);
    expect(masked).not.toContain('QA-Merchant-07');
    expect(masked).toContain(REDACTED_TEXT);
    expect(masked).toContain(REDACTED_AMOUNT);
    expect(masked.join(' ')).not.toMatch(/₹\d/);
  });

  it('label helpers + Activity mask names', () => {
    setRedacted(true);
    expect(refundForLabel({ merchantName: 'QA-Merchant-02', occurredAt: '2026-10-01T10:00:00.000Z' })).not.toContain(
      'QA-Merchant-02',
    );
    expect(duplicateRowLine({ merchantName: 'QA-Merchant-03', occurredAt: '2026-10-01T10:00:00.000Z' })).not.toContain(
      'QA-Merchant-03',
    );
    const item = describeActivity(
      {
        id: 'e1',
        eventType: 'approved',
        actor: 'user',
        transactionId: 't1',
        accountId: null,
        metadata: null,
        createdAt: '2026-10-01T10:00:00.000Z',
      } as never,
      { transaction: { merchantName: 'QA-Merchant-04', amountMinor: 5000, type: 'expense' } },
      { showAmounts: true, hideNames: true },
    );
    expect(JSON.stringify(item)).not.toContain('QA-Merchant-04');
    expect(JSON.stringify(item)).not.toMatch(/₹\d/);
  });
});
