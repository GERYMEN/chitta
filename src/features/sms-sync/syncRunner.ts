import { create } from 'zustand';
import { confirmDialog } from '../../shared/ui/Dialog/dialogStore';
import { largeScanMessage, SyncWindow } from '../../domain/settings/smsSyncStart.rules';
import { CancelToken, SmsSyncResult, syncSms } from './syncSms';

/**
 * R4b: one SMS scan at a time, with progress + Cancel for the Home card.
 * Only counts live here — never SMS text.
 */
interface SyncRunState {
  running: boolean;
  scanned: number;
  /** COUNT estimate; 0 until known. */
  total: number;
  cancelRequested: boolean;
  token: CancelToken | null;
  cancel: () => void;
}

export const useSyncRunStore = create<SyncRunState>((set, get) => ({
  running: false,
  scanned: 0,
  total: 0,
  cancelRequested: false,
  token: null,
  cancel: () => {
    const token = get().token;
    if (!token) return;
    token.cancelled = true;
    set({ cancelRequested: true });
  },
}));

export interface RunOptions {
  /** Gap scan (Settings: start moved earlier) — already confirmed by the user. */
  window?: SyncWindow;
}

/** Normal Sync asks before a big scan ("About N SMS to scan …"). */
export function confirmLargeScan(estimate: number): Promise<boolean> {
  return confirmDialog({
    title: 'Large SMS scan',
    message: largeScanMessage(estimate),
    icon: 'message-processing-outline',
    confirmLabel: 'Scan',
  });
}

/**
 * Runs `syncSms` with progress/cancel wired to `useSyncRunStore`. Resolves
 * null when a scan is already running. Errors are re-thrown (SmsSyncError)
 * for the caller's dialogs.
 */
export async function runSmsSync(options: RunOptions = {}): Promise<SmsSyncResult | null> {
  if (useSyncRunStore.getState().running) return null;
  const token: CancelToken = { cancelled: false };
  useSyncRunStore.setState({
    running: true,
    scanned: 0,
    total: 0,
    cancelRequested: false,
    token,
  });
  try {
    return await syncSms({
      window: options.window,
      cancel: token,
      onProgress: ({ scanned, total }) => useSyncRunStore.setState({ scanned, total }),
      confirmLargeScan: options.window ? undefined : confirmLargeScan,
    });
  } finally {
    useSyncRunStore.setState({
      running: false,
      scanned: 0,
      total: 0,
      cancelRequested: false,
      token: null,
    });
  }
}
