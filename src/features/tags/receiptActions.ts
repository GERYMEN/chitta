import { showSnackbar } from '../../shared/ui';
import { useTransactionsStore } from '../transactions/state/transactionsStore';
import {
  deleteReceiptFile,
  pickReceipt,
  receiptsAvailable,
  receiptUri,
} from '../../native/android/receipts/receiptNative';

/** Matches the Snackbar auto-hide, plus a small margin. */
export const RECEIPT_UNDO_WINDOW_MS = 5500;

/**
 * R11 (D-c): attach a receipt through the system photo picker (no permission).
 * A replaced receipt's old file is deleted once the new one is saved. Returns
 * 'attached' | 'cancelled' | 'unavailable' | 'failed'.
 */
export async function attachReceipt(
  transactionId: string,
): Promise<'attached' | 'cancelled' | 'unavailable' | 'failed'> {
  if (!receiptsAvailable()) return 'unavailable';
  const store = useTransactionsStore.getState();
  const previous = store.transactions.find(t => t.id === transactionId)?.receiptPath ?? null;
  let fileName: string | null;
  try {
    fileName = await pickReceipt(transactionId);
  } catch {
    return 'failed';
  }
  if (fileName === null) return 'cancelled';
  const ok = await store.setReceiptPath(transactionId, fileName);
  if (!ok) {
    await deleteReceiptFile(fileName);
    return 'failed';
  }
  if (previous && previous !== fileName) await deleteReceiptFile(previous);
  return 'attached';
}

/**
 * R11 (D-c): clear the receipt now; the file is deleted after the 5 s Undo
 * window unless Undo is pressed. Undo restores the path only if the file still
 * exists (it always does inside the window; a missing file is never re-linked).
 */
export async function removeReceiptWithUndo(transactionId: string, fileName: string): Promise<void> {
  const store = useTransactionsStore.getState();
  await store.setReceiptPath(transactionId, null);
  let undone = false;
  setTimeout(() => {
    if (!undone) deleteReceiptFile(fileName).catch(() => undefined);
  }, RECEIPT_UNDO_WINDOW_MS);
  showSnackbar({
    message: 'Receipt removed',
    actionLabel: 'Undo',
    onAction: async () => {
      if ((await receiptUri(fileName)) === null) {
        showSnackbar({ message: 'Receipt file is gone' });
        return;
      }
      undone = true;
      await useTransactionsStore.getState().setReceiptPath(transactionId, fileName);
    },
  });
}
