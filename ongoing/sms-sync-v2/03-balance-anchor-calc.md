# SMS Sync v2 — Step 4 (calc half): Balance anchor in `calculateBalance`

Status: **done** (code only — pure domain logic + tests). The "Set balance"
UI screen/badge states, account-creation anchor determination, and SMS
available-balance parsing are all deferred to later phases per scope.

**No device work. No `adb`, no app install, no Gradle build.** The
`cd android && ./gradlew assembleDebug` gate was deliberately skipped: this
phase changed only pure TS domain logic and a domain test file, nothing
native/Android-relevant. `npx tsc --noEmit -p tsconfig.json` across the whole
project (the real safety net for this change) is clean.

## Final function (`src/domain/accounts/account.rules.ts`)

```ts
export function calculateBalance(
  account: Pick<Account, 'openingBalanceMinor' | 'balanceAnchorMinor' | 'balanceAnchorAt'>,
  transactions: ReadonlyArray<
    Pick<Transaction, 'status' | 'type' | 'amountMinor' | 'accountId' | 'occurredAt'>
  >,
  accountId: string,
): number {
  const anchorMinor = account.balanceAnchorMinor ?? account.openingBalanceMinor;
  const anchorAtMs = account.balanceAnchorAt ? Date.parse(account.balanceAnchorAt) : -Infinity;

  return transactions
    .filter(
      t =>
        t.accountId === accountId &&
        affectsBalance(t) &&
        Date.parse(t.occurredAt) > anchorAtMs,
    )
    .reduce((balance, t) => {
      return t.type === 'income' ? balance + t.amountMinor : balance - t.amountMinor;
    }, anchorMinor);
}
```

Doc comment updated to state the anchor rule and the no-anchor backward
compatibility. No liability-specific branching added — arithmetic identical
per the existing comment; `isLiabilityAccount` untouched.

## Call sites verified (repo-wide search for `calculateBalance`)

Only two production call sites exist, both pass real `Account` / `Transaction`
objects from the Zustand store (which post-Phase-2 carry `balanceAnchorMinor`/
`balanceAnchorAt` and `occurredAt`), so neither needed a change — widened
`Pick<...>` compiles against both:

- `src/features/home/screens/HomeScreen.tsx:37` — `calculateBalance(account, transactions, account.id)` in the total-balance reduce.
- `src/features/accounts/screens/AccountsScreen.tsx:43` (total-tracked reduce) and `:108` (`AccountCard`), where `transactions` is typed as `Parameters<typeof calculateBalance>[1]` so it picked up `occurredAt` automatically.

The only hand-trimmed literal was the test fixture in
`account.rules.test.ts`, updated as required (below). No other call site or
literal existed.

## Tests (`src/domain/accounts/__tests__/account.rules.test.ts`)

Existing 4 assertions kept, no weakening; fixtures widened to satisfy the new
signature (`account` gained `balanceAnchorMinor: null` / `balanceAnchorAt: null`;
`txn()` gained `occurredAt`). New tests added:

- **Old formula byte-for-byte when no anchor set** — independently recomputes
  the legacy formula (opening balance + all approved net, ignoring dates and
  other accounts) and asserts the new `calculateBalance` equals it exactly,
  including a transaction dated long before any anchor would be. Proves zero
  behavior change for every existing account (all of which have null anchors).
- **Anchor value as base** — `balanceAnchorMinor: 500000`, empty txns → `500000`
  (anchor replaces opening balance as the starting point).
- **Before-anchor excluded** — expense dated `2026-09-30T23:59:59.999Z` vs
  anchor `2026-10-01T00:00:00.000Z` → balance unchanged (`500000`).
- **At-anchor excluded (strictly after)** — expense dated exactly
  `2026-10-01T00:00:00.000Z` → balance unchanged (`500000`). Confirms
  "after balance_anchor_at" is strict (`>`, not `>=`), matching the skill
  wording.
- **After-anchor exact paise arithmetic** — anchor `500000` (₹5000.00) +
  approved ₹123.45 expense after T → exactly `487655`, no rounding.
- **Pending/rejected/other-account still excluded when anchored** — three
  transactions (pending income, rejected expense, other-account income), all
  dated after T → balance stays `500000`. Reuses `affectsBalance`; does not
  duplicate its logic.

## Gate results

- `npx tsc --noEmit -p tsconfig.json` — clean (no output).
- `npx eslint src --ext .ts,.tsx` — 0 errors (3 pre-existing warnings in
  unrelated files, unchanged).
- `npx jest` — 13 suites, 160 tests passed (was 154; +6 new).
- `cd android && ./gradlew assembleDebug` — skipped (pure TS domain change,
  no native code touched; full-project `tsc` is the safety net here).
