# Phase 2 — Forms: Add Record + Edit Transaction

Manual entry forms for Add Record and Edit Transaction, wired to the dead
buttons (`onAddRecord` on Home, `onEdit` on Pending review sheet + Transaction
Detail screen). Manual entries follow docs/PROJECT.md §23: created as
`status: 'pending'`, never approved directly — the existing Pending/Review UI
approves them afterward.

## Chronological log

### 1. Dependency — `@hookform/resolvers` (installed)

`npm install @hookform/resolvers` → resolved `5.9.1`. Pure-JS glue between the
already-installed `zod` (4.6.5) and `react-hook-form` (7.89.0); no native code.
`package.json` + `package-lock.json` updated. Verified `@hookform/resolvers/zod`
does NOT `require('zod')` itself — it duck-types the schema via `_zod`/`_def`
properties at runtime, so the zod import chain comes only from our schema file.

### 2. Zod schema + amount helpers — `src/features/transactions/components/transactionForm.schema.ts` (created)

- `transactionFormSchema` (zod v4): `type` enum, `amount` string with
  `/^\d+(\.\d{1,2})?$/` + `> 0` refinements, `merchantName` non-empty,
  `categoryId`/`accountId` non-empty, `paymentMethod` enum, `occurredAt` ISO
  string, `note` optional.
- `TransactionFormValues`, `TransactionFormInitialValues`.
- `amountInputToMinor(value)` = `Math.round(parseFloat(value) * 100)` — the ONLY
  float→integer boundary, called at submit. `minorToAmountInput(amountMinor)` =
  `(amountMinor / 100).toFixed(2)` — paise→rupee string for pre-filling edit.

### 3. Reusable form — `src/features/transactions/components/TransactionForm.tsx` (created)

Dumb component: `onSubmit(values)`, `initialValues?`, `submitting?`. Uses
`react-hook-form` + `zodResolver`. Reads `accounts`/`categories` from the store
(stable references — no `useShallow` needed; the category filter is a local
`useMemo`, not a store selector).

- Type toggle: Expense/Income `Pressable`+`Chip` (matches PendingScreen filter
  pattern).
- Amount: `TextInput keyboardType="decimal-pad"`, testID `transaction-amount-input`.
- Merchant: `TextInput`, testID `transaction-merchant-input`.
- Category: chips filtered by type — expense → `expense || both`, income →
  `income || both`. A `useEffect` resets `categoryId` to `''` when the selected
  category becomes invalid after a type switch.
- Account: radio-list (`radiobox-marked`/`radiobox-blank`) from `store.accounts`.
- Payment method: chips (bank/upi/cash/card/other), default `upi`.
- Date & time: two pressables (date / time) opening
  `@react-native-community/datetimepicker` (`mode="date"` / `"time"`); on `set`
  the ISO `occurredAt` is rebuilt preserving the untouched component.
- Note: optional multiline `TextInput`.
- Submit button `handleSubmit` wrapped as `() => handleSubmit(onSubmit)()`
  (Button's `onPress` is `(GestureResponderEvent) => void`, RHF's returned
  handler carries a different event type + Promise return).

### 4. Add Record screen — `src/features/transactions/screens/AddRecordScreen.tsx` (created)

- `accounts.length === 0` → honest empty state: "Add an account first" + a
  "Go to Accounts" button that does `navigation.navigate('Tabs', { screen: 'Accounts' })`.
- Otherwise renders `TransactionForm`. On submit builds the full
  `CreateTransactionInput`:
  `type`, `status: 'pending'`, `amountMinor: amountInputToMinor(...)`,
  `currency: 'INR'`, `merchantName`, `categoryId`, `accountId`, `paymentMethod`,
  `occurredAt`, `detectedAt: now`, `approvedAt: null`,
  `note: (trimmed || null)`, `sourceType: 'manual'`, `sourceReferenceHash: null`,
  `sanitizedPreview: null`, `confidenceScore: null`, `parserVersion: null`.
- Calls `useTransactionsStore.getState().addTransaction(input)`, then
  `navigation.navigate('Tabs', { screen: 'Pending' })` so the user sees the new
  entry awaiting approval.
- Custom header (arrow-left + "Add Record" + spacer), matching
  `TransactionDetailScreen`.

### 5. Edit Transaction screen — `src/features/transactions/screens/EditTransactionScreen.tsx` (created)

- Looks up `transaction` from the store via `route.params.transactionId`
  (`.find()` on a stable array reference — no `useShallow` needed per ground
  facts). Missing → "Transaction not found."
- Renders `TransactionForm` pre-filled (`minorToAmountInput` for amount).
- On submit builds a `TransactionPatch` (changed/full fields) and calls
  `useTransactionsStore.getState().updateTransaction(id, patch)`, then
  `navigation.goBack()`.

### 6. Navigation wiring

- `src/app/navigation/routes.ts` (modified): added `Routes.AddRecord` /
  `Routes.EditTransaction`; `RootStackParamList` now has
  `AddRecord: undefined` and `EditTransaction: { transactionId: string }`.
  Also changed `Tabs: undefined` → `Tabs: NavigatorScreenParams<MainTabParamList> | undefined`
  (imported `NavigatorScreenParams` from `@react-navigation/native`) so nested
  tab navigation (`navigate('Tabs', { screen: ... })`) typechecks. `MainTabParamList`
  moved above `RootStackParamList`.
- `src/app/navigation/RootNavigator.tsx` (modified): registered
  `AddRecordScreen` and `EditTransactionScreen` as `Stack.Screen`
  (`presentation: 'card'`, same as `TransactionDetail`).
- `src/features/home/screens/HomeScreen.tsx` (modified):
  `onAddRecord={() => navigation.navigate('AddRecord')}`. `onSyncSms` left as
  no-op (Phase 4).
- `src/features/pending/screens/PendingScreen.tsx` (modified): added
  `CompositeNavigationProp` navigation; `onEdit` now does `closeReview()` then
  `navigation.navigate('EditTransaction', { transactionId: t.id })` (sheet closed
  first so it isn't left unusable underneath the pushed screen).
- `src/features/transactions/screens/TransactionDetailScreen.tsx` (modified):
  typed `useNavigation<NativeStackNavigationProp<RootStackParamList>>`; `onEdit`
  → `navigation.navigate('EditTransaction', { transactionId: t.id })`.

### 7. Unit tests — `src/features/transactions/components/__tests__/transactionForm.schema.test.ts` (created)

15 tests: valid expense/income forms, invalid amounts (`0`, `-5`, `abc`, `''`,
`.50`, `450.`, `450.999`), missing merchant, empty category/account/date, and
amount-conversion helpers (`450.50` → `45050`, `45050` → `450.50`).

### 8. Jest mock — `__mocks__/@react-native-community/datetimepicker.js` (created)

The real package reads native datetime-picker modules at import time (undefined
under the RN jest preset). Manual mock stubs the default component (renders
`null`) + `DateTimePickerAndroid`, mirroring the existing op-sqlite mock pattern.

### 9. Build blocker + fix — `babel.config.js` (modified)

`zod` v4.6.5 bundles `export * as core from '...'` (ES2020 export-namespace-from)
in `node_modules/zod/v4/classic/external.js`. Metro's babel transform for
node_modules does not include that plugin, so the app red-boxed on first launch:

```
SyntaxError: .../zod/v4/classic/external.js: Export namespace should be first
transformed by `@babel/plugin-transform-export-namespace-from`.
```

Fix: added `'@babel/plugin-transform-export-namespace-from'` to
`babel.config.js` `plugins`. The plugin was already present transitively in
`node_modules` (no new dependency). Required a Metro restart with
`--reset-cache` (the transform cache key doesn't include `babel.config.js`
content). Verified the red-box was gone and the app booted to the onboarding
tour afterward.

## Gates

| gate | command | result |
|------|---------|--------|
| typecheck | `npx tsc --noEmit -p tsconfig.json` | clean (no output) |
| lint | `npx eslint src --ext .ts,.tsx` | 0 errors, 3 warnings (all pre-existing: `react/no-unstable-nested-components` in MainTabs/PendingScreen, `react-native/no-inline-styles` in StatTile) |
| tests | `npx jest` | 6 suites / 40 tests passed (25 prior + 15 new schema/helper tests) |
| android build | `cd android && ./gradlew assembleDebug` (JAVA_HOME + PATH exported) | BUILD SUCCESSFUL in 5s |
| install | `adb install -r .../app-debug.apk` | Success |
| launch | `am force-stop com.tracker` → `logcat -c` → `am start -n com.tracker/.MainActivity` | app launched, `topResumedActivity=com.tracker/.MainActivity` |
| no crash | `adb logcat -d` grep `FATAL EXCEPTION` / `Maximum update depth exceeded` | 0 matches (after babel fix) |

## On-device manual test — PARTIAL (blocked by device lock)

The physical device (`00015365L001524`) disconnected from adb mid-test (after
the account-hydration step), and when it reconnected ~5 min later its screen
was **asleep and PIN-locked** (`mWakefulness=Asleep`→`Dozing`,
`mKeyguardUnlocked=false`, `isKeyguardShowing=true`). I woke it
(`KEYCODE_WAKEUP`) but the keyguard remains locked. I did not and will not
attempt to bypass the lock screen. The remaining form-submit/approve/edit steps
could not be exercised end-to-end.

### Completed on-device (before the lock):

1. Fresh install → app booted to onboarding tour with no red-box (after the
   §9 babel fix). `topResumedActivity=com.tracker/.MainActivity`, 0 `FATAL
   EXCEPTION`, 0 `Maximum update depth exceeded`.
2. Skipped tour → Home. Verified `₹0.00` total, `0 waiting` (genuine empty state).
3. Tapped **Add Record** (bounds read from `uiautomator dump`, not guessed):
   with zero accounts the screen correctly rendered **"Add an account first"**
   + body copy + **"Go to Accounts"** button — the honest empty-state behavior,
   not a broken form.
4. **Test-account workaround** (documented per instructions): the app has no
   reachable Add-Account UI yet (Phase 3), and there is no `sqlite3` on the
   device, so I seeded one account by editing the on-device SQLite file directly:
   - `adb exec-out run-as com.tracker cat databases/tracker.db > /tmp/tracker.db`
   - `sqlite3 /tmp/tracker.db "INSERT INTO accounts (id, name, type, last_four,
     opening_balance_minor, currency, is_active, created_at, updated_at) VALUES
     ('acc-test-1', 'Test Account', 'bank', '1234', 0, 'INR', 1, <now>, <now>)"`
   - `adb push /tmp/tracker.db /data/local/tmp/tracker.db` then
     `adb shell run-as com.tracker cp /data/local/tmp/tracker.db databases/tracker.db`
     (note: `/sdcard/...` is not readable by `run-as`; `/data/local/tmp` works).
   - Confirmed the account persisted on-device and, after a fresh relaunch,
     hydrated correctly: Accounts tab showed **"Test Account" · `•••• 1234` ·
     "BANK ACCOUNTS" · "Across 1 tracked money sources"**. This is harmless for
     Phase 3: it's one ordinary `acc-…` row in the real on-device DB, no schema
     change, no data-layer corruption; Phase 3's real account UI will simply
     list it alongside any future accounts. The DB file itself was not left
     corrupted (pulled → single-row INSERT → verified → pushed back whole).

### NOT completed (blocked by lock):

5. Submit the Add Record form (with the test account) and confirm a new
   `pending` transaction appears on the Pending tab.
6. Approve it and confirm it appears in Transactions/Home as approved and
   affects the balance.
7. Edit it (change merchant/amount), submit, confirm persistence.

The form implementation, validation, store wiring, and navigation all pass
`tsc`/`eslint`/`jest` and are compile-clean; the zod schema's amount/required
validation is covered by unit tests. But the end-to-end UI flow on the real
device is **unverified** pending a device unlock.

## File counts

- Created: 7 files.
  - `src/features/transactions/components/transactionForm.schema.ts`
  - `src/features/transactions/components/TransactionForm.tsx`
  - `src/features/transactions/screens/AddRecordScreen.tsx`
  - `src/features/transactions/screens/EditTransactionScreen.tsx`
  - `src/features/transactions/components/__tests__/transactionForm.schema.test.ts`
  - `__mocks__/@react-native-community/datetimepicker.js`
  - `ongoing/realtime-persistence/02-forms-add-edit.md` (this file)
- Modified: 8 files.
  - `package.json` (+ `@hookform/resolvers`)
  - `package-lock.json`
  - `babel.config.js` (+ export-namespace-from plugin)
  - `src/app/navigation/routes.ts`
  - `src/app/navigation/RootNavigator.tsx`
  - `src/features/home/screens/HomeScreen.tsx`
  - `src/features/pending/screens/PendingScreen.tsx`
  - `src/features/transactions/screens/TransactionDetailScreen.tsx`
