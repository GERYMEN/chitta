/**
 * R5d T1/T2 — salted one-way SMS identities (pure). SYNTHETIC inputs only.
 */
import { sha256Hex } from '../../../shared/crypto/sha256';
import { readSmsMessage } from '../parser/readSms';
import {
  identityBody,
  identitySender,
  refDigestFor,
  refTombstoneKey,
  smsContentHash,
} from '../smsIdentity';

const SALT = '11'.repeat(32);
const T0 = 1_760_000_000_000;
const BODY = 'Rs.250.00 debited from A/c XX1234 to QA STORE. Ref 000000000501. If not you call 18000000000';
const msg = (patch: Partial<{ address: string; body: string; date: number }> = {}) => ({
  address: 'AD-HDFCBK-S',
  body: BODY,
  date: T0,
  ...patch,
});

describe('smsContentHash', () => {
  it('is SHA-256(salt:header:seconds:folded body), first 32 hex', () => {
    const expected = sha256Hex(`${SALT}:HDFCBK:${Math.floor(T0 / 1000)}:${BODY}`).slice(0, 32);
    expect(smsContentHash(SALT, msg())).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{32}$/);
  });

  it('ignores the operator prefix / DLT suffix, milliseconds and whitespace runs', () => {
    const h = smsContentHash(SALT, msg());
    expect(smsContentHash(SALT, msg({ address: 'VM-HDFCBK-T' }))).toBe(h);
    expect(smsContentHash(SALT, msg({ date: T0 + 999 }))).toBe(h);
    expect(smsContentHash(SALT, msg({ body: `\n${BODY.replace(/ /g, '  ')} ` }))).toBe(h);
  });

  it('changes with the salt, the sender header, the second and ANY body text (footer included)', () => {
    const h = smsContentHash(SALT, msg());
    expect(smsContentHash('22'.repeat(32), msg())).not.toBe(h);
    expect(smsContentHash(SALT, msg({ address: 'AD-HDFCCC-S' }))).not.toBe(h);
    expect(smsContentHash(SALT, msg({ date: T0 + 1000 }))).not.toBe(h);
    expect(smsContentHash(SALT, msg({ body: BODY.replace('18000000000', '18000000001') }))).not.toBe(h);
  });

  it('a number sender is "<NUMBER>" — the digits never enter the hash input', () => {
    expect(identitySender('+919000000001')).toBe('<NUMBER>');
    expect(identitySender('57575')).toBe('<NUMBER>');
    expect(identitySender('AD-HDFCBK-S')).toBe('HDFCBK');
    expect(smsContentHash(SALT, msg({ address: '+919000000001' }))).toBe(
      smsContentHash(SALT, msg({ address: '+919000000002' })),
    );
  });

  it('identityBody folds whitespace but never cuts the footer', () => {
    expect(identityBody('  a \n b  ')).toBe('a b');
    expect(identityBody(BODY)).toContain('If not you');
  });
});

describe('refDigestFor / refTombstoneKey', () => {
  it('salted, case-insensitive, 32 hex; never the reference itself', () => {
    const d = refDigestFor(SALT, '000000000501');
    expect(d).toMatch(/^[0-9a-f]{32}$/);
    expect(d).not.toContain('000000000501');
    expect(refDigestFor(SALT, 'abc000000501')).toBe(refDigestFor(SALT, 'ABC000000501'));
    expect(refDigestFor('22'.repeat(32), '000000000501')).not.toBe(d);
  });

  it('the tombstone key binds type + amount (a reversal is never blocked)', () => {
    const d = refDigestFor(SALT, '000000000501');
    expect(refTombstoneKey(d, 'expense', 25000)).not.toBe(refTombstoneKey(d, 'income', 25000));
    expect(refTombstoneKey(d, 'expense', 25000)).not.toBe(refTombstoneKey(d, 'expense', 25001));
    expect(refTombstoneKey(d, 'expense', 25000)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('reader with a salt', () => {
  it('returns the salted ref digest + content hash; without a salt neither', () => {
    const withSalt = readSmsMessage({ id: '1', ...msg() }, { salt: SALT }).transaction!;
    expect(withSalt.refDigest).toBe(refDigestFor(SALT, '000000000501'));
    expect(withSalt.smsContentHash).toBe(smsContentHash(SALT, msg()));
    const without = readSmsMessage({ id: '1', ...msg() }).transaction!;
    expect(without.refDigest).toBeNull();
    expect(without.smsContentHash).toBeUndefined();
    expect(without.sourceReferenceHash).toBe(withSalt.sourceReferenceHash);
  });
});
