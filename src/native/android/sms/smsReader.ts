import { NativeModules } from 'react-native';

/**
 * Thin typed wrapper around the native `SmsReader` module. This is the ONLY
 * file in the app allowed to touch the raw `address`/`body` fields — they must
 * never be passed further up the call stack than the SMS parser, and must never
 * be logged or persisted anywhere downstream (privacy rule, STATE.md).
 */
export interface SmsMessage {
  id: string;
  address: string;
  body: string;
  date: number;
}

interface SmsReaderNativeModule {
  readInboxPage(
    sinceMs: number,
    beforeMs: number,
    beforeId: number,
    limit: number,
  ): Promise<SmsMessage[]>;
  countInboxSince(sinceMs: number): Promise<number>;
  readById(id: string): Promise<SmsMessage | null>;
}

const { SmsReader } = NativeModules as { SmsReader?: SmsReaderNativeModule };

function nativeModule(): SmsReaderNativeModule {
  if (!SmsReader) {
    throw new Error('SmsReader native module is not available on this platform');
  }
  return SmsReader;
}

/**
 * R4b: one page of inbox SMS, newest first, with `sinceMs <= date` and
 * (date, _id) strictly before (beforeMs, beforeId). Paging rules live in
 * features/sms-sync/inboxPaging.ts (pure mirror, unit-tested). Bodies are
 * for in-memory parsing only.
 */
export async function readInboxPage(
  sinceMs: number,
  beforeMs: number,
  beforeId: number,
  limit: number,
): Promise<SmsMessage[]> {
  return nativeModule().readInboxPage(sinceMs, beforeMs, beforeId, limit);
}

/** R4b: COUNT of inbox SMS with date >= sinceMs (no text is read). */
export async function countInboxSince(sinceMs: number): Promise<number> {
  return Number(await nativeModule().countInboxSince(sinceMs));
}

/**
 * Reads one SMS (any box) by its content-provider `_id`, or `null` if it no
 * longer exists. Used only for the on-demand "View original SMS" source view:
 * the result must stay in component state and never be stored or logged.
 */
export async function readSmsById(id: string): Promise<SmsMessage | null> {
  return nativeModule().readById(id);
}
