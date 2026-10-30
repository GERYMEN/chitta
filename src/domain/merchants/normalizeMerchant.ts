/**
 * Stable merchant key used by merchant → category rules (R2).
 *
 * Rules, applied in order:
 *  1. lowercase + trim;
 *  2. drop UPI handle suffixes ("swiggy@okhdfcbank" → "swiggy");
 *  3. drop apostrophes ("mcdonald's" → "mcdonalds"), every other
 *     non-alphanumeric character becomes a space;
 *  4. collapse whitespace;
 *  5. repeatedly drop trailing reference tails ("… ref no 123456",
 *     "… utr 9a8b7c66", "… txn id 4455") and trailing id-like tokens
 *     (any token with 3+ digits), but never the first token.
 *
 * Short numbers (1–2 digits) are kept, so "Cafe 24" or "Zone 1" stay
 * distinct merchants. Pure: no I/O, deterministic.
 */
const REF_TAIL = /\s+(?:ref(?:erence)?|txn|utr|rrn)(?:\s+(?:no|id|number))?(?:\s+[a-z0-9]*\d[a-z0-9]*)?$/;

function isIdToken(token: string): boolean {
  return (token.match(/\d/g)?.length ?? 0) >= 3;
}

export function normalizeMerchant(raw: string | null | undefined): string {
  if (!raw) return '';
  let key = raw.toLowerCase().trim();
  key = key.replace(/@[^\s]*/g, ' ');
  key = key.replace(/['’`]/g, '');
  key = key.replace(/[^a-z0-9]+/g, ' ');
  key = key.replace(/\s+/g, ' ').trim();

  let previous: string;
  do {
    previous = key;
    key = key.replace(REF_TAIL, '').trim();
    const tokens = key.split(' ');
    while (tokens.length > 1 && isIdToken(tokens[tokens.length - 1])) {
      tokens.pop();
    }
    key = tokens.join(' ');
  } while (key !== previous);

  return key;
}
