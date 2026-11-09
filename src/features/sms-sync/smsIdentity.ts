import { sha256Hex } from '../../shared/crypto/sha256';
import { parseSender } from './parser/senders';

/**
 * R5d — stable, salted, one-way SMS identities (pure; no state, no logging).
 *
 * - smsContentHash: identity of the SMS itself, independent of the inbox
 *   content-provider `_id` (which changes on a new phone, an SMS-backup
 *   restore or a default-SMS-app switch). Input: salt, the public DLT header
 *   ID (or "<NUMBER>" for any non-header sender — the number is never used),
 *   the send time in whole seconds, and the whole body with whitespace
 *   folded (NOT the footer cut: identity is of the whole message).
 * - refDigestFor: a salted digest of a UPI/IMPS/NEFT reference, so equal
 *   references dedupe across runs without the reference being stored.
 *
 * Both are SHA-256, truncated to 32 hex chars (128 bits — no realistic
 * collision on one phone's inbox, unlike the 32-bit FNV it replaces). The
 * salt is per install (`sms_identity_salt`), so a hash means nothing off the
 * phone; it travels only inside the encrypted backup.
 */
export const IDENTITY_HEX_LENGTH = 32;

const NUMBER_PLACEHOLDER = '<NUMBER>';

/** The same whitespace fold the reader applies (without its footer cut). */
export function identityBody(body: string): string {
  return body.replace(/\s+/g, ' ').trim();
}

/** Public header ID of the sender, or "<NUMBER>" (never the address itself). */
export function identitySender(address: string): string {
  return parseSender(address).header ?? NUMBER_PLACEHOLDER;
}

export function smsContentHash(
  salt: string,
  msg: { address: string; body: string; date: number },
): string {
  const seconds = Math.floor(msg.date / 1000);
  return sha256Hex(
    `${salt}:${identitySender(msg.address)}:${seconds}:${identityBody(msg.body ?? '')}`,
  ).slice(0, IDENTITY_HEX_LENGTH);
}

export function refDigestFor(salt: string, reference: string): string {
  return sha256Hex(`${salt}:${reference.toUpperCase()}`).slice(0, IDENTITY_HEX_LENGTH);
}

/**
 * Tombstone form of a reference digest, bound to type + amount (a deleted
 * debit never blocks its reversal). Built from the already-salted digest, so
 * it needs no salt at delete time.
 */
export function refTombstoneKey(refDigest: string, type: string, amountMinor: number): string {
  return sha256Hex(`${refDigest}:${type}:${amountMinor}`).slice(0, IDENTITY_HEX_LENGTH);
}
