# Phase 3 — Accounts Forms: Add Account

Wired the two dead Accounts buttons ("Add Account" + "Add New Money Source") to a
real Add Account flow: a reusable zod-validated form + a screen that persists via
the existing `accountRepository`/store path, then navigates back to Accounts where
the new account and updated balance render live. Built directly on Phase 1
(repositories/store already expose `addAccount`) and Phase 2 (the exact
`TransactionForm` + `transactionForm.schema` pattern). No new dependencies, no
schema/DB change, no native code.

## Chronological log

### 1. Zod schema — `src/features/accounts/components/accountForm.schema.ts` (created)

`accountFormSchema` (zod v4):
- `name`: `string().trim().min(1, 'Account name is required')`.
- `type`: `z.enum(['bank', 'cash', 'credit_card', 'upi', 'other'])`.
- `lastFour`: `string().optional()` — optional free text (alphanumeric allowed),
  no numeric-only enforcement; empty string submits as `null`.
- `openingBalance`: rupee string, `/^\d+(\.\d{1,2})?$/` + `>= 0` refine. An
  opening balance of `0` is VALID (fresh empty account) — deliberately NOT `> 0`
  the way Phase 2's transaction amount was.

Exports `AccountFormValues`, `AccountFormInitialValues`, and
`openingBalanceInputToMinor(value)` = `Math.round(parseFloat(value) * 100)` — the
only float→integer boundary, called at submit (same shape as Phase 2's
`amountInputToMinor`).

### 2. Reusable form — `src/features/accounts/components/AccountForm.tsx` (created)

Dumb component mirroring `TransactionForm`'s contract: `onSubmit(values)`,
`initialValues?`, `submitting?`. `react-hook-form` + `zodResolver`. Four fields:

- Account Name: `TextInput`, testID `account-name-input`.
- Type: `Chip` picker (5 options via `Pressable`+`Chip`, active/neutral tone,
  default `'bank'`). Labels: Bank Account / Cash / Credit Card / UPI / Other.
- Last 4 / Reference (optional): `TextInput`, testID `account-lastfour-input`.
- Opening Balance (₹): `TextInput keyboardType="decimal-pad"`, default `"0"`,
  testID `account-opening-balance-input`.

Submit button "Save Account" wraps `() => handleSubmit(onSubmit)()` (Button's
`onPress` event type differs from RHF's handler, same as Phase 2).

### 3. Screen — `src/features/accounts/screens/AddAccountScreen.tsx` (created)

Custom minimal header (arrow-left + "Add Account" + spacer) matching
`AddRecordScreen`/`EditTransactionScreen`. On submit builds `CreateAccountInput`:

```ts
{ name, type,
  lastFour: lastFour?.trim() || null,
  openingBalanceMinor: openingBalanceInputToMinor(openingBalance),
  currency: 'INR', isActive: true }
```

calls `useTransactionsStore.getState().addAccount(input)` (Phase 1 store method —
SQLite insert via `accountRepository.create` + `state.accounts` refresh), then
`navigation.goBack()`. `currency` hardcoded `'INR'`, `isActive` hardcoded `true`
(no pickers for either).

### 4. Navigation wiring

- `src/app/navigation/routes.ts` (modified): `AddAccount: undefined` added to
  `RootStackParamList` and `Routes.AddAccount`.
- `src/app/navigation/RootNavigator.tsx` (modified): imported `AddAccountScreen`,
  registered `<Stack.Screen name="AddAccount" component={AddAccountScreen}
  options={{ presentation: 'card' }} />`.
- `src/features/accounts/screens/AccountsScreen.tsx` (modified): added
  `CompositeNavigationProp<BottomTabNavigationProp<MainTabParamList,'Accounts'>,
  NativeStackNavigationProp<RootStackParamList>>` + `useNavigation<Nav>()`
  (same typed pattern as `HomeScreen`/`PendingScreen`). BOTH buttons wired to
  `navigation.navigate('AddAccount')`:
  - the dark-balance-Card "Add Account" button, and
  - the bottom "Add New Money Source" CTA.

`onSyncSms` untouched (still `() => {}` — Phase 4).

### 5. Unit tests — `src/features/accounts/components/__tests__/accountForm.schema.test.ts` (created)

12 tests: valid bank form, cash account with empty lastFour, opening balance `0`
accepted, decimal accepted, missing name rejected, invalid balances (`-5`,
`abc`, `''`, `.50`, `450.`, `450.999`) rejected, and `openingBalanceInputToMinor`
conversion (`5000.00`→500000, `0`→0, `1500.50`→150050, `0.01`→1).

## Gates

| gate | command | result |
|------|---------|--------|
| typecheck | `npx tsc --noEmit -p tsconfig.json` | clean (no output) |
| lint | `npx eslint src --ext .ts,.tsx` | 0 errors, 3 warnings (all pre-existing: `react/no-unstable-nested-components` in MainTabs/PendingScreen, `react-native/no-inline-styles` in StatTile) |
| tests | `npx jest` | 7 suites / 52 tests passed (40 prior + 12 new account schema/helper tests) |
| android build | `cd android && ./gradlew assembleDebug` (JAVA_HOME + PATH exported) | BUILD SUCCESSFUL in 10s |
| install | `adb install -r .../app-debug.apk` | Success |
| launch | `am force-stop com.tracker` → `logcat -c` → `am start -n com.tracker/.MainActivity` | `topResumedActivity=com.tracker/.MainActivity` |
| no crash | `adb logcat -d` grep `FATAL EXCEPTION` / `Maximum update depth exceeded` | 0 matches (throughout the entire test session) |

## On-device manual test — FULL PASS

Device `00015365L001524`, package `com.tracker`. Metro started fresh
(`npx react-native start`), `adb reverse tcp:8081 tcp:8081`. All taps read from a
fresh `uiautomator dump` before each tap (no stale coordinates). Text dumps used
throughout — zero screenshots (privacy rule).

### Pre-existing state (recognized, NOT confused with new accounts)

Phase 2's on-device DB contained one test account — "Test Account" (type `bank`,
`•••• 1234`, opening balance `0`) — plus the Phase 2 approved/edited expense
(`-₹250.75`, merchant "EditedMerchant", tied to Test Account). So the starting
Accounts screen showed TOTAL BALANCE `-₹250.75`, "Across 1 tracked money sources",
one "BANK ACCOUNTS" card (Test Account · ₹250.75 shown as Math.abs).

### Entry point 1 — "Add Account" (inside dark balance Card)

1. Onboarding → "Skip Tour" → Permissions step → "Enter transactions manually
   instead" (did NOT grant SMS — Phase 4) → Tabs → Accounts tab.
2. Tapped "Add Account" (bounds from fresh dump) → Add Account screen rendered:
   Account Name / Type chips (Bank Account preselected) / Last 4 (optional) /
   Opening Balance defaulting `0` / Save Account.
3. Filled: name `HDFC Salary Account`, type left `Bank Account`, lastFour `5678`,
   opening balance `5000.00`.
4. Tapped Save Account → auto-`goBack()` to Accounts.
5. Verified (text dump): TOTAL BALANCE `₹4,749.25`, "Across 2 tracked money
   sources", BANK ACCOUNTS now 2 sources — "HDFC Salary Account · •••• 5678 ·
   ₹5,000.00" alongside Test Account. Math: `-250.75 + 5000.00 = 4749.25` ✓.

### Entry point 2 — "Add New Money Source" (bottom CTA)

6. Scrolled the account list up (bottom button sat below the fold) until "Add New
   Money Source" was visible; tapped it → SAME Add Account screen (fresh form,
   no initial values) — confirming both entry points share one flow.
7. Filled: name `Cash Wallet`, tapped the `Cash` type chip, left lastFour empty,
   left opening balance `0`.
8. Tapped Save Account → back on Accounts.
9. Verified: TOTAL BALANCE still `₹4,749.25` (cash adds `0`), "Across 3 tracked
   money sources", new "CASH · 1 source" group with "Cash Wallet · Physical
   wallet · ₹0.00". Type correctly persisted as `cash`, empty lastFour correctly
   persisted as `null` (renders "Physical wallet").

### Cross-feature live-state check

10. Home tab → "Add Record" (Phase 2 screen) → account picker listed all THREE
    accounts: Test Account •••• 1234, HDFC Salary Account •••• 5678, Cash Wallet
    / Physical wallet. Proves the store's `accounts` state is shared/live across
    features (Accounts screen ↔ Add Record picker), not a stale per-screen copy.

### Persistence across restart

11. `am force-stop com.tracker` → relaunch → navigated to Accounts. TOTAL BALANCE
    `₹4,749.25`, "Across 3 tracked money sources", both new accounts still listed.
    Real SQLite persistence confirmed (survives process restart), not in-memory.

## File counts

- Created: 4 files.
  - `src/features/accounts/components/accountForm.schema.ts`
  - `src/features/accounts/components/AccountForm.tsx`
  - `src/features/accounts/screens/AddAccountScreen.tsx`
  - `src/features/accounts/components/__tests__/accountForm.schema.test.ts`
- Modified: 3 files.
  - `src/app/navigation/routes.ts`
  - `src/app/navigation/RootNavigator.tsx`
  - `src/features/accounts/screens/AccountsScreen.tsx`

No `AndroidManifest.xml`, no DB schema, no `onboarding/`/`TourIllustration.tsx`
changes. No new npm dependencies.
