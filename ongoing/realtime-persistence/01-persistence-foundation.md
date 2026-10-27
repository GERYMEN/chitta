# Phase 1 — Persistence Foundation

Real on-device SQLite persistence (`@op-engineering/op-sqlite`), app boots to a
genuinely empty state (0 accounts, 0 transactions, 6 system categories seeded),
every screen reads/writes through the repository layer instead of fixtures.
Record/Edit/Add-Account buttons remain no-ops (Phases 2–3).

## Chronological log

### 1. Id helper — `src/shared/utils/id.ts` (created)

`generateId(prefix)` → `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.
No uuid dependency (F6). Used for every new transaction (`txn-…`) and account
(`acc-…`) id.

### 2. Schema — `src/data/db/schema.ts` (created)

`SCHEMA_STATEMENTS: string[]` with the four `CREATE TABLE IF NOT EXISTS`
statements exactly as specified in F2: `accounts`, `categories`, `transactions`,
`audit_events`. Booleans (`is_active`, `is_system`) are `INTEGER` 0/1; column
names are snake_case as given.

### 3. Connection + migrations + seed — `src/data/db/connection.ts` (created)

- `getDatabase(): DB` — singleton, `open({ name: 'tracker.db' })` once (F1).
- `runMigrations(): Promise<void>` — executes every schema statement, then calls
  `seedSystemCategories`. Idempotent, safe on every app start (F1/F2/F3).
- `seedSystemCategories(db)` — `SELECT COUNT(*) AS count FROM categories`; if
  `count > 0`, skip. Otherwise inserts the 6 system categories inside
  `db.transaction()`. Ids/names/types/icons are hardcoded to match
  `categories.fixture.ts` (`cat-food`, `cat-shopping`, `cat-transport`,
  `cat-coffee`, `cat-salary`, `cat-freelance`) so `categoryVisuals.ts` keeps
  working unchanged.

**Judgment call (F3):** system categories are inlined in `connection.ts` rather
than importing `categoryFixtures` from `src/test/fixtures/` — the data layer
should not depend on the test-fixtures module.

### 4. Mappers — `src/data/mappers/` (created)

- `coerce.ts` — shared coercion helpers (`asString`, `asNumber`,
  `asNullableString`, `asNullableNumber`, `asBoolean`) plus `SqlRow` /
  `SqlWriteRow` types. Keeps the mappers dependency-free (no op-sqlite import)
  so they stay pure and unit-testable. `asBoolean` maps `1`/`true` → `true`;
  the 0/1 INTEGER never leaks into domain objects (F4).
- `transaction.mapper.ts` — `rowToTransaction` / `transactionToRow`.
- `account.mapper.ts` — `rowToAccount` / `accountToRow`; `is_active` 0/1 ↔
  `isActive` boolean.
- `category.mapper.ts` — `rowToCategory` / `categoryToRow`; `is_system` 0/1 ↔
  `isSystem` boolean.

### 5. Repositories — `src/data/repositories/` (created)

Only these files import `@op-engineering/op-sqlite` (via `getDatabase`) and
write raw SQL (F5). Each is exported as an object.

- `transaction.repository.ts` — `listAll`, `getById`, `create`,
  `update`, `delete`. `create` fills id via `generateId('txn')` and
  `createdAt`/`updatedAt` via `new Date().toISOString()`. Amounts stay integer
  paise throughout — no float parse/format. `update` reads current row, merges
  patch, bumps `updatedAt`, writes the full row back (single UPDATE statement),
  returns the merged domain object.
- `account.repository.ts` — `listAll`, `getById`, `create`, `update`, same
  pattern; `generateId('acc')`.
- `category.repository.ts` — `listAll` only (read-only this phase).

**Judgment call (F5 naming):** exported as `transactionRepository`,
`accountRepository`, `categoryRepository` objects (matches the F7 contract
`transactionRepository.update(...)`). `delete` is a reserved word, so the module
exposes `delete: remove` on the object literal; the underlying function is
named `remove` internally.

### 6. Mapper round-trip tests — `src/data/mappers/__tests__/mappers.test.ts` (created)

Round-trip tests for transaction/account/category plus boolean-encoding
assertions (`is_active`/`is_system` → 0/1 → boolean). Light, per F4.

### 7. Store rewrite — `src/features/transactions/state/transactionsStore.ts` (modified)

- Removed `transactionFixtures` import/seed.
- New shape: `transactions`, `accounts`, `categories`, `isHydrated`, `hydrate`,
  `approve`, `reject`, `refresh`, `addTransaction`, `updateTransaction`,
  `addAccount`.
- `hydrate()` → `runMigrations()` then `Promise.all` of the three repositories'
  `listAll()`, then `isHydrated = true`.
- `approve`/`reject` → optimistic local transition (guarded by `canTransition`,
  reusing `transitionLocal` which mirrors the old `transition` behavior) so the
  UI updates immediately, then persist via `transactionRepository.update`,
  with `.catch(() => refresh())` as a reconcile fallback.
- `addTransaction`/`updateTransaction`/`addAccount` wired now (no UI calls yet)
  so Phase 2 doesn't touch this file.
- `selectPending` / `selectApproved` signatures unchanged.

### 8. Hydration gate — `src/app/App.tsx` (modified)

Calls `hydrate()` in a `useEffect` on mount; renders a centered
`ActivityIndicator` (theme `colors.primary` on `colors.surface`) until
`isHydrated`, then renders `RootNavigator`. `AppProviders` (SafeAreaProvider +
NavigationContainer) wraps both branches.

### 9. Consumer rewiring (F8)

- `HomeScreen.tsx` — reads `state.accounts` from the store instead of
  `accountFixtures`; `calculateBalance` logic unchanged.
- `TransactionDetailContent.tsx` — removed `categoryById`/`accountById` fixture
  imports; reads `state.categories`/`state.accounts` via `useTransactionsStore`
  and does `.find()` lookups. Prop contract (`transaction`, `onApprove`,
  `onEdit`, etc.) unchanged.
- `PendingTransactionCard.tsx` — removed `categoryById` fixture import; reads
  `state.categories` and `.find()`s the category (consistent with
  `TransactionDetailContent`).
- `AccountsScreen.tsx` — reads `state.accounts` from the store instead of
  `accountFixtures`; added empty state `No accounts yet — add one to start
  tracking` when `accounts.length === 0`; balance caption now uses
  `accounts.length`.

**Judgment call (F8):** both `TransactionDetailContent` and
`PendingTransactionCard` read categories/accounts directly from the store via
`useTransactionsStore` (no new props). This is the least invasive option given
each component is already rendered under the store provider, and keeps both
components consistent with each other. The selectors (`state.categories`,
`state.accounts`) return stable array references (only reassigned on
hydrate/refresh/add), so no infinite-loop class of bug is introduced.

### 10. Jest mock — `__mocks__/@op-engineering/op-sqlite.js` (created)

The real op-sqlite package reads `NativeModules.OPSQLite` at import time, which
is undefined under the `@react-native/jest-preset`. This manual mock (root
`__mocks__` adjacent to `node_modules`, auto-applied) stubs `open`/`openAsync`
to return a DB whose `execute`/`transaction` return empty result sets, keeping
`__tests__/App.test.tsx` (which pulls the full store→repositories→connection→
op-sqlite chain) from crashing. Not referenced by `jest.config.js`; Jest picks
it up automatically for the scoped node module.

## Gates

| gate | command | result |
|------|---------|--------|
| typecheck | `npx tsc --noEmit -p tsconfig.json` | clean (no output) |
| lint | `npx eslint src --ext .ts,.tsx` | 0 errors, 3 pre-existing warnings (`react/no-unstable-nested-components` in MainTabs/PendingScreen, `react-native/no-inline-styles` in StatTile) — none new |
| tests | `npx jest` | 5 suites / 25 tests passed (incl. new `mappers.test.ts`) |
| android build | `cd android && ./gradlew assembleDebug` (JAVA_HOME + PATH exported) | BUILD SUCCESSFUL in 6s |
| install | `adb install -r …/app-debug.apk` | Success |
| launch | `am force-stop com.tracker` → `logcat -c` → `am start -n com.tracker/.MainActivity` | app launched, `topResumedActivity=com.tracker/.MainActivity` |
| no crash | `adb logcat -d` grep `FATAL EXCEPTION` / `Maximum update depth exceeded` | 0 matches (the only `AndroidRuntime` lines are the `uiautomator` launcher's own START/shutdown noise, not app crashes) |
| Home empty | `uiautomator dump` text nodes | `₹0.00` total balance, `0 waiting`, `₹0` income/expense; no fixture merchant names (`Swiggy`/`Amazon`/`Zomato`/etc.) anywhere |
| Accounts empty | tap Accounts tab, `uiautomator dump` | `₹0.00`, `Across 0 tracked money sources`, empty-state copy `No accounts yet — add one to start tracking` present; no fixture account names (`HDFC Bank`/`State Bank of India`/etc.) |

## Onboarding note

The app boots to the Onboarding tour (unchanged initial route). The
`TourIllustration` on tour step 0 legitimately shows a decorative `Swiggy`
fixture (per STATE.md — that file is intentionally left alone and never wired
to the DB). Verification of the *empty* state was done after navigating
through the tour (`Skip Tour`/CTA taps) to the real Home and Accounts screens;
the fixture merchant check is scoped to those screens, not the onboarding
illustration.

## File counts

- Created: 12 source/test files + 1 output log (this file).
  - `src/shared/utils/id.ts`
  - `src/data/db/schema.ts`
  - `src/data/db/connection.ts`
  - `src/data/mappers/coerce.ts`
  - `src/data/mappers/transaction.mapper.ts`
  - `src/data/mappers/account.mapper.ts`
  - `src/data/mappers/category.mapper.ts`
  - `src/data/repositories/transaction.repository.ts`
  - `src/data/repositories/account.repository.ts`
  - `src/data/repositories/category.repository.ts`
  - `src/data/mappers/__tests__/mappers.test.ts`
  - `__mocks__/@op-engineering/op-sqlite.js`
- Modified: 6 files.
  - `src/features/transactions/state/transactionsStore.ts`
  - `src/app/App.tsx`
  - `src/features/home/screens/HomeScreen.tsx`
  - `src/features/transactions/components/TransactionDetailContent.tsx`
  - `src/features/accounts/screens/AccountsScreen.tsx`
  - `src/features/pending/components/PendingTransactionCard.tsx`
