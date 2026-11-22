import { NativeModules } from 'react-native';

/**
 * R11: typed wrapper around the own native `TrackerReceipt` module
 * (android/app/src/main/java/com/tracker/ReceiptModule.kt).
 *
 * Receipts use the ANDROID SYSTEM PHOTO PICKER — no runtime permission, no
 * dependency. The picked image is copied into the app sandbox
 * (files/receipts/<name>) and shown through a private FileProvider. The file
 * name is the only thing JS stores; bytes/paths never reach a backup, export,
 * audit row or log. In-app camera capture is deferred (needs CAMERA).
 */
interface ReceiptNativeModule {
  /** Opens the picker, copies the pick; resolves {fileName} or null when cancelled. */
  pickReceipt(transactionId: string): Promise<{ fileName: string } | null>;
  /** content:// uri (private provider) when the file exists, else null. */
  receiptUri(fileName: string): Promise<string | null>;
  deleteReceipt(fileName: string): Promise<boolean>;
}

const { TrackerReceipt } = NativeModules as { TrackerReceipt?: ReceiptNativeModule };

export function receiptsAvailable(): boolean {
  return TrackerReceipt != null;
}

/** Null = cancelled or unavailable. Rejects only on a real failure (E_IO / E_TOO_LARGE). */
export async function pickReceipt(transactionId: string): Promise<string | null> {
  if (!TrackerReceipt) return null;
  const result = await TrackerReceipt.pickReceipt(transactionId);
  return result?.fileName ?? null;
}

/** Null when the file is missing (e.g. after a restore on a new phone) or unavailable. */
export async function receiptUri(fileName: string): Promise<string | null> {
  if (!TrackerReceipt) return null;
  try {
    return await TrackerReceipt.receiptUri(fileName);
  } catch {
    return null;
  }
}

/** Best effort; never throws. */
export async function deleteReceiptFile(fileName: string): Promise<void> {
  if (!TrackerReceipt) return;
  try {
    await TrackerReceipt.deleteReceipt(fileName);
  } catch {
    // an orphan file is harmless
  }
}
