import { create } from 'zustand';
import { confirmDialog } from '../../shared/ui/Dialog/dialogStore';
import { largeScanMessage, SyncWindow } from '../../domain/settings/smsSyncStart.rules';
import { CancelToken, SmsSyncResult, SyncKind, syncSms } from './syncSms';
import { useSmsReaderStore } from './smsReaderStore';

/**
 * R4b: one SMS scan at a time, with progress + Cancel for the Home card.
 * Only counts live here — never SMS text.
 */
interface SyncRunState {
  running: boolean;
  /** R5-fix C10: a backup restore is replacing all data — no sync may start. */
  restoring: boolean;
  scanned: number;
  /** COUNT estimate; 0 until known. */
  total: number;
  cancelRequested: boolean;
  token: CancelToken | null;
  cancel: () => void;
}

export const useSyncRunStore = create<SyncRunState>((set, get) => ({
  running: false,
  restoring: false,
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
  /**
   * R5: 'rescan' = re-read the whole sync window with the new reader (asks
   * before a big scan, never moves the cursor); 'auto' = a new SMS arrived
   * (no dialogs, no permission prompt). Default: manual / gap.
   */
  kind?: SyncKind;
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
  // R5-fix C10: never while a backup restore replaces the data.
  if (useSyncRunStore.getState().running || useSyncRunStore.getState().restoring) return null;
  const token: CancelToken = { cancelled: false };
  useSyncRunStore.setState({
    running: true,
    scanned: 0,
    total: 0,
    cancelRequested: false,
    token,
  });
  try {
    const kind = options.kind;
    const askBeforeLarge = kind === 'rescan' || (!options.window && kind !== 'auto');
    return await syncSms({
      window: options.window,
      kind,
      requestPermission: kind !== 'auto',
      cancel: token,
      onProgress: ({ scanned, total }) => useSyncRunStore.setState({ scanned, total }),
      confirmLargeScan: askBeforeLarge ? confirmLargeScan : undefined,
    });
  } finally {
    // R5: the run may have added / resolved "not understood" rows.
    useSmsReaderStore.getState().refreshUnparsed().catch(() => undefined);
    useSyncRunStore.setState({
      running: false,
      scanned: 0,
      total: 0,
      cancelRequested: false,
      token: null,
    });
  }
}
