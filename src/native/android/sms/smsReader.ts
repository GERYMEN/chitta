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
  readInbox(limit: number): Promise<SmsMessage[]>;
  readById(id: string): Promise<SmsMessage | null>;
}

const { SmsReader } = NativeModules as { SmsReader?: SmsReaderNativeModule };

export async function readInbox(limit = 200): Promise<SmsMessage[]> {
  if (!SmsReader) {
    throw new Error('SmsReader native module is not available on this platform');
  }
  return SmsReader.readInbox(limit);
}

/**
 * Reads one SMS (any box) by its content-provider `_id`, or `null` if it no
 * longer exists. Used only for the on-demand "View original SMS" source view:
 * the result must stay in component state and never be stored or logged.
 */
export async function readSmsById(id: string): Promise<SmsMessage | null> {
  if (!SmsReader) {
    throw new Error('SmsReader native module is not available on this platform');
  }
  return SmsReader.readById(id);
}
