import { create } from 'zustand';

export const SNACKBAR_DURATION_MS = 5000;

export interface SnackbarOptions {
  message: string;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  durationMs?: number;
}

interface SnackbarState {
  current: (SnackbarOptions & { id: number }) | null;
  show: (options: SnackbarOptions) => void;
  dismiss: (id?: number) => void;
  /** Runs the action once, then hides. A second press is ignored. */
  press: () => void;
}

let nextId = 1;
let timer: ReturnType<typeof setTimeout> | null = null;

function clearTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/**
 * One snackbar at a time (R2 Undo). Auto-hides after `durationMs` (5 s);
 * showing a new one replaces the old one and its timer.
 */
export const useSnackbarStore = create<SnackbarState>((set, get) => ({
  current: null,
  show: options => {
    clearTimer();
    const id = nextId++;
    set({ current: { ...options, id } });
    timer = setTimeout(() => get().dismiss(id), options.durationMs ?? SNACKBAR_DURATION_MS);
  },
  dismiss: id => {
    const current = get().current;
    if (!current || (id !== undefined && current.id !== id)) return;
    clearTimer();
    set({ current: null });
  },
  press: () => {
    const current = get().current;
    if (!current) return;
    clearTimer();
    set({ current: null });
    if (current.onAction) Promise.resolve(current.onAction()).catch(() => undefined);
  },
}));

export function showSnackbar(options: SnackbarOptions): void {
  useSnackbarStore.getState().show(options);
}
