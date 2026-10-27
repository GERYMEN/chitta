# SMS Sync v2 — Step 2: Migrations (schema/types/repositories)

Status: **done** (code only — no device work). On-device migration verification
against real accumulated data is deferred to a later phase.

**No device work was performed this phase; on-device migration verification
against real accumulated data is deferred to a later phase.**

Gates stopped at `tsc` / `eslint` / `jest` / `gradlew assembleDebug` (local
compile only). No `adb`, no app install, no on-device verification.

## Why real versioning (not just "schema")

`src/data/db/schema.ts` exports `SCHEMA_STATEMENTS: string[]`, a flat list of
`CREATE TABLE IF NOT EXISTS ...` strings. `runMigrations()` looped over them
every start — safe only because every statement was idempotent. This phase
adds `ALTER TABLE ... ADD COLUMN`, which is **not** idempotent (re-running one
throws "duplicate column name"). So I introduced real migration versioning.

## Versioning mechanism design

New file `src/data/db/migrations.ts`:

- `SCHEMA_STATEMENTS` (in `schema.ts`) gains a `schema_migrations` table and
  the new tables/indexes, and keeps running verbatim every start — all still
  idempotent, no version-guard.
- A separate ordered list `NUMBERED_MIGRATIONS` holds non-idempotent steps,
  each `{ version, statements[] }`:
  - **Version 1** — the four `ALTER TABLE ... ADD COLUMN` statements (T3).
  - **Version 2** — the `CREATE UNIQUE INDEX ... ux_tx_source_hash` (T5).
- `runNumberedMigrations(database)` runs each migration inside its own
  `db.transaction`; first it checks
  `SELECT 1 FROM schema_migrations WHERE version = ?` and skips if applied.
  On success it inserts `(version, Date.now())` into `schema_migrations`.
- `connection.ts`'s `runMigrations()` — still the single entrypoint — now runs
  `SCHEMA_STATEMENTS`, then `runNumberedMigrations`, then seeds categories.

First run on an existing device: `schema_migrations` is empty, so version 1
runs once (the columns genuinely don't exist yet anywhere), version 2 runs
once. Subsequent starts skip both.

## `ux_tx_source_hash` failure-handling behavior

Version 2 is its own numbered migration specifically so a duplicate-hash
failure is isolated from version 1. If `CREATE UNIQUE INDEX` throws:

- The migration's transaction rolls back → **no `schema_migrations` row is
  written** for version 2, so it retries on the next app start.
- The error is **re-thrown** with a `Migration 2 failed and was left unapplied
  (will retry on next start): ...` message — visible, not silently swallowed.
- **No rows are deleted/modified** — the code issues no `DELETE`/`DROP` under
  any condition. A duplicate collision (two non-NULL hashes equal) is treated
  as a real dedup bug and surfaced, not papered over by dropping rows or by
  downgrading the index to a partial one. `source_reference_hash` is nullable;
  multiple NULLs don't conflict under SQLite's UNIQUE semantics, so this only
  fails on a genuine non-null collision.

## New tables (idempotent, in `SCHEMA_STATEMENTS`)

- `schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`
- `account_suggestion_decisions` — exact DDL from schema.md (CHECK on
  `decision`, composite PK on `bank_canonical, account_kind, last_four`).
- `account_suggestion_candidates` — exact DDL from schema.md.
- `sms_sync_runs` — exact DDL from schema.md (CHECKs on `kind`/`status`).

## New indexes (idempotent, in `SCHEMA_STATEMENTS`)

- `ix_tx_status_date ON transactions(status, occurred_at)`
- `ix_tx_account_date ON transactions(account_id, occurred_at)`

## New columns (versioned migration 1)

- `accounts`: `balance_anchor_minor INTEGER`, `balance_anchor_at INTEGER`,
  `deleted_at INTEGER` — all nullable, no default (NULL = not set / active).
- `transactions`: `bulk_batch_id TEXT` — nullable.

## Domain types (`*.types.ts`)

- `Account` gained `balanceAnchorMinor: number | null`,
  `balanceAnchorAt: string | null`, `deletedAt: string | null`.
- `Transaction` gained `bulkBatchId: string | null`.

## Mappers

- `coerce.ts` gained `asNullableDateIso` (INTEGER epoch ms → ISO string) and
  `dateIsoToEpochMs` (ISO string → INTEGER epoch ms).
- `account.mapper.ts` round-trips the three new columns. `balance_anchor_at`
  and `deleted_at` are stored as `INTEGER` epoch ms per schema.md but mapped
  to/from ISO strings at the mapper boundary — same convention as every other
  `*At` field. `balance_anchor_minor` is a direct number.
- `transaction.mapper.ts` round-trips `bulk_batch_id` (nullable, `?? null`).

## Repositories

- `accountRepository` gained:
  - `listActiveAccounts()` — `WHERE deleted_at IS NULL`, ordered by
    `created_at ASC`.
  - `listAllAccounts()` — no filter (SQL identical to today's `listAll`).
  - Existing `listAll` kept; no existing call site changed.
  - `COLUMNS` now includes the three new account columns; `create` defaults
    them to `null` when the input omits them (`CreateAccountInput` makes the
    new fields optional so existing screens compile unchanged).
- `transactionRepository` `COLUMNS` now includes `bulk_batch_id`;
  `create`/`update` round-trip it, defaulting `null` when not provided
  (`CreateTransactionInput` makes `bulkBatchId` optional).

## Behavior impact

Zero user-visible change this phase. `deleted_at` is always NULL right now
(nothing soft-deletes yet), so `listActiveAccounts` vs `listAllAccounts` is
behaviorally identical; neither is wired into any screen yet. `normalizeAccountKey`
(Phase 1) was NOT wired into anything. `calculateBalance` untouched.

## Tests added

- `src/data/db/__tests__/migrations.test.ts` (2 tests, mock `getDatabase()`
  via a per-test fake `db.execute`/`tx.execute` tracking SQL + call counts):
  - Calling `runMigrations()` twice issues each `ALTER TABLE` exactly once
    (4 distinct ALTERs, count 1 each) and records versions 1 and 2 in
    `schema_migrations`.
  - Unique-index failure path: asserts it throws (`/Migration 2 failed/`),
    version 2 stays unrecorded (version 1 still applied), and no `DELETE` or
    `DROP` SQL is ever issued.
- `src/data/repositories/__tests__/account.repository.test.ts` (3 tests):
  `listActiveAccounts` emits the `deleted_at IS NULL` WHERE clause;
  `listAllAccounts` does not; `listAllAccounts` SQL is identical to `listAll`.
- `src/data/mappers/__tests__/mappers.test.ts` (+5 tests): round-trip for
  `bulkBatchId` (present + absent/null), round-trip for balance-anchor/deleted
  fields, null-absent mapping, and epoch-ms row encoding.

## Gate results

- `npx tsc --noEmit -p tsconfig.json` — clean.
- `npx eslint src --ext .ts,.tsx` — 0 errors (3 pre-existing warnings in
  unrelated files, unchanged).
- `npx jest` — 13 suites, 154 tests passed (was 144; +10 new).
- `cd android && ./gradlew assembleDebug` — BUILD SUCCESSFUL (local compile
  only, no install, no `adb`, no device touched).
