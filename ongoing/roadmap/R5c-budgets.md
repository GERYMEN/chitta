# R5c — Budgets (executor report)

Branch: `phase/R5c-budgets`. Scope: monthly spending budgets — one overall ring
+ per-category, 80% amber, over red. In-app only; no permission, no dependency,
no network, no new third-party library. Budgets are a READ-ONLY overlay on spend
(D-f): setting/removing one writes only the `budgets` table + one audit row and
NEVER touches a balance or a transaction.

## Gates (all green)

- `npx tsc --noEmit -p tsconfig.json` — clean.
- `npx eslint src --ext .ts,.tsx` — 0 errors (2 pre-existing warnings in
  `MainTabs.tsx` and `StatTile.tsx`, untouched by this phase).
- `npx jest` — 144 suites, **2507 passed / 2507** (was 2503 before this phase;
  +4 net new pass count after the added/updated tests).
- `node scripts/rules/validate_v2.js src/features/sms-sync/rules/rules.json` —
  `ALL OK` (issuers 51, patterns 157, samples 163, negatives 8). No rules.json
  change — run only to confirm no regression.
- `cd android && ./gradlew assembleDebug` — BUILD SUCCESSFUL. (assembleRelease
  NOT run.)

## Tasks

- **T0 — done.** Migration 13 + `budgets` table; `src/domain/budgets/`
  (`budget.types.ts`, `budget.rules.ts`); `budget.repository.ts` (upsert-by-key,
  enforces a single overall + single per-category budget); a dedicated
  `useBudgetsStore` (the billsStore / chainSuggestions pattern — no separate
  categories store exists, so a small dedicated store matches the codebase).
  Backup coverage (`backup.tables.ts`, sinceVersion 13) + old-backup restore
  test. `reloadAfterRestore` now refreshes the budgets store.
- **T1 — done.** Pure budget-vs-actual domain (D-b/D-c): current-calendar-month
  range (= insights `periodRange('1M', now)`), overall + per-category progress
  (actualMinor, budgetMinor, ratio, state, remaining/over), `budgetState`,
  `budgetSummary`. Unit tests incl. linked-refund-reduces-spend and
  transfers-excluded cases (they flow through the reused selectors).
- **T2 — done.** `BudgetsScreen` (overall set/edit + remove, per-category
  add/edit/remove with a 5 s shared-Snackbar Undo, bars + state colours,
  category chooser with radio role/state, >0 amount validation) and
  `SetBudgetScreen` (overall / add category / edit category).
- **T3 — done.** `BudgetCard` on Home (slotted just above WhereItWentCard; shown
  only when ≥1 budget is set; overall bar + state colour + one-line "N over
  budget" / "N near limit"; every amount via `formatRupeesFromMinor`, so the
  redaction flag masks it). Settings entry added to `ProfileSettingsSheet`
  (`onOpenBudgets`, wired from Home).
- **T4 — done.** Audit types `budget_set` / `budget_updated` / `budget_deleted`
  (metadata = categoryId|null, amountMinor, and `fields` for update — ids / enums
  / numbers only) + Activity feed icons and masked-amount sentences.
- **T5 — done.** `scripts/device/r5c.sh` (counts-only, owner-assisted, 30 s idle,
  Tracker-in-front guard, fresh dump before each tap, QA data only, cleanup at
  the end, no screenshots, no db access). `bash -n` passes; NOT run. README.md
  updated with the R5c section.

## Migration

- **Number 13** (additive; HIGHEST was 12). `CREATE TABLE IF NOT EXISTS budgets`
  + `CREATE INDEX IF NOT EXISTS ix_budgets_category ON budgets(category_id)`.
- Columns: `id TEXT PK`, `category_id TEXT` (nullable — NULL = the overall
  budget), `amount_minor INTEGER NOT NULL`, `period TEXT NOT NULL DEFAULT
  'monthly'`, `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`.
- `CURRENT_SCHEMA_VERSION` is derived from `NUMBERED_MIGRATIONS`, so it bumped to
  13 automatically. `migrations.test.ts` updated (m12 no longer "last"; m13 is).

## Where budget "actual" comes from (reuse points)

The existing R4 insights selectors are the only source of budget actual — no
transactions are re-summed:

- **Overall actual** = `periodTotals(transactions, range).expenseMinor`
  (`src/domain/insights/insights.rules.ts`).
- **Per-category actual** = the matching `spendByCategory(transactions, range)`
  row's `spendMinor`, matched by `categoryId`.
- Both inherit the R3a/R3b netting via `spendContributionMinor` /
  `incomeContributionMinor`: transfers and transfer twins never count, hidden
  duplicates never count, and a linked refund reduces its category's spend in
  the refund's own period. A net-refund category clamps to 0 actual.
- The range is `periodRange('1M', now)` (D-b: current calendar month, 1st 00:00
  local → now), with `now` from `useNow`, so budgets roll at the month boundary
  and agree with the Home income/expense tiles.

## State thresholds (D-c)

`budgetState(actualMinor, budgetMinor)` → `'under' | 'near' | 'over'`:
- ratio < 0.8 → `under` (green);
- 0.8 ≤ ratio ≤ 1.0 → `near` (amber);
- ratio > 1.0 → `over` (red);
- budget ≤ 0 → treated as unset → `under` (nothing to warn).

Colours come from theme tokens only (no hardcoded hex in components):
under = `colors.primary` on `transactionStateColors.approved.bg`; near =
`transactionStateColors.pending` (fg/bg); over = `transactionStateColors.failed`
(fg/bg). Mapped in `src/features/budgets/budgetLabels.ts`.

## Tests added / changed

Added:
- `src/domain/budgets/__tests__/budget.rules.test.ts` — thresholds (incl. the
  exact 0.8 and 1.0 boundaries and budget ≤ 0), amount validation,
  current-month range, lookups, overall actual from periodTotals (transfers &
  pending excluded, refund reduces), per-category actual from spendByCategory
  (refund-reduced, 0 when no spend, clamp at 0), visibleCategoryBudgets (archived
  & deleted hidden), budgetSummary near/over counts.
- `src/data/repositories/__tests__/budget.repository.test.ts` — insert +
  budget_set audit; per-category insert; upsert replaces (budget_updated, no
  duplicate); single-overall enforcement; no-op re-set; independence of
  overall/category; remove + budget_deleted + Undo; listAll mapping.

Changed (and why):
- `src/data/db/__tests__/migrations.test.ts` — m12's "is the last migration"
  assertion was moved to a new m13 test (the migration count grew); added an
  m13 shape test + a run-once test.
- `src/data/repositories/__tests__/backup.repository.test.ts` — the "N-1 → N"
  boundary test was pinned to v11 (kept as an explicit R5i v11 test) and a new
  "N-1 → N (R5c)" v12 test + "current backup carries budgets" test added, because
  `CURRENT_SCHEMA_VERSION - 1` is now 12.
- `src/test/fixtures/backupRows.fixture.ts` — added `budgets` rows (overall +
  one category), required by the full-round-trip and catalogue tests now that
  `budgets` is a backup table.

## Decisions beyond D-a..D-h

- **Dedicated budgets store** (`useBudgetsStore`) rather than a transactions-store
  slice — the codebase already uses per-feature stores (bills, chains) over their
  repositories; there is no categories store to piggyback on.
- **Singleness enforced in TS, not by the index.** D-a's index is a plain index
  on `(category_id)` (SQLite treats NULLs as distinct in a UNIQUE index, so a
  UNIQUE could not stop two overall budgets). `setBudget` upserts by key and, on
  insert, first deletes any stray row for that key — defence in depth.
- **`budget_updated` carries `fields: ['amountMinor']`** (only the amount can
  change on an existing budget) to match the existing audit "changed field" shape.
- **No-op re-set**: setting the same amount for an existing key writes nothing
  (no audit, no transaction).
- **"Over budget" uses `≤` on the near band and `>` on 1.0** so exactly at the
  cap reads "near", not "over" (D-c "0.8..1.0 inclusive-ish").

## Known limits

- The Budgets screen has no deep link; it is reached from the Settings entry or
  the Home Budget card. (Matches Bills.)
- Budget actual is this calendar month only (D-b). No trailing-window budgets,
  no weekly/other periods — the `period` column is reserved for later.
- `budget.rules.ts` has no standalone JVM/device test for the SQL path; the
  repository is covered by the fake-DB unit tests and the real-SQLite backup
  catalogue/round-trip tests.

## Running the device script

```
scripts/device/r5c.sh                 # build + install update, then test
scripts/device/r5c.sh --skip-install  # test the app already installed
```

Counts-only, owner-assisted (30 s idle, `>>>` prompts, ~3 min per step). It
adds/removes only QA budgets and never touches the owner's real budgets; if real
budgets already exist, the clean-start/clean-up checks are SKIPPED. See
`scripts/device/README.md` → "R5c — Budgets".
