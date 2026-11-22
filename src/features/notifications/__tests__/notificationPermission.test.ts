import { PermissionsAndroid, Platform } from 'react-native';
import {
  checkNotificationPermission,
  needsRuntimePermission,
  requestNotificationPermission,
} from '../../../native/android/permissions/notificationPermission';

const setApi = (v: number) => Object.defineProperty(Platform, 'Version', { value: v, configurable: true });

describe('notification permission gating', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is a runtime permission only on API 33+', () => {
    expect(needsRuntimePermission(32)).toBe(false);
    expect(needsRuntimePermission(33)).toBe(true);
    expect(needsRuntimePermission(36)).toBe(true);
  });

  it('below API 33 it is granted at install: no dialog is asked', async () => {
    setApi(30);
    const request = jest.spyOn(PermissionsAndroid, 'request');
    expect(await checkNotificationPermission()).toBe(true);
    expect(await requestNotificationPermission()).toBe('granted');
    expect(request).not.toHaveBeenCalled();
  });

  it('API 33+: maps the system answer to granted / denied / blocked', async () => {
    setApi(34);
    const request = jest.spyOn(PermissionsAndroid, 'request');
    request.mockResolvedValueOnce('granted');
    expect(await requestNotificationPermission()).toBe('granted');
    request.mockResolvedValueOnce('denied');
    expect(await requestNotificationPermission()).toBe('denied');
    request.mockResolvedValueOnce('never_ask_again');
    expect(await requestNotificationPermission()).toBe('blocked');
    expect(request).toHaveBeenCalledWith('android.permission.POST_NOTIFICATIONS');
  });

  it('API 33+: check reflects the current grant', async () => {
    setApi(34);
    const check = jest.spyOn(PermissionsAndroid, 'check');
    check.mockResolvedValueOnce(false);
    expect(await checkNotificationPermission()).toBe(false);
    check.mockResolvedValueOnce(true);
    expect(await checkNotificationPermission()).toBe(true);
  });
});
