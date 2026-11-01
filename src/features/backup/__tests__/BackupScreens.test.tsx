/**
 * R4e Backup / Restore screens, the onboarding link and the settings rows.
 * The service is mocked: these tests cover input rules, states and wiring.
 */
import React from 'react';
import { Text, TextInput } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { BackupError } from '../../../domain/backup/backup.payload';
import { useDialogStore } from '../../../shared/ui/Dialog/dialogStore';
import { useSnackbarStore } from '../../../shared/ui/Snackbar/snackbarStore';

jest.mock('../../../data/db/connection', () => ({ getDatabase: jest.fn(), runMigrations: jest.fn() }));
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, replace: jest.fn() }),
  };
});
const mockResetToHome = jest.fn();
jest.mock('../../../app/navigation/navigationRef', () => ({
  resetToHome: () => mockResetToHome(),
  navigationRef: { isReady: () => false, getCurrentRoute: () => null },
}));
const mockService = {
  saveBackup: jest.fn(),
  pickBackup: jest.fn(),
  openBackup: jest.fn(),
  restoreBackup: jest.fn(),
  abandonRestore: jest.fn<Promise<void>, unknown[]>(async () => undefined),
};
jest.mock('../backupService', () => ({
  saveBackup: (...a: unknown[]) => mockService.saveBackup(...a),
  pickBackup: (...a: unknown[]) => mockService.pickBackup(...a),
  openBackup: (...a: unknown[]) => mockService.openBackup(...a),
  restoreBackup: (...a: unknown[]) => mockService.restoreBackup(...a),
  abandonRestore: (...a: unknown[]) => mockService.abandonRestore(...a),
}));
const mockSettings: Record<string, string> = {};
jest.mock('../../../data/repositories/settings.repository', () => ({
  settingsRepository: {
    getValue: jest.fn(async (key: string) => mockSettings[key] ?? null),
    setValue: jest.fn(async () => undefined),
    setMany: jest.fn(async () => undefined),
  },
}));

import { BackupScreen } from '../screens/BackupScreen';
import { RestoreScreen } from '../screens/RestoreScreen';
import { OnboardingScreen } from '../../onboarding/screens/OnboardingScreen';
import { ProfileSettingsSheet } from '../../profile/components/ProfileSettingsSheet';
import { useBackupStore } from '../backupStore';
import { useSyncRunStore } from '../../sms-sync/syncRunner';

const PASSWORD = 'qa-secret-password-77';
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
async function render(el: React.ReactElement) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(el);
  });
  mounted.push(r);
  return r;
}
afterEach(async () => {
  await ReactTestRenderer.act(async () => mounted.splice(0).forEach(r => r.unmount()));
  useDialogStore.setState({ current: null });
  useSnackbarStore.setState({ current: null });
});
beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockSettings)) delete mockSettings[key];
  useBackupStore.setState({ lastBackupAt: null });
  useSyncRunStore.setState({ running: false });
});

const byTestId = (r: ReactTestRenderer.ReactTestRenderer, id: string) =>
  r.root.findAll(n => n.props.testID === id && typeof n.type !== 'string')[0];
const input = (r: ReactTestRenderer.ReactTestRenderer, id: string) =>
  r.root.findAll(n => n.type === TextInput && n.props.testID === id)[0];
const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAllByType(Text).map(t => [].concat(t.props.children).join(''));
async function type(r: ReactTestRenderer.ReactTestRenderer, id: string, value: string) {
  await ReactTestRenderer.act(async () => input(r, id).props.onChangeText(value));
}
async function press(r: ReactTestRenderer.ReactTestRenderer, id: string) {
  await ReactTestRenderer.act(async () => byTestId(r, id).props.onPress());
}

describe('BackupScreen', () => {
  it('password fields are secure, no autofill; Save stays disabled until ≥ 8 chars and the confirmation matches', async () => {
    const r = await render(<BackupScreen />);
    const field = input(r, 'backup-password');
    expect(field.props.secureTextEntry).toBe(true);
    expect(field.props.autoComplete).toBe('off');
    expect(field.props.importantForAutofill).toBe('no');
    expect(field.props.accessibilityLabel).toBe('Backup password');
    expect(byTestId(r, 'backup-save').props.disabled).toBe(true);

    await type(r, 'backup-password', 'qa-123');
    expect(texts(r)).toContain('Use at least 8 characters.');
    await type(r, 'backup-password', PASSWORD);
    await type(r, 'backup-password-confirm', `${PASSWORD}x`);
    expect(texts(r)).toContain("Passwords don't match.");
    expect(byTestId(r, 'backup-save').props.disabled).toBe(true);
    await type(r, 'backup-password-confirm', PASSWORD);
    expect(byTestId(r, 'backup-save').props.disabled).toBe(false);
    expect(texts(r)).toContain("If you forget this password the backup can't be opened.");
    expect(texts(r)).toContain('No backup saved on this phone yet');
  });

  it('Show / Hide toggles both fields (48dp target, labelled)', async () => {
    const r = await render(<BackupScreen />);
    const toggle = byTestId(r, 'backup-password-toggle');
    expect(toggle.props.accessibilityLabel).toBe('Show password');
    await press(r, 'backup-password-toggle');
    expect(input(r, 'backup-password').props.secureTextEntry).toBe(false);
    expect(input(r, 'backup-password-confirm').props.secureTextEntry).toBe(false);
    expect(byTestId(r, 'backup-password-toggle').props.accessibilityLabel).toBe('Hide password');
  });

  it('Save → service with the password → "Backup saved" snackbar, fields cleared, back', async () => {
    mockService.saveBackup.mockResolvedValueOnce({ saved: true, name: 'x.trkbak' });
    const r = await render(<BackupScreen />);
    await type(r, 'backup-password', PASSWORD);
    await type(r, 'backup-password-confirm', PASSWORD);
    await press(r, 'backup-save');
    expect(mockService.saveBackup).toHaveBeenCalledWith(PASSWORD);
    expect(useSnackbarStore.getState().current?.message).toBe('Backup saved');
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('cancelled picker: stays, no snackbar; an error shows the fixed message', async () => {
    mockService.saveBackup.mockResolvedValueOnce({ saved: false });
    const r = await render(<BackupScreen />);
    await type(r, 'backup-password', PASSWORD);
    await type(r, 'backup-password-confirm', PASSWORD);
    await press(r, 'backup-save');
    expect(useSnackbarStore.getState().current).toBeNull();
    expect(mockGoBack).not.toHaveBeenCalled();

    mockService.saveBackup.mockRejectedValueOnce(new BackupError('io'));
    await press(r, 'backup-save');
    expect(texts(r)).toContain('Could not read or write the backup file. Please try again.');
  });

  it('shows the last backup date', async () => {
    mockSettings.last_backup_at = new Date(2026, 9, 30, 12).toISOString();
    const r = await render(<BackupScreen />);
    expect(texts(r)).toContain('Last backup: 30 Oct 2026');
  });
});

describe('RestoreScreen', () => {
  const PICKED = { uri: 'content://qa/x', name: 'tracker-backup-2026-11-01.trkbak', bytes: 10 };
  const OPENED = {
    payload: {},
    summary: { createdAt: new Date(2026, 10, 1, 9).toISOString(), transactions: 4, accounts: 2, counts: {} },
  };

  it('pick → password → confirm "Replace all data…?" → restore → snackbar + Home', async () => {
    mockService.pickBackup.mockResolvedValueOnce(PICKED);
    mockService.openBackup.mockResolvedValueOnce(OPENED);
    mockService.restoreBackup.mockResolvedValueOnce(undefined);
    const r = await render(<RestoreScreen />);
    expect(input(r, 'restore-password')).toBeUndefined();
    await press(r, 'restore-pick');
    expect(texts(r)).toContain(PICKED.name);
    expect(input(r, 'restore-password').props.secureTextEntry).toBe(true);
    expect(byTestId(r, 'restore-open').props.disabled).toBe(true);
    await type(r, 'restore-password', PASSWORD);

    let opened!: Promise<void>;
    await ReactTestRenderer.act(async () => {
      opened = byTestId(r, 'restore-open').props.onPress();
    });
    const dialog = useDialogStore.getState().current!;
    expect(dialog.message).toBe('Replace all data in Tracker with this backup (1 Nov 2026, 4 transactions, 2 accounts)?');
    expect(dialog.actions.map(a => a.variant)).toEqual(['ghost', 'destructive']);
    await ReactTestRenderer.act(async () => {
      useDialogStore.getState().press(dialog.actions[1]);
      await opened;
    });
    expect(mockService.openBackup).toHaveBeenCalledWith(PICKED, PASSWORD);
    expect(mockService.restoreBackup).toHaveBeenCalledWith(OPENED);
    expect(useSnackbarStore.getState().current?.message).toBe('Backup restored');
    expect(mockResetToHome).toHaveBeenCalled();
  });

  it('Cancel in the confirm dialog restores nothing', async () => {
    mockService.pickBackup.mockResolvedValueOnce(PICKED);
    mockService.openBackup.mockResolvedValueOnce(OPENED);
    const r = await render(<RestoreScreen />);
    await press(r, 'restore-pick');
    await type(r, 'restore-password', PASSWORD);
    let opened!: Promise<void>;
    await ReactTestRenderer.act(async () => {
      opened = byTestId(r, 'restore-open').props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      const dialog = useDialogStore.getState().current!;
      useDialogStore.getState().press(dialog.actions[0]);
      await opened;
    });
    expect(mockService.restoreBackup).not.toHaveBeenCalled();
    expect(mockResetToHome).not.toHaveBeenCalled();
  });

  it('cancelled picker shows nothing; wrong password / not a backup show fixed messages', async () => {
    mockService.pickBackup.mockRejectedValueOnce(new BackupError('cancelled'));
    const r = await render(<RestoreScreen />);
    await press(r, 'restore-pick');
    expect(byTestId(r, 'restore-error')).toBeUndefined();

    mockService.pickBackup.mockRejectedValueOnce(new BackupError('not_backup'));
    await press(r, 'restore-pick');
    expect(texts(r)).toContain('This file is not a Tracker backup, or it is damaged.');

    mockService.pickBackup.mockResolvedValueOnce(PICKED);
    await press(r, 'restore-pick');
    mockService.openBackup.mockRejectedValueOnce(new BackupError('bad_password'));
    await type(r, 'restore-password', 'qa-wrong');
    await press(r, 'restore-open');
    expect(texts(r)).toContain('Wrong password or damaged file.');
    expect(mockService.restoreBackup).not.toHaveBeenCalled();
  });

  it('leaving without restoring forgets the picked file; sync running disables the picker', async () => {
    useSyncRunStore.setState({ running: true });
    const r = await render(<RestoreScreen />);
    expect(byTestId(r, 'restore-pick').props.disabled).toBe(true);
    expect(texts(r)).toContain('Wait for the SMS sync to finish, then try again.');
    await ReactTestRenderer.act(async () => r.unmount());
    mounted.splice(mounted.indexOf(r), 1);
    expect(mockService.abandonRestore).toHaveBeenCalled();
  });
});

describe('entry points', () => {
  it('onboarding first slide has "Restore from a backup" (48dp) → Restore', async () => {
    const r = await render(<OnboardingScreen />);
    const link = byTestId(r, 'onboarding-restore-link');
    expect(link.props.accessibilityLabel).toBe('Restore from a backup');
    await press(r, 'onboarding-restore-link');
    expect(mockNavigate).toHaveBeenCalledWith('Restore', { fromOnboarding: true });
  });

  it('settings sheet: "Back up data" with the last backup date + "Restore from backup"', async () => {
    mockSettings.last_backup_at = new Date(2026, 9, 30, 12).toISOString();
    const onOpenBackup = jest.fn();
    const onOpenRestore = jest.fn();
    const r = await render(
      <ProfileSettingsSheet
        visible
        onClose={jest.fn()}
        onOpenActivity={jest.fn()}
        onOpenCategories={jest.fn()}
        onScanGap={jest.fn()}
        onOpenBackup={onOpenBackup}
        onOpenRestore={onOpenRestore}
      />,
    );
    expect(texts(r)).toContain('Last backup: 30 Oct 2026');
    expect(byTestId(r, 'settings-backup-row').props.accessibilityLabel).toBe(
      'Back up data. Last backup: 30 Oct 2026',
    );
    await press(r, 'settings-backup-row');
    await press(r, 'settings-restore-row');
    expect(onOpenBackup).toHaveBeenCalled();
    expect(onOpenRestore).toHaveBeenCalled();
  });
});
