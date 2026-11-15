# R5h — every SMS sync lands in Pending

Branch `phase/R5h-sync-to-pending` (from `phase/R5e-money-meaning`). Not committed. Code, tests and gates only: no device
work, no adb, no assembleRelease, no new dependency, no new Android permission, no network, no migration, no Kotlin change.
All fixtures are synthetic (QA names, XX1234 / XX9999, refs 000000000xxx).

Owner decision (2026-11-15): items created by ANY SMS sync (Sync now, first sync, re-scan, auto-read of a new SMS, linking
or adding a "New accounts found" group) are never approved silently. They stay `pending` until the user approves them, in
every approval mode. Manual entries (Add Record) are unchanged.

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx eslint src --ext .ts,.tsx` | 0 errors (2 warnings from before this phase: MainTabs, StatTile) |
| `npx jest` | 130 suites, 2392 tests, all pass (was 129 / 2379 after R5e-fix) |
| `node scripts/rules/validate_v2.js …/rules.json` | issuers 51, patterns 157, samples 163, negatives 8, ALL OK |
| `cd android && ./gradlew assembleDebug` | BUILD SUCCESSFUL |

Method: `syncSms.r5h.test.ts` was written first; with the old code 5 of its 12 tests failed (every Automatic-mode case),
then the code made all 12 pass. One earlier full run showed a single timeout in `feedbackMessage.test.ts` (unrelated, load);
the re-runs were green.

## T1 — silent-approve sites found

| # | Site | What it did |
|---|---|---|
| 1 | `syncSms.ts`, after the insert loop: `autoApproveAfterSync` + `store.approve` loop | Approved every new item at or above the threshold in Automatic mode. Covers Sync now, first sync, gap scan, re-scan and the auto-read receiver (all run through `syncSms`; `autoReadRunner` / `syncRunner` only call it). |
| 2 | `importSuggestion.ts` `runImport`: the same `autoApproveAfterSync` + approve loop | Approved items of an added / linked "New accounts found" group. |
| 3 | `autoApproveAfterSync` (`smsSyncLogic.ts`) | The decision function itself; only its `approve` output was acted on. |
| 4 | UI / copy promising silent approval | Settings approval help, threshold line and threshold note; sync toast; link / add snackbar; Activity "N auto-approved" for reader runs; onboarding privacy point and tour text. |

Checked and already safe (no change needed): meaning-rule conversion (`convertByMeaningRule` passes `approve: false`, so the
row keeps `pending`, and it refuses a partner that is not pending); `attachMeaningTwin` (twin is set `rejected`, never
approved); R3a pairing at sync (held, never confirmed); `addTransaction` for SMS rows (always `pending`). User-confirm paths
(`confirmMeaning`, `confirmTransferPair`, Pending buttons, Add Record, "Add as transaction") approve on a user action and are
unchanged.

## T2 — how each changed

- `syncSms.ts`: the approve loop is removed. `autoApproveAfterSync` still runs, only to produce the held-reason counts
  (`heldForTransfer / Duplicate / CardPayment / Rule`), so the result and the `sms_sync` / `sms_rescan` / `auto_read` audit
  shapes are unchanged. `autoApproved` is a constant 0 (kept in the result and the audit counts so existing parsing works).
  No `auto_approved` audit event is written by a sync any more.
- `importSuggestion.ts`: the approve loop and the now-unused hold bookkeeping are removed. The money-meaning step still runs
  (a stored rule may pre-fill a transfer, still pending). `autoApproved` in the outcome is 0.
- `smsSyncLogic.ts`: doc note only (function kept: it mirrors what Pending accepts and feeds the held counts).

## T3 — twins

Unchanged behaviour, now proven: a stored rule converts the debit to a pending transfer; the counterpart SMS is a hidden
`rejected` + `transfer_twin` row; it stays hidden after the user approves the transfer from Pending; `undoMeaning` restores
the transfer to its pending expense and the twin to its pending income exactly (test in `syncSms.r5h.test.ts`, both modes).

## T4 — UI copy

| Where | Now |
|---|---|
| Settings help (ProfileForm) | "Synced items always wait in Pending. On: Pending adds a one-tap Auto-approve for items at or above your threshold. Off: you approve every item yourself." |
| Settings threshold line | "Items with confidence ≥ N% can be approved in one tap from Pending. Nothing is approved until you tap." |
| Threshold note (above 90%) | "…won't get a one-tap Auto-approve for anything yet." (also the Pending hint) |
| Sync toast | no "auto-approved" part |
| Add / Link snackbar | "N transactions added to Pending" (no auto-approved part; View action whenever N > 0) |
| Activity (re-scan / auto-read) | no "auto-approved" part; older audit rows with a count still parse |
| Onboarding privacy point, tour "approval" step | say items wait in Pending / Automatic only adds a one-tap approve |

No layout or control changes, so the 48 dp targets and a11y labels are untouched (the switch label stays "Auto-approve";
the Pending button "Auto-approve (N)" is unchanged). Home has no auto-approve copy.

## T5 — tests

New `syncSms.r5h.test.ts` (12 tests): in BOTH modes, Sync now / first sync, re-scan and the auto-read receiver each create only
pending rows, with no `auto_approved` / `approved` audit and approved totals unchanged (0); a stored meaning rule gives a
pending transfer with a hidden twin, approve works, Undo is exact; held counts still reported (card payment: 1 in
Automatic, 0 in Manual); in Automatic mode the Pending one-tap approve (`autoApproveEligible` + `approve`) approves both
eligible rows on tap and only then do income / expense totals move; manual mode shows no one-tap list.

Group link: `importSuggestion.test.ts` has Add in Automatic mode (3 pending, no audit, snackbar "3 transactions added to
Pending") and Link in Manual mode (3 pending).

Existing tests changed (they asserted silent auto-approval, which is now wrong by the owner decision):

| Test file | Change |
|---|---|
| `syncSms.audit.test.ts` | Automatic mode now expects detected audits only, rows pending, `autoApproved` 0 |
| `syncSms.transfer.test.ts` | the unrelated 250 debit stays pending (was approved); `autoApproved` 0 in two tests; held counts unchanged |
| `syncSms.r5d.test.ts` | clean card payment and the 250 debit: `autoApproved` 0 |
| `syncSms.r5e.test.ts` | EMI / interest / refund and the converted card payment stay pending; `autoApproved` 0 |
| `syncSms.r5g.test.ts` | the agreeing template row is pending (was approved) |
| `importSuggestion.test.ts` | replaced the "approves only items ≥ threshold" test; the Undo test now approves two linked rows by user action first, then checks Undo removes all 3 with the exact audit |
| `syncToast.test.ts` | toast never shows an auto-approved part |
| `ProfileForm.test.tsx` | new threshold-note wording |

## Decisions

1. Remove the approve step instead of adding a flag; keep `autoApproveAfterSync` only for the held-reason counts so every
   result / audit shape stays valid (`autoApproved` kept as 0).
2. The Pending "Auto-approve (N)" and "Approve all N" buttons are untouched: they are user taps. A rule-converted pending
   transfer is eligible for the one-tap approve like any pending SMS item.
3. Existing approved rows are never touched; no migration.

## Anything surprising

- Meaning-rule conversion already kept the row pending; only the later auto-approve step approved it, so removing that step
  was the whole fix for rule-converted rows.
- Existing users with Automatic mode will see Pending fill up after upgrading (and Home "Pending" counts rise).

## DEVICE PLAN (later; not run)

Inline over USB, 30 s idle wait, live per-test status, counts only. Never approve the owner's real rows; use QA rows only
for any approve / Undo.
1. Settings: approval help and threshold copy match the table above; toggling Automatic keeps the sheet height.
2. Record the Transactions money total (income / expense) and the Pending count. Tap "Sync now". The toast reads
   "Scanned N SMS · M new" with no auto-approved part; the Pending count rises by exactly M; the Transactions total is SAME.
3. Repeat in Automatic mode (threshold 90): same result; Pending shows "Auto-approve (K)".
4. QA only: add one synthetic QA item, then approve it and Undo (or delete it); totals return.
5. Re-scan: Pending count change equals the re-scan "new" count; totals SAME. Activity line has no "auto-approved".
6. Logcat: 0 FATAL / ANR; force-stop; restore the original approval mode.
