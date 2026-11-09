import { create } from 'zustand';
import { settingsRepository } from '../../data/repositories/settings.repository';
import {
  SmsUnparsedRow,
  smsUnparsedRepository,
} from '../../data/repositories/smsUnparsed.repository';
import {
  checkReceiveSmsPermission,
  requestReceiveSmsPermission,
} from '../../native/android/permissions/smsPermission';
import { setNativeAutoReadEnabled } from '../../native/android/sms/smsAutoRead';
import {
  AUTO_READ_SETTING_KEY,
  AutoReadSetting,
  effectiveAutoRead,
  parseAutoReadSetting,
} from './autoRead/autoReadRules';
import { PARSER_VERSION } from './parser/readSms';
import type { Transaction } from '../../domain/transactions/transaction.types';

/**
 * R5: reader-v2 state that is NOT money — the auto-read setting + grant, the
 * reader version this phone last re-read with, and the open "Messages not
 * understood" rows (ids, dates, reasons only — never SMS text).
 */
export const READER_VERSION_SEEN_KEY = 'sms_reader_version_seen';

/** The parser_version v1 stamped on SMS rows. */
export const V1_PARSER_VERSION_TAG = 'sms-heuristic-v1';

export type TurnOnResult = 'on' | 'denied' | 'blocked';

interface SmsReaderState {
  loaded: boolean;
  autoReadSetting: AutoReadSetting;
  receiveGranted: boolean;
  /** PARSER_VERSION the user last re-read with (null = never). */
  readerVersionSeen: number | null;
  unparsed: SmsUnparsedRow[];
  load: () => Promise<void>;
  refreshUnparsed: () => Promise<void>;
  /** Toggle "Read new SMS automatically" (asks for RECEIVE_SMS when turning on). */
  setAutoRead: (on: boolean) => Promise<TurnOnResult | 'off'>;
  markReaderSeen: () => Promise<void>;
  dismissUnparsed: (row: Pick<SmsUnparsedRow, 'smsId' | 'smsDate'>) => Promise<void>;
  resolveUnparsed: (row: Pick<SmsUnparsedRow, 'smsId' | 'smsDate'>) => Promise<void>;
}

async function syncNativeFlag(setting: AutoReadSetting, granted: boolean): Promise<void> {
  await setNativeAutoReadEnabled(effectiveAutoRead(setting, granted));
}

export const useSmsReaderStore = create<SmsReaderState>((set, get) => ({
  loaded: false,
  autoReadSetting: null,
  receiveGranted: false,
  readerVersionSeen: null,
  unparsed: [],

  load: async () => {
    const [settingRaw, seenRaw, granted] = await Promise.all([
      settingsRepository.getValue(AUTO_READ_SETTING_KEY).catch(() => null),
      settingsRepository.getValue(READER_VERSION_SEEN_KEY).catch(() => null),
      checkReceiveSmsPermission().catch(() => false),
    ]);
    const autoReadSetting = parseAutoReadSetting(settingRaw);
    const seen = seenRaw == null ? NaN : Number(seenRaw);
    set({
      loaded: true,
      autoReadSetting,
      receiveGranted: granted,
      readerVersionSeen: Number.isInteger(seen) ? seen : null,
    });
    await syncNativeFlag(autoReadSetting, granted);
    await get().refreshUnparsed();
  },

  refreshUnparsed: async () => {
    const unparsed = await smsUnparsedRepository.listOpen().catch(() => []);
    set({ unparsed });
  },

  setAutoRead: async on => {
    const before = get().autoReadSetting ?? (get().receiveGranted ? 'on' : 'off');
    if (!on) {
      await settingsRepository.setMany(
        [[AUTO_READ_SETTING_KEY, 'off']],
        before === 'off'
          ? []
          : [
              {
                eventType: 'settings_changed',
                actor: 'user',
                metadata: { kind: 'settings_changed', key: 'sms_auto_read', from: 'on', to: 'off' },
              },
            ],
      );
      set({ autoReadSetting: 'off' });
      await syncNativeFlag('off', get().receiveGranted);
      return 'off';
    }
    let granted = await checkReceiveSmsPermission().catch(() => false);
    if (!granted) {
      const result = await requestReceiveSmsPermission().catch(() => 'denied' as const);
      granted = result === 'granted';
      if (!granted) {
        set({ receiveGranted: false });
        return result === 'never_ask_again' ? 'blocked' : 'denied';
      }
    }
    const wasOn = effectiveAutoRead(get().autoReadSetting, get().receiveGranted);
    await settingsRepository.setMany(
      [[AUTO_READ_SETTING_KEY, 'on']],
      wasOn
        ? []
        : [
            {
              eventType: 'settings_changed',
              actor: 'user',
              metadata: { kind: 'settings_changed', key: 'sms_auto_read', from: 'off', to: 'on' },
            },
          ],
    );
    set({ autoReadSetting: 'on', receiveGranted: true });
    await syncNativeFlag('on', true);
    return 'on';
  },

  markReaderSeen: async () => {
    await settingsRepository.setValue(READER_VERSION_SEEN_KEY, String(PARSER_VERSION));
    set({ readerVersionSeen: PARSER_VERSION });
  },

  dismissUnparsed: async row => {
    await smsUnparsedRepository.dismiss(row.smsId, row.smsDate);
    set(state => ({
      unparsed: state.unparsed.filter(r => r.smsId !== row.smsId || r.smsDate !== row.smsDate),
    }));
  },

  resolveUnparsed: async row => {
    await smsUnparsedRepository.resolveMany([row]);
    set(state => ({
      unparsed: state.unparsed.filter(r => r.smsId !== row.smsId || r.smsDate !== row.smsDate),
    }));
  },
}));

/**
 * One-time Home hint "Re-read your messages with the new reader": only on a
 * phone where reader v1 recorded SMS items, until the user re-read (or
 * dismissed the hint) with the current PARSER_VERSION.
 */
export function readerHintVisible(input: {
  loaded: boolean;
  hasOnboarded: boolean;
  readerVersionSeen: number | null;
  transactions: ReadonlyArray<Pick<Transaction, 'sourceType' | 'parserVersion'>>;
  current?: number;
}): boolean {
  const current = input.current ?? PARSER_VERSION;
  if (!input.loaded || !input.hasOnboarded) return false;
  if ((input.readerVersionSeen ?? 1) >= current) return false;
  return input.transactions.some(
    t => t.sourceType === 'sms' && t.parserVersion === V1_PARSER_VERSION_TAG,
  );
}

/** Open rows the user has not since recorded (by SMS reference). */
export function visibleUnparsed(
  rows: ReadonlyArray<SmsUnparsedRow>,
  transactions: ReadonlyArray<Pick<Transaction, 'sourceReferenceHash'>>,
): SmsUnparsedRow[] {
  const hashes = new Set(transactions.map(t => t.sourceReferenceHash).filter(Boolean));
  return rows.filter(row => !hashes.has(`sms-${row.smsId}-${row.smsDate}`));
}

/** Re-scan window: the R4b sync start → now (start null = whole inbox). */
export function rescanWindow(startAt: string | null, nowMs: number): { sinceMs: number; beforeMs: number } {
  const start = startAt ? Date.parse(startAt) : NaN;
  return { sinceMs: Number.isFinite(start) ? Math.max(0, start) : 0, beforeMs: nowMs + 1 };
}

const REASON_LABELS: Record<SmsUnparsedRow['reasonCode'], string> = {
  no_amount: 'No amount found',
  no_direction: 'Not sure if money went in or out',
  unknown_format: 'Unfamiliar message format',
};

export function unparsedReasonLabel(reason: SmsUnparsedRow['reasonCode']): string {
  return REASON_LABELS[reason] ?? 'Unfamiliar message format';
}
