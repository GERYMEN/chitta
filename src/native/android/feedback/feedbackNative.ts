import { NativeModules } from 'react-native';

/**
 * R4c: typed wrapper around the own native `TrackerFeedback` module
 * (android/app/src/main/java/com/tracker/FeedbackModule.kt).
 *
 * Privacy: the screenshot lives only in the app cache (cache/feedback/). It is
 * never logged, uploaded or copied by the app; it leaves the device only
 * through the user's own share to WhatsApp (or the chooser fallback).
 */
export interface FeedbackDeviceInfo {
  versionName: string;
  versionCode: number;
  androidRelease: string;
  brand: string;
  model: string;
}

export interface FeedbackScreenshot {
  /** file:// uri, for the in-app thumbnail only. */
  uri: string;
  path: string;
  width: number;
  height: number;
  bytes: number;
}

export type PackageShareResult = 'sent' | 'not_installed';

interface FeedbackNativeModule {
  getConstants?: () => Partial<FeedbackDeviceInfo>;
  versionName?: string;
  versionCode?: number;
  androidRelease?: string;
  brand?: string;
  model?: string;
  captureScreen(): Promise<FeedbackScreenshot>;
  clearScreenshots(): Promise<boolean>;
  deleteScreenshot(path: string): Promise<boolean>;
  shareToPackage(
    packageName: string,
    jid: string,
    text: string,
    path: string | null,
  ): Promise<PackageShareResult>;
  shareChooser(text: string, path: string | null): Promise<'sent'>;
}

const { TrackerFeedback } = NativeModules as { TrackerFeedback?: FeedbackNativeModule };

function nativeModule(): FeedbackNativeModule {
  if (!TrackerFeedback) {
    throw new Error('TrackerFeedback native module is not available on this platform');
  }
  return TrackerFeedback;
}

/** App version + device info (no user data). Safe defaults off-device. */
export function getFeedbackDeviceInfo(): FeedbackDeviceInfo {
  const raw: Partial<FeedbackDeviceInfo> = TrackerFeedback
    ? { ...(TrackerFeedback.getConstants?.() ?? {}), ...pickConstants(TrackerFeedback) }
    : {};
  return {
    versionName: String(raw.versionName ?? ''),
    versionCode: Number(raw.versionCode ?? 0),
    androidRelease: String(raw.androidRelease ?? ''),
    brand: String(raw.brand ?? ''),
    model: String(raw.model ?? ''),
  };
}

function pickConstants(module: FeedbackNativeModule): Partial<FeedbackDeviceInfo> {
  const out: Partial<FeedbackDeviceInfo> = {};
  if (module.versionName !== undefined) out.versionName = module.versionName;
  if (module.versionCode !== undefined) out.versionCode = module.versionCode;
  if (module.androidRelease !== undefined) out.androidRelease = module.androidRelease;
  if (module.brand !== undefined) out.brand = module.brand;
  if (module.model !== undefined) out.model = module.model;
  return out;
}

export function captureScreen(): Promise<FeedbackScreenshot> {
  return nativeModule().captureScreen();
}

/** App start: delete any feedback screenshot left from a previous run. */
export async function clearFeedbackScreenshots(): Promise<void> {
  if (!TrackerFeedback) return;
  await TrackerFeedback.clearScreenshots().catch(() => false);
}

export async function deleteFeedbackScreenshot(path: string): Promise<void> {
  if (!TrackerFeedback) return;
  await TrackerFeedback.deleteScreenshot(path).catch(() => false);
}

export function shareToPackage(
  packageName: string,
  jid: string,
  text: string,
  path: string | null,
): Promise<PackageShareResult> {
  return nativeModule().shareToPackage(packageName, jid, text, path);
}

export function shareChooser(text: string, path: string | null): Promise<'sent'> {
  return nativeModule().shareChooser(text, path);
}
