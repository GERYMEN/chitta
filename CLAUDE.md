# Tracker — agent guide

Personal finance Android app. React Native + TypeScript, SQLite, Zustand. Reads
bank SMS, builds accounts/transactions/bills/budgets locally. **Privacy-first:
no backend, no network except RN defaults. All money data stays on device.**

Read this before touching the repo. It replaces relearning conventions by
reading source. Keep it current when a convention changes.

## Token discipline (READ FIRST — this repo is large)

62k lines / 411 TS files. Do NOT read broadly. Rules:

- **Never `Read` these whole — grep/jq only:**
  - `src/features/sms-sync/rules/rules.json` (9,857 lines, GENERATED — edit
    `scripts/rules/` inputs + rebuild, never hand-edit). Query with
    `jq`/`grep`.
  - `src/test/fixtures/smsReader.fixture.ts` (840) + anything under
    `*fixture*` (2k lines total).
- **Big source files — read the target range, not the file:**
  `src/features/transactions/state/transactionsStore.ts` (1,571),
  `src/features/activity/activityFeed.ts` (979),
  `src/features/sms-sync/parser/readSms.ts` (890),
  `src/features/transactions/components/TransactionDetailContent.tsx` (863),
  `src/features/sms-sync/syncSms.ts` (674).
- **Old phase reports** (`ongoing/roadmap/R*-*.md`, 5.7k lines) are history.
  Don't load them by default. `ongoing/roadmap/STATE.md` is the one live
  status source.
- **Don't spawn a swarm by default.** One reviewer is enough. Reserve
  multi-finder + adversarial-verify review for high-risk phases only: SMS
  parsing, crypto/backup, DB migrations.

## Gates (run before claiming done)

Cheap variants first — don't dump the full suite unless a gate fails.

```bash
npx tsc --noEmit                              # typecheck
npm run lint                                  # eslint . (expect 0 errors)
npx jest --silent --onlyChanged              # tests for changed files
# full suite only at phase end / before commit:
npx jest --silent
# if sms-sync/rules touched:
node scripts/rules/validate_v2.js src/features/sms-sync/rules/rules.json
# build (debug):
cd android && ./gradlew assembleDebug
```

Owner's-phone release build: `./gradlew assembleRelease -PtrackerDebugSigning`.
Private-key release needs `~/.gradle/gradle.properties` TRACKER_RELEASE_*.

## Layout

- `src/data/db/` — SQLite. `schema.ts`, `migrations.ts`. Migrations are
  **additive, `CREATE IF NOT EXISTS`**, next number continues from the last
  (currently 15 used by R10; next = 16). Every new table added to BACKUP_TABLES
  with `sinceVersion = <its migration>` (old-backup safe).
- `src/features/<name>/` — one folder per feature (accounts, transactions,
  bills, budgets, sms-sync, insights, review, chains, meaning, refunds,
  transfers, duplicates, pending, …). State in `state/<name>Store.ts` (Zustand).
- `src/domain/` — pure rules. `src/shared/` — shared UI (Snackbar, headers).
- `src/native/` — Kotlin bridges (SMS read, backup crypto).
- `scripts/rules/` — rules.json build + validate. `scripts/device/*.sh` — adb
  device-test scripts (counts-only, safety rails).
- `ongoing/roadmap/` — ROADMAP.md (R1–R12 plan), STATE.md (live status),
  prompts/, reports.

## Conventions

- **Money = integer minor units** (paise). Never float. Display via
  `formatRupeesFromMinor` (also applies redaction masking).
- **Zustand selectors must return stable refs.** Select raw `state.x`, derive
  with `useMemo` in the component. Selecting a freshly-filtered array *inside*
  the selector caused the R5b `AddBillScreen` infinite-render crash — don't.
  Pattern: `const accounts = useStore(s => s.accounts); const active =
  useMemo(() => activeAccounts(accounts), [accounts]);`
- **Audit rows: ids / enums / numbers only. Never SMS body, merchant name,
  or last-4 in audit metadata.** sanitize to allow-list on read+write.
- **Privacy / leak-scan:** no real names, numbers, or SMS bodies in repo files
  (code, tests, reports, prompts, rules `_doc`). Tests use synthetic refs
  (`000…`) + public bank sender codes only. Leak-scan regex is passed in
  dispatch messages, never committed.
- SMS content handled one-way only (SHA-256 content hash for dedupe). Body
  read live, never stored.
- Charts: plain RN Views behind a `ChartBars`-style interface (swappable); donut
  uses react-native-svg (Home card only).

## Workflow

- Branch per phase from `main` (e.g. `phase/R6-...`). Device passes often lag
  code — STATE tracks which phases are device-verified vs pending.
- Executor = Claude subagent. **Never opencode/deepseek for this repo.**
- Update `ongoing/roadmap/STATE.md` when a phase moves.
