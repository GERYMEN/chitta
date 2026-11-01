import { create } from 'zustand';
import type { ButtonVariant } from '../Button';

export interface DialogAction {
  label: string;
  variant?: ButtonVariant;
  onPress?: () => void | Promise<void>;
}

export interface DialogOptions {
  title: string;
  message?: string;
  /** MaterialCommunityIcons name rendered above the title. */
  icon?: string;
  /** Defaults to a single "OK" action when omitted/empty. */
  actions?: DialogAction[];
}

export interface DialogConfig {
  title: string;
  message?: string;
  icon?: string;
  actions: DialogAction[];
}

interface DialogState {
  current: DialogConfig | null;
  show: (options: DialogOptions) => void;
  /** Close without running any action handler (back button / scrim). */
  dismiss: () => void;
  /** Close, then run the action's handler. */
  press: (action: DialogAction) => void;
}

const DEFAULT_ACTIONS: DialogAction[] = [{ label: 'OK', variant: 'primary' }];

export const useDialogStore = create<DialogState>((set, get) => ({
  current: null,
  show: options =>
    set({
      current: {
        title: options.title,
        message: options.message,
        icon: options.icon,
        actions: options.actions && options.actions.length > 0 ? options.actions : DEFAULT_ACTIONS,
      },
    }),
  dismiss: () => set({ current: null }),
  press: action => {
    if (get().current === null) return;
    set({ current: null });
    if (action.onPress) {
      Promise.resolve(action.onPress()).catch(() => undefined);
    }
  },
}));

/** Destructive dialogs must be answered explicitly — no scrim-tap dismissal. */
export function isDestructiveDialog(config: DialogConfig): boolean {
  return config.actions.some(action => action.variant === 'destructive');
}

/** Imperative entry point — drop-in replacement for the native alert API. */
export function showDialog(options: DialogOptions): void {
  useDialogStore.getState().show(options);
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  icon?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** R4e: destructive confirm (red button, no scrim-tap dismissal). */
  destructive?: boolean;
}

/**
 * R4b: a two-action dialog as a promise. Resolves true on the confirm
 * action; false on Cancel, back button, scrim, or when another dialog
 * replaces it.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve(value);
    };
    useDialogStore.getState().show({
      title: options.title,
      message: options.message,
      icon: options.icon,
      actions: [
        { label: options.cancelLabel ?? 'Cancel', variant: 'ghost', onPress: () => settle(false) },
        {
          label: options.confirmLabel,
          variant: options.destructive ? 'destructive' : 'primary',
          onPress: () => settle(true),
        },
      ],
    });
    const shown = useDialogStore.getState().current;
    // Closed without an action (back / scrim) or replaced → treat as Cancel.
    // `press` clears `current` before it runs the handler, so defer a tick.
    unsubscribe = useDialogStore.subscribe(state => {
      if (state.current !== shown) setTimeout(() => settle(false), 0);
    });
  });
}
