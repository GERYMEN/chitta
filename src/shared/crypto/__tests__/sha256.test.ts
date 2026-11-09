/**
 * R5d T1: pure-TS SHA-256 against the published FIPS 180-2 / NIST vectors,
 * plus UTF-8 and block-boundary cross-checks against Node's own crypto
 * (test-only — the app never imports node:crypto).
 */
import { sha256Hex, utf8Bytes } from '../sha256';

// Test-only Node built-ins (no @types/node in this project).
const { createHash } = require('crypto') as {
  createHash: (algorithm: string) => {
    update: (data: string, encoding: string) => { digest: (encoding: string) => string };
  };
};
const { Buffer } = require('buffer') as {
  Buffer: { from: (text: string, encoding: string) => Uint8Array };
};

describe('sha256Hex — published vectors', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    [
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
    ],
  ])('%j', (input, expected) => {
    expect(sha256Hex(input)).toBe(expected);
  });

  it('one million "a"', () => {
    expect(sha256Hex('a'.repeat(1_000_000))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });
});

describe('sha256Hex — cross-check with node crypto', () => {
  const node = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

  it('every length across the 55/56/64 byte padding boundaries', () => {
    for (let n = 0; n <= 130; n++) {
      const s = 'x'.repeat(n);
      expect(sha256Hex(s)).toBe(node(s));
    }
  });

  it.each(['₹ 1,200 credited', 'QA ஸ்டோர் · café', 'emoji 🙂 pair', '\u0000\u007f\u0080߿ࠀ￿'])(
    'UTF-8 text %j',
    s => expect(sha256Hex(s)).toBe(node(s)),
  );

  it('utf8Bytes matches Buffer for surrogate pairs and lone surrogates', () => {
    for (const s of ['a', 'é', '₹', '🙂', '\ud83d']) {
      expect(Array.from(utf8Bytes(s))).toEqual(Array.from(Buffer.from(s, 'utf8')));
    }
  });
});
