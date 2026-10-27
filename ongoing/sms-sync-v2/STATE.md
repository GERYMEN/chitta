# Task: SMS Sync v2 — scan windows, suggestion decisions, balance anchor, periods, soft delete

Governing spec: `ongoing/sms-sync-v2/skill/SKILL.md` (+ its `references/*.md`),
a packaged skill the product owner (Siraj) provided
(`Tracker/tracker-sms-sync.skill`, extracted here). It is the single source
of truth for decisions D1–D11 already agreed. Read it in full before writing
any phase prompt. Do not re-litigate D1–D11; only the "Open questions"
section required asking, and those are now answered (below).

This supersedes/extends Phase 7 of `ongoing/realtime-persistence/` (the v1
heuristic SMS account-matching built earlier this session) — D4's
`normalizeAccountKey` replaces Phase 7's inline regex matching, D5's
suggestion rules replace Phase 7's simpler "unmatched → suggest" grouping,
etc. Read `ongoing/realtime-persistence/STATE.md` in full first anyway: its
decisions log documents four real incidents (Messages-app visit, a leaked
merchant/amount, a direct sqlite3 db edit, and an opencode sandbox quirk with
`/sdcard` paths) and the hard rules that resulted — `skill/references/
device-safety-rules.md` restates most of them verbatim, but the `/sdcard`
sandbox-path quirk is NOT in the skill file (it's an opencode infra quirk,
not a product decision) — still apply it to every device-touching phase.

## Open questions — now answered (do not ask again)

- D9 "1Y" = trailing 12 months (rolling), consistent with 1M/3M/6M/9M —
  NOT calendar year. No separate calendar-year picker needed for v1.
- D1 default scan-window chooser selection = **"From install"** (not the
  skill's own assumed "Last 90 days" default — the user chose differently).
  This means a fresh install's first sync finds nothing retroactive; show
  the "We'll detect accounts as new bank SMS arrive" message per D1, not an
  empty dead end. Historical backfill only happens if the user manually
  widens the window later.
- D8 bulk approve gets a real UNDO (revert the whole batch back to pending).
  This requires extending `canTransition` (`src/domain/transactions/
  transaction.rules.ts`) to allow `approved → pending` for a bulk-undo
  action specifically — confirm whether this should be gated to
  bulk-approved transactions only (via `bulk_batch_id` IS NOT NULL) or
  allowed generally; default to gating it to batch-undo only unless a later
  phase finds a reason to generalize it.
- Ignored accounts/banks NEVER re-surface automatically, ever, regardless
  of message volume — matches the skill's own stated default. Only
  un-hiding from "Hidden accounts" (D6) brings one back.

## Relationship to the existing codebase (verified ground facts)

- Current Phase 7 state (from `ongoing/realtime-persistence/07-sms-account-matching.md`):
  `src/features/sms-sync/smsParser.ts` has inline `bankName`/`accountKind`/
  `lastFour` regex extraction (confirmed buggy for "SBI Card ending ####"
  style messages — QA Phase 9 is independently confirming this right now).
  `smsSyncLogic.ts` has `resolveAccountIdForSms` (exact type+lastFour match,
  no fallback) and `groupUnmatchedIntoSuggestions`. `syncSms.ts` orchestrates
  a single non-resumable full-inbox-limit-200 scan. None of this has D1's
  scan window, D2's chunking/resumability, D3's persisted decisions, D4's
  normalized/versioned key, or D6's hidden-accounts undo. This v2 work
  replaces/extends all of it per the skill's build order.
- `src/data/db/schema.ts` / `migrations/` (see Phase 6's `app_settings`
  table addition) — this v2 work adds the tables/columns in
  `skill/references/schema.md` via the same `CREATE TABLE IF NOT EXISTS`
  pattern already established.
- `src/domain/accounts/account.rules.ts`'s `calculateBalance` — D7 changes
  this function's own logic (balance anchor), not a parallel/forked
  function. Must be extended with tests, not duplicated.
- Native `SmsReaderModule.kt`/`SmsReaderPackage.kt` (Phase 4) already reads
  the inbox; D2's native pre-filter is new work inside that same module
  (filter bank-like senders before crossing the bridge), not a replacement
  module.

## Build order (from SKILL.md — dispatch one orchestrator-executor phase per
   step, or grouped sensibly where a step is small; device-touching phases
   must not run concurrently with another phase also using the device)

| # | step | status |
|---|------|--------|
| 1 | `normalizeAccountKey` + tests (pure function, no device needed) | DONE — `src/features/sms-sync/normalizeAccountKey.ts` created with the bank alias map, lastFour format coverage, accountKind precedence, `accountKeyToString`. 56 new tests, 144 total passing, all gates clean. Explicitly proven: "SBI Card ending 5368" and "SBI A/C 5368" both now resolve to `bankCanonical: 'sbi'` (previously both fell to 'unknown' in Phase 7's parser). NOT YET WIRED into smsSyncLogic.ts/smsParser.ts — that's a later step. |
| 2 | Migrations: decisions, candidates, sync runs, anchor columns, deleted_at, indexes | DONE — `src/data/db/migrations.ts` adds real versioning (`schema_migrations` table + numbered, once-only ALTER TABLE migrations); new tables (account_suggestion_decisions/candidates, sms_sync_runs) + 2 indexes added idempotently; `ux_tx_source_hash` fails loud with zero data deletion if duplicates exist. Domain types/mappers/repositories extended (`listActiveAccounts`/`listAllAccounts` added, nothing wired into screens yet — zero behavior change). 154 tests passing, all gates clean. On-device verification of the actual ALTER against this device's real accumulated data still deferred to a later phase. |
| 3 | Chunked resumable scan + native pre-filter + incremental cursor + scan-window setting/backfill | pending |
| 4 | Balance anchor in `calculateBalance` + "Set balance" UI states | PARTIAL — pure-math half DONE (`calculateBalance` generalized in `src/domain/accounts/account.rules.ts`: anchor overrides opening balance when set, strictly-after-anchor transaction filtering, byte-identical to old formula when anchor is null). 160 tests passing, zero behavior change for existing accounts, zero device work. The "Set balance" UI state and the determination of WHICH accounts need an anchor (naturally tied to SMS-suggestion account creation, not yet built) remain — deferred to whichever later phase actually creates SMS-sourced accounts. |
| 5 | Suggestion rules: threshold, decision resolution, Add/Link/Ignore/Later, batched rescan | pending |
| 6 | Permission states + manual path (parallel with 3–5) | pending |
| 7 | Period filter: `periodRange`, SQL aggregates, store refactor, partial-data notice | PARTIAL — pure-math slice DONE: `src/domain/periods/{period.types.ts,period.rules.ts}` created, `periodRange` correctly implements 1M/3M/6M/9M (rolling month-start) and 1Y as trailing-12-months (explicitly NOT calendar year, regression-tested). 178 tests passing, zero device work. SQL aggregates, Zustand store refactor, and the period-selector/partial-data-notice UI remain for a later device-verified phase. |
| 8 | Bulk approve with confidence warning + undo | pending |
| 9 | Soft delete + label + Hidden accounts + Restore | pending |

## Decisions log

- 2026-10-25: EXECUTOR CHANGE — no more opencode/deepseek (out of balance).
  Future phases dispatch to Claude subagents via the Agent tool, reading
  the phase prompt file. Same structure and safety rules otherwise.

- 2026-10-25: Task created from the user-provided `.skill` bundle. Extracted
  to `ongoing/sms-sync-v2/skill/` for a durable, diffable copy (the original
  `.zip`-format `.skill` file stays at the project root, untouched). Four
  open questions answered via AskUserQuestion (recorded above) before any
  implementation began, per the skill's own "ask, do not decide" instruction.
- 2026-10-25: Sequencing decision — `ongoing/realtime-persistence/`'s Phase 9
  (QA test suite) was still running on the device when this task was set up.
  Step 1 (`normalizeAccountKey` + tests) is pure TypeScript/Jest, touches no
  device, and was dispatched immediately without waiting. Every later step
  (2 onward) touches the device or shares build/install state and must wait
  for Phase 9 to fully complete first — do not dispatch concurrently.
