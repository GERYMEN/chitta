import { NativeModules } from 'react-native';

/**
 * R9a: typed wrapper around the own native `TrackerSecurity` module
 * (android/app/src/main/java/com/tracker/SecurityModule.kt) and the
 * `saveText` SAF method of `TrackerBackup` (BackupModule.kt).
 *
 * No permission: FLAG_SECURE is a window flag; the CSV goes where the user
 * picks in the system "save as" sheet. Nothing is logged here.
 */
interface SecurityNativeModule {
  setSecureScreen(enabled: boolean): Promise<boolean>;
}
interface SaveTextNativeModule {
  saveText(text: string, suggestedName: string, mimeType: string): Promise<SaveTextResult>;
}

export interface SaveTextResult {
  saved: boolean;
  name?: string;
}

const { TrackerSecurity, TrackerBackup } = NativeModules as {
  TrackerSecurity?: SecurityNativeModule;
  TrackerBackup?: Partial<SaveTextNativeModule>;
};

/** Apply FLAG_SECURE live and mirror the pref natively (read at activity create). */
export async function setNativeSecureScreen(enabled: boolean): Promise<void> {
  if (!TrackerSecurity) return;
  await TrackerSecurity.setSecureScreen(enabled).catch(() => false);
}

/** System "save as" for a text file. Resolves {saved:false} when cancelled. */
export async function saveTextFile(
  text: string,
  suggestedName: string,
  mimeType: string = 'text/csv',
): Promise<SaveTextResult> {
  if (!TrackerBackup?.saveText) throw new Error('save unavailable');
  return TrackerBackup.saveText(text, suggestedName, mimeType);
}
