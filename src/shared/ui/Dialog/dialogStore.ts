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
