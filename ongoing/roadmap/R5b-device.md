# R5b device pass (Bills & dues)

Two sessions. The scripted run (2026-11-18) read 4/6/1 and I first blamed the
harness. A hands-on USB debug session (2026-11-21, no script) found the real
cause: **AddBillScreen crashed on open**, so no bill could ever be created — which
is what actually failed the bill-dependent checks. That crash is now fixed and
verified on the device.

Counts only throughout — no database access, no screenshots, no SMS/row/name/
amount opened or printed. QA data only.

## Root cause (the real one): AddBillScreen infinite render loop

Opening **Add bill** crashed the app. Device logcat (crash buffer), release build:

```
FATAL EXCEPTION: mqt_v_native   Process: com.tracker
com.facebook.react.common.JavascriptException: Error: Maximum update depth exceeded.
    at AddBillScreen (index.android.bundle)
```

Cause: `AddBillScreen.tsx` selected the derived list straight out of the Zustand
selector —

```
const accounts = useTransactionsStore(state => activeAccounts(state.accounts));
```

`activeAccounts` calls `.filter(...)`, returning a **new array every render**, so
the store snapshot changed every render and React looped until it threw. The two
other forms that use `activeAccounts` avoid this by selecting the raw array and
deriving in a memo (`TransactionForm.tsx:74`, `TransferForm.tsx:42`).

**Fix** (`AddBillScreen.tsx`): select the raw `state.accounts` (stable ref), then
`const accounts = useMemo(() => activeAccounts(allAccounts), [allAccounts])`.

- Regression test: `AddBillScreen.render.test.tsx` renders the screen with the
  real store and fails if the loop returns (empty `accounts` still loops, because
  `[].filter()` is a fresh array).
- Gates: `tsc` clean, `jest` 136 suites / 2443 tests all pass (was 2442 + this
  one), release build + install `Success`.
- Device, fresh build: Add bill opens; Payee / Type / Amount / Due date render;
  the date picker opens and sets a date; the "Enter a payee, amount and due date"
  validation fires. **0 FATAL/ANR for com.tracker** across many Add-bill opens
  (before the fix it crashed on the first open).

## Why the scripted run (2026-11-18) read 4/6/1

| Check | Script | Corrected reading |
|---|---|---|
| R0 | SKIP | `--skip-install` |
| R1 | PASS | app opens (after the lib.sh cold-start fix below) |
| R2 | FAIL | **test bug.** Searched `Bills & dues`; on-device the label dumps `text="Bills &amp; dues"` (XML-escaped) and the row's `content-desc="Bills and dues"`. Entry exists (`AccountsScreen.tsx:204`). Fixed to match `Bills (and\|&amp;) dues`. |
| R3 | FAIL | account-screen detection (see below) — **not** the AddBill crash; R3 adds an account via `AddAccountScreen`, which has no such loop. |
| R4 | FAIL | **AddBill crash.** The due-tomorrow bill could not be created, so no Home banner ever appeared. (My earlier "banner showed, timeout" note was wrong — it relied on the owner's recollection, not the logcat.) |
| R5 | PASS | trivial pass — banner absent stays absent when there is no bill. |
| R6 | FAIL | **AddBill crash** — same as R4. |
| R7 | FAIL | **AddBill crash** — the due-yesterday bill could not be created, so no Overdue section. |
| R8 | FAIL | same as R7. |
| R9 | PASS* | QA account "gone" by absence — weak (see R3). |
| R10 | PASS | 0 FATAL/ANR at that point (the crash only happens on Add bill, which that run never reached because the bills were never added). |

So four reds (R4/R6/R7/R8) were one real bug — the Add-bill crash — not harness
noise. R2 is a genuine test-string bug. R3/R9 are a real but separate harness
limit. The earlier claim in this file and in commit `ead1709` ("no feature bug
found") was wrong and is corrected here.

## Harness fixes (scripts/device)

1. **`lib.sh phone_time`** — `adb shell date '+%m-%d %H:%M:%S.000'`: host shell
   stripped the quotes, device toybox saw the format split on its space and
   aborted `Max 1 argument`; killed the first run at R1. Fixed by quoting the
   whole remote command. R10's logcat window depends on this.
2. **`lib.sh launch`** — cold React Native start takes >3 s; the 3 s sleep then
   `guard` aborted "Tracker not in front". Raised to 6 s.
3. **`r5b.sh` R2** — ampersand search string (above).

Not changed (verified unnecessary): the bottom-tab taps. The tabs expose both
`content-desc="<glyph>, Accounts"` and a plain `text="Accounts"` node; the
existing `Accounts(, tab.*)?` pattern matches the text node, so navigation was
never the problem. An earlier change broadening those patterns (and bumping the
banner wait to 240 s on a wrong "timeout" theory) was reverted.

## Open harness limits (separate from the crash; need an interactive re-run)

- **Off-screen row detection (R3, R9).** A uiautomator dump only captures the
  visible viewport, so an account below the fold (CREDIT CARDS & PAY LATER group)
  reads as absent. A scroll-then-check would fix it; deferred because a blind
  swipe during an owner-action window can disrupt the owner.
- **R9 confirms removal by absence**, which an off-screen account also satisfies.

## Still to verify live (blocked only by manual form entry, not by a bug)

Creating a bill through adb is unreliable (the soft keyboard occludes the amount
field, and BACK-to-hide vs BACK-to-navigate is ambiguous), so the live
`Overdue (N)` / `Due soon (N)` / Home-banner node matches were not captured.
Source confirms the shapes: banner `"N bill(s) due — …"` is one Text node
(`DueBillsBanner.tsx:54`) and section headers are `"{title} ({count})"` one Text
node (`BillsScreen.tsx:162`), both of which the script regexes match. Now that the
crash is fixed, the owner (or a future interactive run) can add the two QA bills
and confirm R4/R6/R7/R8 end to end.

## Cleanup

No bill was saved (the adb attempts all failed validation). No QA account created
by this session. No settings changed (beyond `svc power stayon true` to stop the
screen sleeping over USB). No uiautomator process or `/sdcard/u.xml` left on the
phone; pulled dumps (which held real SMS) were deleted from the scratchpad.

## Verdict

One real feature bug: the Add-bill crash, now fixed, tested and device-verified
(0 crashes). One real test-string bug (R2) fixed. R3/R9 off-screen detection and
the live banner/section node capture remain for an interactive re-run.
