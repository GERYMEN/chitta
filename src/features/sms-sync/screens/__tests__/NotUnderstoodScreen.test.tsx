/**
 * R5-fix U10 — "Messages not understood" screen. SYNTHETIC rows / SMS only.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Linking } from 'react-native';
import { NotUnderstoodScreen, notUnderstoodRowLabel } from '../NotUnderstoodScreen';
import { useTransactionsStore } from '../../../transactions/state/transactionsStore';

const T0 = 1793000000000;
// Newest first, as listOpen orders them.
var mockRows = [
  { smsId: '42', smsDate: T0 + 86_400_000, reasonCode: 'no_direction', institution: 'federal', parserVersion: 2, detectedAt: 'x', dismissedAt: null, resolvedAt: null },
  { smsId: '41', smsDate: T0, reasonCode: 'no_direction', institution: 'federal', parserVersion: 2, detectedAt: 'x', dismissedAt: null, resolvedAt: null },
];

jest.mock('../../../../data/db/connection', () => ({ getDatabase: jest.fn(), runMigrations: jest.fn() }));
const mockDismiss = jest.fn(async () => undefined);
jest.mock('../../../../data/repositories/smsUnparsed.repository', () => ({
  smsUnparsedRepository: {
    listOpen: jest.fn(async () => mockRows),
    dismiss: (...a: unknown[]) => mockDismiss(...(a as [])),
    resolveMany: jest.fn(async () => undefined),
  },
}));
const mockPerm = { granted: true, request: 'granted' as string };
jest.mock('../../../../native/android/permissions/smsPermission', () => ({
  checkSmsPermission: jest.fn(async () => mockPerm.granted),
  requestSmsPermission: jest.fn(async () => {
    if (mockPerm.request === 'granted') mockPerm.granted = true;
    return mockPerm.request;
  }),
  checkReceiveSmsPermission: jest.fn(async () => true),
  requestReceiveSmsPermission: jest.fn(async () => 'granted'),
}));
const mockReadById = jest.fn();
jest.mock('../../../../native/android/sms/smsReader', () => ({
  readSmsById: (id: string) => mockReadById(id),
}));
jest.mock('../../../../native/android/feedback/feedbackNative', () => ({
  getFeedbackDeviceInfo: () => ({ versionName: '0.0.0-qa' }),
}));
jest.mock('../../../feedback/feedbackFlow', () => ({ shareFeedback: jest.fn(async () => undefined) }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
async function render() {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(<NotUnderstoodScreen />);
  });
  mounted.push(r);
  return r;
}
const rows = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAll(n => n.props.testID === 'not-understood-row' && typeof n.props.onPress === 'function');
const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root
    .findAll(n => (n.type as unknown) === 'Text')
    .map(n => ([] as unknown[]).concat(n.props.children).join(''));
const button = (r: ReactTestRenderer.ReactTestRenderer, label: string) =>
  r.root.findAll(n => n.props.label === label && typeof n.props.onPress === 'function')[0];
async function press(node: ReactTestRenderer.ReactTestInstance) {
  await ReactTestRenderer.act(async () => {
    await node.props.onPress();
  });
}

beforeEach(() => {
  mockPerm.granted = true;
  mockPerm.request = 'granted';
  mockReadById.mockReset();
  mockDismiss.mockClear();
  mockNavigate.mockClear();
  useTransactionsStore.setState({ transactions: [] });
});
afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});

describe('NotUnderstoodScreen', () => {
  it('row accessibility labels include the date, so two rows of one bank differ', async () => {
    const r = await render();
    const labels = rows(r).map(n => n.props.accessibilityLabel);
    expect(labels).toHaveLength(2);
    expect(labels[0]).not.toBe(labels[1]);
    expect(labels[0]).toBe(notUnderstoodRowLabel(mockRows[0] as never));
    expect(labels[0]).toMatch(/Not sure if money went in or out$/);
  });

  it('a reused SMS id (same id, other date) is never shown — "no longer in your inbox"', async () => {
    mockReadById.mockResolvedValue({ id: '42', address: 'AD-QABANK-S', body: 'QA OTHER MESSAGE', date: T0 + 5 });
    const r = await render();
    await press(rows(r)[0]);
    expect(texts(r).join('|')).toContain('This message is no longer in your inbox.');
    expect(texts(r).join('|')).not.toContain('QA OTHER MESSAGE');
  });

  it('the exact message (same id + date) is shown live', async () => {
    mockReadById.mockResolvedValue({ id: '42', address: 'AD-QABANK-S', body: 'QA LIVE MESSAGE Rs.5.00', date: T0 + 86_400_000 });
    const r = await render();
    await press(rows(r)[0]);
    expect(texts(r).join('|')).toContain('QA LIVE MESSAGE Rs.5.00');
  });

  it('permission denied: explains, offers "Allow SMS access" and retries after the grant', async () => {
    mockPerm.granted = false;
    mockReadById.mockResolvedValue({ id: '42', address: 'AD-QABANK-S', body: 'QA LIVE MESSAGE', date: T0 + 86_400_000 });
    const r = await render();
    await press(rows(r)[0]);
    expect(r.root.findAll(n => n.props.testID === 'not-understood-denied').length).toBeGreaterThan(0);
    await press(button(r, 'Allow SMS access'));
    expect(texts(r).join('|')).toContain('QA LIVE MESSAGE');
  });

  it('permission blocked: Open Settings; "Not a transaction" is always offered', async () => {
    mockPerm.granted = false;
    mockPerm.request = 'never_ask_again';
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined as never);
    const r = await render();
    await press(rows(r)[0]);
    await press(button(r, 'Allow SMS access'));
    expect(open).toHaveBeenCalled();
    expect(button(r, 'Open Settings')).toBeDefined();
    await press(button(r, 'Not a transaction'));
    expect(mockDismiss).toHaveBeenCalledWith('42', T0 + 86_400_000);
    open.mockRestore();
  });
});
