import React from 'react';
import { Switch } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { RemindMeButton } from '../components/RemindMeButton';
import { NotificationSettingsRows } from '../components/NotificationSettingsRows';
import { useRemindersStore } from '../state/remindersStore';

const mockSettings = jest.fn();
const mockKeys = jest.fn();
jest.mock('../notificationConfig', () => ({
  ...jest.requireActual('../notificationConfig'),
  readNotificationSettings: () => mockSettings(),
  readRemindedKeys: () => mockKeys(),
}));
const mockSetType = jest.fn();
const mockSetKey = jest.fn();
const mockSetDay = jest.fn(async (_day: number) => undefined);
const mockSetHour = jest.fn(async (_hour: number) => undefined);
jest.mock('../notificationSettings', () => ({
  setNotificationType: (...a: unknown[]) => mockSetType(...a),
  setRemindedKey: (...a: unknown[]) => mockSetKey(...a),
  setWeeklyDay: (d: number) => mockSetDay(d),
  setWeeklyHour: (h: number) => mockSetHour(h),
}));
const mockNotAllowed = jest.fn();
jest.mock('../permissionPrompt', () => ({
  showNotificationsNotAllowed: (r: string) => mockNotAllowed(r),
}));

const OFF = { bills: false, recurring: false, weekly: false, weeklyDay: 0, weeklyHour: 9 };
const flush = () => act(async () => { await Promise.resolve(); });

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
afterEach(() => {
  act(() => mounted.splice(0).forEach(r => r.unmount()));
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings.mockResolvedValue(OFF);
  mockKeys.mockResolvedValue([]);
  mockSetType.mockResolvedValue({ ok: true });
  mockSetKey.mockResolvedValue(undefined);
  useRemindersStore.setState({ keys: [] });
});

async function render(el: React.ReactElement) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { r = ReactTestRenderer.create(el); });
  await flush();
  mounted.push(r);
  return r;
}

describe('Remind me? button', () => {
  it('first tap: switches recurring reminders on, saves the series, shows "Reminder on"', async () => {
    mockKeys.mockResolvedValue(['qa streamer']);
    const r = await render(<RemindMeButton merchantKey="qa streamer" displayName="QA Streamer" />);
    const button = r.root.findByProps({ testID: 'remind-me-qa streamer' });
    expect(JSON.stringify(r.toJSON())).toContain('Remind me?');
    await act(async () => { button.props.onPress(); });
    await flush();
    expect(mockSetType).toHaveBeenCalledWith('notif_recurring', true);
    expect(mockSetKey).toHaveBeenCalledWith('qa streamer', true);
    expect(JSON.stringify(r.toJSON())).toContain('Reminder on');
  });

  it('recurring reminders already on: no second permission/toggle step', async () => {
    mockSettings.mockResolvedValue({ ...OFF, recurring: true });
    const r = await render(<RemindMeButton merchantKey="k" displayName="QA" />);
    await act(async () => { r.root.findByProps({ testID: 'remind-me-k' }).props.onPress(); });
    expect(mockSetType).not.toHaveBeenCalled();
    expect(mockSetKey).toHaveBeenCalledWith('k', true);
  });

  it('permission denied: nothing saved, the user is told', async () => {
    mockSetType.mockResolvedValue({ ok: false, reason: 'blocked' });
    const r = await render(<RemindMeButton merchantKey="k" displayName="QA" />);
    await act(async () => { r.root.findByProps({ testID: 'remind-me-k' }).props.onPress(); });
    expect(mockSetKey).not.toHaveBeenCalled();
    expect(mockNotAllowed).toHaveBeenCalledWith('blocked');
  });

  it('tapping a reminded series turns it off', async () => {
    useRemindersStore.setState({ keys: ['k'] });
    const r = await render(<RemindMeButton merchantKey="k" displayName="QA" />);
    await act(async () => { r.root.findByProps({ testID: 'remind-me-k' }).props.onPress(); });
    expect(mockSetKey).toHaveBeenCalledWith('k', false);
    expect(mockSetType).not.toHaveBeenCalled();
  });
});

describe('Notification settings rows', () => {
  it('shows three toggles, all OFF by default, and no weekly day/hour', async () => {
    const r = await render(<NotificationSettingsRows visible />);
    const switches = r.root.findAllByType(Switch);
    expect(switches).toHaveLength(3);
    expect(switches.every(s => s.props.value === false)).toBe(true);
    expect(r.root.findAllByProps({ testID: 'settings-notif-weekly-when' })).toHaveLength(0);
  });

  it('toggling a row calls the setter; a refusal shows the not-allowed message', async () => {
    const r = await render(<NotificationSettingsRows visible />);
    await act(async () => { r.root.findByProps({ testID: 'settings-notif-bills-switch' }).props.onValueChange(true); });
    expect(mockSetType).toHaveBeenCalledWith('notif_bills', true);
    mockSetType.mockResolvedValue({ ok: false, reason: 'denied' });
    await act(async () => { r.root.findByProps({ testID: 'settings-notif-weekly-switch' }).props.onValueChange(true); });
    expect(mockNotAllowed).toHaveBeenCalledWith('denied');
  });

  it('weekly ON shows day and hour chips that call the setters', async () => {
    mockSettings.mockResolvedValue({ ...OFF, weekly: true });
    const r = await render(<NotificationSettingsRows visible />);
    await act(async () => { r.root.findByProps({ testID: 'settings-notif-weekly-day-3' }).props.onPress(); });
    await act(async () => { r.root.findByProps({ testID: 'settings-notif-weekly-hour-18' }).props.onPress(); });
    expect(mockSetDay).toHaveBeenCalledWith(3);
    expect(mockSetHour).toHaveBeenCalledWith(18);
  });
});
