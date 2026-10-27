# SMS Sync v2 — Step 1: `normalizeAccountKey` + tests

Status: **done** (pure TS/Jest, no device touched, no `adb`, no native code).

## Files

- Added `src/features/sms-sync/normalizeAccountKey.ts`
- Added `src/features/sms-sync/__tests__/normalizeAccountKey.test.ts`
- Did NOT touch `smsParser.ts`, `smsSyncLogic.ts`, or `account.types.ts` (wiring is a
  later phase).

## Exports

- `ACCOUNT_KEY_NORMALIZER_VERSION = 1`
- `interface AccountKey { bankCanonical, accountKind, lastFour, normalizerVersion }`
- `normalizeAccountKey(body: string): AccountKey`
- `accountKeyToString(key): string` — `${bankCanonical}:${accountKind}:${lastFour}`

## Bank alias map coverage

v1 `BANK_ALIASES` (ordered most-specific-first), each alias → canonical id:

| canonical | aliases |
|-----------|---------|
| `hdfc`    | HDFC, HDFC Bank, HDFCBK |
| `federal` | Federal Bank, Federal, FEDBNK |
| `sbi`     | SBI, State Bank of India, SBI Card, SBICRD |
| `icici`   | ICICI, ICICI Bank, ICICIB |
| `axis`    | Axis, Axis Bank, AXISBK |
| `kotak`   | Kotak, Kotak Mahindra, KOTAKB |
| `pnb`     | PNB, Punjab National Bank |
| `boi`     | Bank of India, BOI |
| `canara`  | Canara Bank, Canara |
| `union`   | Union Bank, Union Bank of India |
| `yes`     | Yes Bank, YESBNK |
| `idfc`    | IDFC, IDFC First, IDFC FIRST Bank |

Not exhaustive by design — unmatched banks fall through to `'unknown'` (not a crash,
not a wrong bank). Cross-bank substring shadowing is handled by ordering:
"State Bank of India" and "Union Bank of India" are checked before the shorter
"Bank of India" (boi), and "IDFC FIRST Bank" before bare "IDFC".

Matching is word-boundary, case-insensitive against the body. The previously-broken
"SBI" case is fixed structurally: the bare token `SBI` (word boundary) is checked
BEFORE any adjacent-"Bank" requirement, so "SBI Card ending 5368" and "SBI A/C 5368"
both resolve to `sbi`.

## lastFour regex + formats handled

Two patterns, tried in order:

1. Keyword-anchored (reused from `smsParser.ts`, unchanged):
   `/(?:a\/?c|acct|account|card)[^\d]{0,20}(?:ending\s*)?[x*]{0,6}\s*(\d{4})\b/i`
   → `a/c ending 1859`, `a/c X1859`, `card ending 8123`, `A/C *7302`, `Acct XX1234`.
2. Mask-only (new): `/(?:^|[^\w])[x*]{1,6}\s*(\d{4})(?![A-Za-z0-9])/i`
   → `XX1859`, `*1859`, `X1859`, `XXXX1859`.

The `(?:^|[^\w])` prefix on the mask pattern prevents a bare 4-digit amount
("Rs.1859.00") from being mistaken for a last-four. Unreachable → `''` sentinel,
never `null`/`undefined`.

## accountKind

Copied `CREDIT_CARD_PATTERN` and `BANK_ACCOUNT_PATTERN` verbatim from `smsParser.ts`
(same precedence: credit card wording → bank/account wording → UPI fallback). No
logic divergence.

## Test results

- `npx tsc --noEmit -p tsconfig.json` — clean.
- `npx eslint src --ext .ts,.tsx` — 0 errors (3 pre-existing warnings in unrelated files).
- `npx jest` — 11 suites, 144 tests passed (56 new in `normalizeAccountKey.test.ts`).

New test coverage:
- Each bank alias in ≥2 real-world phrasings (30 alias assertions).
- The previously-broken SBI cases by name ("SBI Card ending 5368", "SBI A/C 5368" → `sbi`).
- Every lastFour format as its own case.
- accountKind precedence (credit card > bank > UPI).
- No match → `unknown` + `''` + accountKind still resolved independently.
- `normalizerVersion` always `ACCOUNT_KEY_NORMALIZER_VERSION`.
- `accountKeyToString` determinism + distinctness.
- Three last-four formats of one account (`ending 1859` / `X1859` / `*1859`) → same `AccountKey`.
