import type { SmsMessage } from '../../native/android/sms/smsReader';
import {
  ParsedSmsTransaction,
  PARSER_VERSION,
  readSmsMessage,
  SmsReadResult,
} from './parser/readSms';

export type { ParsedSmsTransaction, SmsReadResult };
export { PARSER_VERSION, readSmsMessage };

/**
 * SMS parser entry point used by sync (R5: v2 reader).
 *
 * v1 was a regex-only parser that rejected any SMS containing "avail" /
 * "offer" / "click", needed an Rs/INR/₹ prefix, and took the first debit word
 * anywhere in the body. v2 (parser/readSms.ts) adds a sender stage, a
 * classifier with targeted classes, verb-bound amount extraction and
 * signal-based confidence. `parseSmsMessage` keeps its v1 contract: a
 * transaction or null. Sync calls `readSmsMessage` for the full result
 * (classes + "not understood" reasons).
 *
 * Privacy invariant: this function must NEVER return `msg.address` or
 * `msg.body`. Only derived, sanitized fields leave this module.
 */
export function parseSmsMessage(msg: SmsMessage): ParsedSmsTransaction | null {
  return readSmsMessage(msg).transaction;
}
