/**
 * R6 T3/T4 — the bank-SMS row, the difference and the three actions.
 * SYNTHETIC data (QA names, XX1234). Real accounts store + fake db.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { BalanceReconcile } from '../BalanceReconcile';
import { useTransactionsStore } from '../../../transactions/state/transactionsStore';
import { useDialogStore } from '../../../../shared/ui';
import { getDatabase } from '../../../../data/db/connection';
import { createFakeDb, FakeDb } from '../../../../test/fakeDb';
import { rowToAccount } from '../../../../data/mappers/account.mapper';
import { calculateBalance } from '../../../../domain/accounts/account.rules';
import { reconcileBalance } from '../../../../domain/accounts/accountReconcile';
import { setRedacted } from '../../../../shared/privacy/redaction';

jest.mock('../../../../data/db/connection', () => ({ getDatabase: jest.fn(), runMigrations: jest.fn() }));
const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;

const SMS_AT = Date.parse('2026-11-10T10:00:00.000Z');
const NOW = new Date('2026-11-10T12:00:00.000Z');
const row = (over: Record<string, unknown> = {}) => ({
  id: 'acc-1', name: 'QA Bank', type: 'bank', last_four: '1234', opening_balance_minor: 100000, currency: 'INR',
  is_active: 1, balance_anchor_minor: null, balance_anchor_at: null, deleted_at: null,
  sms_balance_minor: 90000, sms_balance_at: SMS_AT, sms_balance_dismissed_at: null,
  created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', ...over,
});

let db: FakeDb;
const onAddMissing = jest.fn();
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

function setup(over: Record<string, unknown> = {}) {
  db = createFakeDb({ accounts: [row(over)] });
  mockGetDatabase.mockReturnValue(db as never);
  useTransactionsStore.setState({ accounts: [rowToAccount(row(over) as never)], transactions: [] } as never);
}
const account = () => useTransactionsStore.getState().accounts[0];

async function render() {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(
      <BalanceReconcile account={account()} transactions={[]} now={NOW} onAddMissing={onAddMissing} />,
    );
  });
  mounted.push(r);
  return r;
}
const find = (r: ReactTestRenderer.ReactTestRenderer, id: string) =>
  r.root.findAll(n => n.props.testID === id && typeof n.type !== 'string');
const host = (r: ReactTestRenderer.ReactTestRenderer, id: string) =>
  find(r, id).find(n => n.props.accessibilityRole === 'button')!;
const text = (r: ReactTestRenderer.ReactTestRenderer) =>
  JSON.stringify(r.toJSON());

afterEach(() => {
  mounted.splice(0).forEach(r => ReactTestRenderer.act(() => r.unmount()));
  jest.clearAllMocks();
  useDialogStore.getState().dismiss();
  setRedacted(false);
  mockGetDatabase.mockReset();
});

describe('BalanceReconcile', () => {
  it('no snapshot -> renders nothing', async () => {
    setup({ sms_balance_minor: null, sms_balance_at: null });
    const r = await render();
    expect(r.toJSON()).toBeNull();
  });

  it('shows "Bank SMS: Rs X as of <time>" and the difference with a direction word', async () => {
    setup();
    const r = await render();
    const t = text(r);
    expect(t).toContain('Bank SMS: ₹900.00 as of 2 h ago');
    expect(t).toContain('Difference ₹100.00');
    expect(t).toContain('Tracker shows more than the bank');
    expect(find(r, 'use-bank-balance-acc-1').length).toBeGreaterThan(0);
  });

  it('reconciled (diff 0): bank row only, no difference, no actions', async () => {
    setup({ sms_balance_minor: 100000 });
    const r = await render();
    expect(text(r)).toContain('Bank SMS');
    expect(find(r, 'balance-difference-acc-1')).toHaveLength(0);
  });

  it('every amount is masked while redacted', async () => {
    setup();
    setRedacted(true);
    const r = await render();
    const t = text(r);
    expect(t).not.toMatch(/900\.00|100\.00/);
    expect(t).toContain('₹ ••••');
  });

  it('action targets are >= 48 dp with button role + label', async () => {
    setup();
    const r = await render();
    for (const id of ['use-bank-balance-acc-1', 'add-missing-acc-1', 'dismiss-difference-acc-1']) {
      const node = host(r, id);
      expect(node.props.accessibilityRole).toBe('button');
      expect(typeof node.props.accessibilityLabel).toBe('string');
      const style = Array.isArray(node.props.style) ? Object.assign({}, ...node.props.style) : node.props.style;
      expect(style.minHeight).toBeGreaterThanOrEqual(48);
    }
  });

  it('Add missing: opens the pre-filled route (|diff|, kind by sign, this account) — records nothing', async () => {
    setup();
    const r = await render();
    const press = host(r, 'add-missing-acc-1').props.onPress;
    await ReactTestRenderer.act(async () => press());
    expect(onAddMissing).toHaveBeenCalledWith({ accountId: 'acc-1', type: 'expense', amountMinor: 10000 });
    expect(db.calls.filter(c => /INSERT INTO transactions/.test(c.sql))).toHaveLength(0);

    // tracked < bank -> income
    setup({ sms_balance_minor: 130000 });
    const r2 = await render();
    const press2 = host(r2, 'add-missing-acc-1').props.onPress;
    await ReactTestRenderer.act(async () => press2());
    expect(onAddMissing).toHaveBeenLastCalledWith({ accountId: 'acc-1', type: 'income', amountMinor: 30000 });
  });

  it('Use bank balance: confirm dialog explains the effect; nothing is written until confirmed', async () => {
    setup();
    const r = await render();
    await ReactTestRenderer.act(async () =>
      host(r, 'use-bank-balance-acc-1').props.onPress(),
    );
    const dialog = useDialogStore.getState().current!;
    expect(dialog).toBeTruthy();
    expect(dialog.message ?? '').toMatch(/will show ₹900\.00 from now/);
    expect(dialog.message ?? '').toMatch(/stay in history/);
    expect(db.calls.filter(c => /UPDATE accounts/.test(c.sql))).toHaveLength(0);
    expect(account().balanceAnchorMinor).toBeNull();

    const before = Date.now();
    await ReactTestRenderer.act(async () => {
      await dialog.actions[1].onPress?.();
    });
    expect(account().balanceAnchorMinor).toBe(90000);
    expect(Date.parse(account().balanceAnchorAt!)).toBeGreaterThanOrEqual(before);
    // The existing anchor now reconciles: tracked == bank.
    expect(calculateBalance(account(), [], 'acc-1')).toBe(90000);
    expect(reconcileBalance(account(), [], 'acc-1')!.diffMinor).toBe(0);
    // Snapshot itself untouched.
    expect(account().smsBalanceMinor).toBe(90000);
  });

  it('Use bank balance is audited by the existing account_updated event (field names only)', async () => {
    setup();
    await useTransactionsStore.getState().applyBankBalance('acc-1');
    const events = db.auditInserts().filter(a => a.row.event_type === 'account_updated');
    expect(events).toHaveLength(1);
    const meta = JSON.parse(String(events[0].row.metadata_json));
    expect(meta).toEqual({
      kind: 'account_updated',
      fields: expect.arrayContaining(['balanceAnchorMinor', 'balanceAnchorAt']),
    });
    expect(String(events[0].row.metadata_json)).not.toMatch(/900|90000|QA Bank|1234/);
  });

  it('applyBankBalance without a snapshot is a no-op', async () => {
    setup({ sms_balance_minor: null, sms_balance_at: null });
    expect(await useTransactionsStore.getState().applyBankBalance('acc-1')).toBe(false);
    expect(account().balanceAnchorMinor).toBeNull();
  });

  it('Dismiss hides the difference for this snapshot only, writes no anchor, and a newer snapshot re-surfaces it', async () => {
    setup();
    const r = await render();
    await ReactTestRenderer.act(async () =>
      host(r, 'dismiss-difference-acc-1').props.onPress(),
    );
    expect(account().smsBalanceDismissedAt).toBe(account().smsBalanceAt);
    expect(account().balanceAnchorMinor).toBeNull();
    const dismissed = await render();
    expect(text(dismissed)).toContain('Bank SMS');
    expect(find(dismissed, 'balance-difference-acc-1')).toHaveLength(0);

    // A newer snapshot (different sms_balance_at) re-surfaces the difference.
    useTransactionsStore.setState(s => ({
      accounts: s.accounts.map(a => ({ ...a, smsBalanceMinor: 80000, smsBalanceAt: '2026-11-10T11:00:00.000Z' })),
    }));
    const again = await render();
    expect(find(again, 'balance-difference-acc-1').length).toBeGreaterThan(0);
    expect(text(again)).toContain('Difference ₹200.00');
  });

  it('a credit card never shows a bank-balance row', async () => {
    setup({ type: 'credit_card' });
    const r = await render();
    expect(r.toJSON()).toBeNull();
  });
});
