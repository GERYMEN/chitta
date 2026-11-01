# R4c — Floating feedback button (WhatsApp) + first-run tour: report

Executor: Claude subagent. Date: 2026-11-01. Branch: `phase/R4c-feedback-tour` (from `phase/R4b-sms-sync-start`). Nothing was committed or staged.

This dispatch was **code + tests + gates only**. There was no device work: no adb at all.

## Summary

- **Gates: all pass.**
  - `npx tsc --noEmit -p tsconfig.json` is clean.
  - `npx eslint src --ext .ts,.tsx` has 0 errors and 2 warnings, both already there (MainTabs nested component, StatTile inline style).
  - `npx jest`: 83 suites, 769 tests, all pass. Baseline was 75 suites and 710 tests, so +8 suites and +59 tests.
  - `./gradlew assembleDebug`: BUILD SUCCESSFUL.
- **Files: 59 source/test files** (32 modified, 27 new), plus this report. `ongoing/roadmap/STATE.md` was already modified by the orchestrator and was not touched.
- **No new dependency and no new permission.**
  - The main manifest still has only INTERNET + READ_SMS. The one new manifest entry is a FileProvider `<provider>`, which is not a permission.
  - There is no `<queries>` block. Share targets are tried with `startActivity` and `ActivityNotFoundException` is caught, and that needs no package visibility.
  - There is no VIBRATE permission and no haptics.
- **No migration.** The new keys (`tour_completed_at`, `feedback_button_position`) go in the existing `app_settings` table and are not audited.

## Files

**New (27)**

- **Native** (4)
  - `android/app/src/main/java/com/tracker/FeedbackModule.kt`: capture, cleanup, share, constants.
  - `android/app/src/main/java/com/tracker/FeedbackPackage.kt`
  - `android/app/src/main/java/com/tracker/FeedbackFileProvider.kt`: an empty subclass of androidx `FileProvider`, so it cannot clash with a library's provider in the manifest merge.
  - `android/app/src/main/res/xml/feedback_paths.xml`: `cache-path` `feedback/` only.
- **Native JS wrapper:** `src/native/android/feedback/feedbackNative.ts`
- **Redaction:**
  - `src/shared/privacy/redaction.ts`: the one global flag plus helpers.
  - `src/shared/privacy/index.ts`
- **Feedback:**
  - `src/features/feedback/feedback.constants.ts`: the phone number lives here, once.
  - `src/features/feedback/widgetMachine.ts`: the pure reducer, plus geometry, visibility and the saved position.
  - `src/features/feedback/feedbackMessage.ts`: the pure message builder, wa.me link, validation, counter and fallback chain.
  - `src/features/feedback/feedbackFlow.ts`: redacted capture, the share chain runner, and waiting for the user to return.
  - `src/features/feedback/components/FeedbackWidget.tsx`
  - `src/features/feedback/components/FeedbackSheet.tsx`
- **Tour:**
  - `src/features/tour/tourModel.ts`: steps, step outcome and trigger rules (pure).
  - `src/features/tour/tourLayout.ts`: spotlight, hole frame, tooltip placement and scroll delta (pure).
  - `src/features/tour/tourTargets.ts`: the target registry (`useTourTarget`) and the scroller registry.
  - `src/features/tour/tourStore.ts`: the zustand store, `initTourOnLaunch`, `requestTourAfterSetup` and `replayTour`.
  - `src/features/tour/components/TourOverlay.tsx`
  - `src/features/tour/components/TourTarget.tsx`
- **Tests** (8)
  - `src/features/feedback/__tests__/widgetMachine.test.ts`
  - `src/features/feedback/__tests__/feedbackMessage.test.ts`
  - `src/features/feedback/__tests__/feedbackFlow.test.ts`
  - `src/features/feedback/__tests__/FeedbackSheet.test.tsx`
  - `src/features/tour/__tests__/tourModel.test.ts`
  - `src/features/tour/__tests__/tourLayout.test.ts`
  - `src/features/tour/__tests__/tourStore.test.ts`
  - `src/shared/privacy/__tests__/redaction.test.tsx`

**Modified (32)**

- **Native:**
  - `AndroidManifest.xml` (the provider)
  - `MainApplication.kt` (`add(FeedbackPackage())`)
- **App shell:**
  - `src/app/App.tsx` mounts `FeedbackWidget` + `TourOverlay` once, above the navigator. On start it clears old screenshots and runs `initTourOnLaunch` after hydrate.
  - `src/app/navigation/MainTabs.tsx`: the Pending tab icon is a tour target.
- **Redaction (shared):**
  - `src/shared/utils/currency.ts`
  - `src/shared/ui/AmountText/AmountText.tsx`
  - `src/shared/ui/TransactionRow/TransactionRow.tsx`
  - `src/shared/ui/Snackbar/Snackbar.tsx`
  - `src/domain/accounts/account.rules.ts` (`accountDisplayLabel` last-4)
  - `src/theme/colors.ts` (`whatsapp`, `onWhatsapp`, `scrim` tokens)
- **Redaction (screens and labels):**
  - `HomeScreen.tsx`
  - `TransactionsScreen.tsx`
  - `TransactionDetailScreen.tsx`
  - `TransactionDetailContent.tsx`
  - `OriginalSmsView.tsx`
  - `AccountsScreen.tsx`
  - `PendingScreen.tsx`
  - `PendingTransactionCard.tsx`
  - `UncategorisedRow.tsx`
  - `CategoriesScreen.tsx`
  - `InsightsScreen.tsx`
  - `ReviewSections.tsx`
  - `SmsSuggestionsScreen.tsx`
  - `suggestionGroups.ts`
  - `ActivityScreen.tsx`
  - `activityFeed.ts` (`hideNames` option)
  - `refundLabels.ts`
  - `duplicateLabels.ts`
  - `smsParser.ts` (the stored preview now uses the never-redacted `formatRupeesPlain`)
- **Tour wiring:**
  - `BalanceCard.tsx` (Sync SMS target)
  - `HomeScreen.tsx` (period target, scroller, Replay)
  - `ProfileSettingsSheet.tsx` (the "Replay tour" row, optional prop)
  - `SyncStartScreen.tsx` (`saveOnboardingSyncStart` → `requestTourAfterSetup`)
  - `TransactionsScreen.tsx` (search + filters target)
  - `AccountsScreen.tsx` (balance card target)

## Part A — Feedback button

### State machine (`widgetMachine.ts`, pure `widgetReducer`)

| From | Event | To | Notes |
|---|---|---|---|
| DOCKED | tap | EXPANDED | A tap on DOCKED only expands. It never opens the sheet. |
| DOCKED | tap with a screen reader on (or the TalkBack `activate` action) | CAPTURING_SCREENSHOT | Single-step path for TalkBack. |
| EXPANDED | tap | CAPTURING_SCREENSHOT | The button hides and the app goes REDACTED. |
| EXPANDED | 3000 ms with no touch | SNAPPING | A timer in the component dispatches `IDLE_TIMEOUT`. Leaving EXPANDED clears it. |
| DOCKED / EXPANDED / SNAPPING | move ≥ 6 dp | DRAGGING | Scale 1.08, stronger shadow, follows the finger (translate, native driver). The idle timer is cleared. |
| DRAGGING | release | SNAPPING | Side = `centerX < width/2 ? left : right`. Y = the release Y, clamped. |
| SNAPPING | spring end | DOCKED | Side + Y are saved to `feedback_button_position` (app_settings, not audited). |
| SNAPPING | tap | EXPANDED | |
| CAPTURING_SCREENSHOT | capture done or failed | FEEDBACK_MODAL_OPEN | A failure opens the sheet with no screenshot. |
| FEEDBACK_MODAL_OPEN | ✕ / backdrop / Send | DOCKED | |
| FEEDBACK_MODAL_OPEN | Retake / Add | CAPTURING_SCREENSHOT | The sheet closes, the app waits 280 ms, recaptures, and the sheet reopens. |
| DOCKED | RESTORE (saved position) | DOCKED | The saved position is applied at mount. |

**Geometry and look**

- The button is 52 dp, obsidian, and uses the `message-alert-outline` icon. Its `accessibilityLabel` is "Send feedback".
- **Docked:** translateX = −65% of the button (left side) or width − 35% (right side). Opacity 0.3, with a hairline border and a light shadow.
- **Expanded:** 16 dp from the edge, opacity 1, spring.
- **Y clamp** (centre) uses the real insets:
  - Top: `[insets.top + 72 + 26`
  - Bottom: `height − insets.bottom − 88 − 26]`
- There is only one trigger, with no speed-dial.

**Hidden** (`isWidgetVisible`, unit-tested):

- On the onboarding and setup routes: Onboarding, ProfileSetup, Permissions, SyncStart.
- On the form screens: AddRecord, EditTransaction, AddAccount.
- While the keyboard is open.
- While capturing, so it is excluded from the image.
- While the sheet is open.
- During the tour, except on step 6. On step 6 it shows in the expanded position, and the overlay blocks taps on it.

### Native API (`TrackerFeedback`, FeedbackModule.kt)

| Method / constant | Behaviour |
|---|---|
| constants `versionName`, `versionCode`, `androidRelease`, `brand`, `model` | Read from PackageManager and `Build`. Device info only. |
| `captureScreen()` | Captures the current Activity window into a bitmap: PixelCopy on API 26+, otherwise `decorView.draw(Canvas)`. Off the UI thread it **deletes the old files in cache/feedback/**, writes `feedback-<ms>.png` and resolves `{uri, path, width, height, bytes}`. |
| `clearScreenshots()` | Deletes everything in cache/feedback/. It is called on every app start (App.tsx). |
| `deleteScreenshot(path)` | Used by Remove and before a Retake. It only deletes a file directly inside cache/feedback/ (canonical-path check). |
| `shareToPackage(pkg, jid, text, path?)` | `ACTION_SEND` + `EXTRA_TEXT`. With a screenshot it adds a FileProvider uri (`<applicationId>.feedbackprovider`), `EXTRA_STREAM`, ClipData and `FLAG_GRANT_READ_URI_PERMISSION`. It sets the package and puts `jid` = `919656921869@s.whatsapp.net`. It resolves `sent`, or `not_installed` on `ActivityNotFoundException`. Only `com.whatsapp` and `com.whatsapp.w4b` are accepted. |
| `shareChooser(text, path?)` | The same intent wrapped in `Intent.createChooser`. |

**Privacy of the image**

- It is never logged, uploaded or copied by the app. Error messages are fixed strings.
- The only file is the cache PNG. It is deleted on the next capture, on Remove or Retake, and on the next app start.
- It is kept after Send so WhatsApp can still read the granted uri while the chat is open.

### Redaction (one global flag: `src/shared/privacy/redaction.ts`)

Capture sequence (`captureRedactedScreenshot`):

1. The widget enters CAPTURING, which unmounts the button.
2. `setRedacted(true)`.
3. Wait two animation frames plus 120 ms.
4. Native capture.
5. `finally setRedacted(false)`. Restore always runs, including after a failure, and this is tested.

**Covered while the flag is on:**

- **Every amount** shown through `formatRupeesFromMinor` (→ `₹ ••••`), and so through `AmountText`. This covers:
  - Home total balance, income/expense tiles and Where it went
  - Transactions INFLOW/SPENT/NET and the day "Net" chips
  - Accounts total and per-account balances
  - Insights totals and chart labels
  - Detail amount and the Approve button label
  - Review pair titles, refund labels and suggestion In/Out
  - Activity, where amounts are forced masked
- **Merchant / payee names:**
  - TransactionRow (Home recent, Transactions list)
  - Pending cards
  - Uncategorised rows
  - Detail screen title, "Duplicate of …", refund rows, "Refund for …"
  - Duplicate row lines
  - Suggestion waiting items
  - Activity sentences (`hideNames`)
  - Categories → Merchant rules
  - The Transactions merchant filter chip
  - The Transactions search text
- **Notes:** the detail "Personal Note".
- **SMS text:**
  - sanitizedPreview (detail "Sanitized source message", Uncategorised "SMS description", suggestion items)
  - Original SMS sender + body (`OriginalSmsView`)
  - The detail SMS "Ref ID"
- **Account last-4:**
  - `accountDisplayLabel` (active + deleted), so every caller is covered: detail rows, transfer subtitles/routes, Pending group headers, Uncategorised meta, filter pickers, duplicate titles
  - Activity account labels
  - AccountsScreen card subtitle
  - Transactions account chip
  - Suggestion card titles
- **The user's name:** the Home greeting (it reads "Welcome") and the avatar initial.
- **Snackbar:** hidden entirely while capturing, because its text is precomputed and may name a merchant or amount.

**Re-render:**

- Shared components (AmountText, TransactionRow, PendingTransactionCard, UncategorisedRow, OriginalSmsView, TransactionDetailContent) subscribe with `useRedacted()`.
- So do the screens that format text inline: Home, Transactions (+ `extraData`), Accounts, Pending (memo dep + `extraData`), Insights, Detail, Review, Suggestions, Categories, Activity (memo dep).
- `smsParser` now uses `formatRupeesPlain`, so a sync that runs during a capture can never store a masked preview.

**Screen text NOT covered (redaction gaps):**

1. **Account names and bank names** are not masked; only last-4 is. Examples: "QA Bank ••••" on detail, transfer subtitles, Pending group headers, suggestion card titles, Activity sentences, Accounts cards.
2. **Category names**, including custom ones, are not masked: chips, Where it went, Insights, Categories list.
3. **Dates and times, item counts** ("N waiting", "Showing X of Y"), **period captions and confidence %** are not masked.
4. **Chart bar heights** still show relative sizes. There are no numbers on them.
5. **Accessibility labels** keep names. They are not drawn, so they are not in the image.
6. **Form inputs** (AddRecord, EditTransaction, AddAccount) are not masked. The button is hidden on those screens, so they cannot be captured.
7. **Modal surfaces** are not masked: every BottomSheet (incl. Settings with the name field), every Dialog, the category/account pickers, the refund picker, and system Toasts. They are separate windows that PixelCopy of the activity window does not include. The button also cannot be tapped while a modal covers the screen.
8. **Onboarding screens:** the button is hidden there.

### Share Feedback sheet (`FeedbackSheet.tsx`, reuses BottomSheet)

- **Header:** "Share Feedback", the badge `v<versionName> (<versionCode>)` from the native constants, and ✕ (48 dp).
- **Pills:** "Bug 🪲" / "Idea 💡" / "Review 💬". Single select, radio role, default Bug, each ≥ 48 dp.
- **Note:**
  - Multiline, `maxLength` 500, with a live `N/500` counter.
  - Placeholder: "What happened, or what would make Tracker better? Steps to reproduce help a lot."
- **Screenshot:** a thumbnail with "✓ Screenshot (auto-captured, amounts hidden)", plus [Retake] and [Remove]. After Remove the sheet shows "No screenshot attached" and [Add], where Add recaptures.
- **Send:**
  - One primary button, "Send on WhatsApp", with the `whatsapp` token #25D366 and an obsidian label (white on that green fails contrast). It is 56 dp.
  - There is no backend submit.
- **Validation (`canSendFeedback`):** enabled when a category OR a non-blank note is set. The default Bug counts, so an empty note is allowed and the report can be just the screenshot + device line.
- **After a share:** the sheet closes and the app waits for the user to come back (AppState background → active, or 1.5 s if it never left). Then it shows the Snackbar "Thanks — feedback ready in WhatsApp" and resets the sheet (Bug, empty note, no screenshot).

### WhatsApp fallback chain (`shareFallbackChain` + `shareFeedback`)

1. `com.whatsapp`, with the jid, image + text.
2. `com.whatsapp.w4b`, with the jid, image + text.
3. Neither is installed:
   - **no screenshot:** `Linking.openURL("https://wa.me/919656921869?text=<encodeURIComponent(text)>")`
   - **with a screenshot:** the system share chooser (image + text), because wa.me cannot carry an image.

**Message:**

```
Tracker feedback — <Bug|Idea|Review>
<note>

— App v<x> (<n>) · Android <release> · <brand model> · Screen: <route name> · <ISO time>
```

- An empty note drops its line.
- The route name must match `^[A-Za-z][A-Za-z0-9]*$`, otherwise it becomes "Unknown".
- The brand is not repeated when the model already starts with it.
- The builder's input type has no field for transactions, amounts, merchants, SMS, the user's name or accounts, and this is tested.

## Part B — First-run tour

### Steps (`TOUR_STEPS`)

| # | Tab switched to | Target | Title / body |
|---|---|---|---|
| 1 | Home | `home.sync`: the Sync SMS button | **Sync SMS.** Reads your bank SMS on this phone and puts each payment it finds into Pending. Nothing is saved until you approve it. |
| 2 | Pending | `tab.Pending`: the Pending tab icon (+14 dp pad) | **Pending.** Detected items wait here. Approve, edit or reject each one before it counts. |
| 3 | Home | `home.periods`: the period chips block (Home scrolls to it) | **Pick a period.** Choose a period to see your income, spending and "Where it went" for that time. |
| 4 | Transactions | `transactions.search`: the search bar + filter chips | **Transactions.** Search by merchant or note, and filter by type, account or category. |
| 5 | Accounts | `accounts.balance`: the total balance card | **Accounts.** Balances per account, worked out from the items you approved. |
| 6 | (stay) | `feedback.button`: the button in its expanded spot | **Send feedback.** Found a bug or have an idea? Tap here twice. |

**Missing target:**

- If a target is missing, `stepOutcome` moves to the next step, and the next step's tab may mount its own target.
- If no step is left, the tour finishes.
- Example: while a sync is running, the Sync SMS button is replaced by progress, so step 1 is skipped.

**Overlay (`TourOverlay`):**

- The dim layer is one View with a huge border, so the target's **rounded** rectangle is the only undimmed area (`holeFrame`). It has a 2 dp mint ring.
- The overlay root is a responder for every touch, so taps outside the tooltip do nothing and the highlighted control is never activated.
- Targets are measured with `measureInWindow` (via `useTourTarget` / `TourTarget`) and converted to overlay-local coordinates (`toLocal`).
- Home registers a scroller. If a target is outside the visible band (safe top to above the tab bar), Home scrolls it to the band top and the overlay re-measures.
- **Tooltip card:**
  - Contents: title, body, "n / 6", [Skip], [Next] / [Done].
  - Size and placement: buttons ≥ 48 dp. It sits below the spotlight when it fits, else above, always clamped inside the safe area (`placeTooltip`).
  - Accessibility: `accessibilityLiveRegion`, plus `announceForAccessibility` of the title, body and "Step n of 6".

### Trigger rules (`tour_completed_at`; ISO = done, `''` = owed; plain setting, never audited)

| Situation | What happens |
|---|---|
| New install, during setup | Nothing (`hasOnboarded` false). |
| Setup completes (`saveOnboardingSyncStart`, both the Continue and the manual-skip path) | Key missing → set to `''` (owed). The tour is requested and starts 0.7 s after a main tab is on screen. |
| App closed before the owed tour ran | Next launch: onboarded + `''` → requested again. |
| **Existing install upgraded to R4c** (owner's phone) | Onboarded + key missing → key set to now **silently**. Never auto-shown. |
| Skip or Done (or no step left) | Key set to now. |
| Settings → "Replay tour" | Closes the sheet, scrolls Home to the top and requests the tour. It never re-owes. |

## Tests added (59)

| Suite | Tests | Covers |
|---|---|---|
| `widgetMachine.test.ts` | 14 | The reducer: tap / expand / capture / sheet, the screen-reader path, the idle timer, drag allowed and blocked, the 6 dp threshold, snap side + clamped Y, Y bounds, docked/expanded X, recapture / RESTORE. Also visibility (routes, keyboard, capture, sheet, tour) and the saved position round-trip. |
| `feedbackMessage.test.ts` | 11 | Exact format, the empty note, the 500 cap, no user-data fields, route sanitising, the device label / version badge, wa.me encoding, the jid constant, the counter, send validation, and both fallback chains. |
| `feedbackFlow.test.ts` | 5 | Capture runs while REDACTED and restores even after a failure. The share chain covers WhatsApp → Business → wa.me / chooser, with the jid. |
| `FeedbackSheet.test.tsx` | 4 | Header, badge, pills, counter, caption, the #25D366 ≥ 48 dp button; single-select and the 500 cap; Retake / Remove / Add; the disabled rule. |
| `redaction.test.tsx` | 6 | `formatRupeesFromMinor` masked vs `formatRupeesPlain`; the text and last-4 helpers; `accountDisplayLabel`; AmountText re-renders masked and back; TransactionRow masks merchant + amount; label helpers and the Activity `hideNames` option. |
| `tourModel.test.ts` | 7 | Step order and copy; skipping missing targets (a full walk with steps 3 and 5 missing shows 1, 2, 4, 6); counter and Next/Done; trigger rules for new, upgrade, owed and done. |
| `tourLayout.test.ts` | 7 | Spotlight padding and clipping, `toLocal`, the hole frame covering all screen corners with the inner radius kept, the tooltip below / above / clamped, and the scroll delta. |
| `tourStore.test.ts` | 5 | `initTourOnLaunch` (upgrade silent, owed requested), `requestTourAfterSetup`, Replay, and finish persisting with no audit (`setMany` never called). |

All test data is synthetic: "QA-Merchant-0N", "QA Bank 9999", "QaBrand / QA Phone 1".

## Decisions I made

1. **The button is also hidden on the form screens** (AddRecord, EditTransaction, AddAccount). This keeps it out of their bottom Save buttons and means unmasked form inputs can never be captured.
2. **Snackbar is hidden during capture** instead of masked.
3. **The empty note is allowed.** The default category counts as "set", as the prompt says.
4. **A drag from DOCKED starts at the expanded X**, so the button comes out under the finger instead of staying 65% off-screen.
5. **The screenshot is kept after Send** (until the next capture or app start) so WhatsApp can still read the granted uri. Remove and Retake delete it at once.
6. **No `<queries>` and no install check.** The direct `setPackage` + `startActivity` call and its `ActivityNotFoundException` drive the fallback, so nothing beyond the FileProvider entry was added to the manifest.
7. **Own `FeedbackFileProvider` subclass** (an empty class) instead of declaring androidx `FileProvider` directly, which avoids manifest-merge clashes.
8. **Step 2 switches to the Pending tab** and spotlights its tab icon (padded 14 dp).
9. **Step 3 spotlights the period chips**, and its body text mentions "Where it went". The two are separate blocks on Home.
10. **The "n / 6" counter uses the full step list**, so a skipped step leaves a gap, for example 1, 2, 4.
11. **The tour ends where step 5 or 6 leaves the user** (the Accounts tab). It does not navigate back to Home.
12. **The tour starts 0.7 s after a main tab is focused**, and each step waits 450 ms after a tab switch before measuring.
13. **Tour state is a separate store** (`useTourStore`) with its own `app_settings` key. `transactionsStore` was not touched.
14. **The upgrade marking runs after hydrate in App.tsx** (`initTourOnLaunch`). A failure there never blocks the app, and hydrate errors still surface as before.
15. **New tokens:**
    - `colors.whatsapp` (#25D366) with `onWhatsapp` = obsidian for the label.
    - `colors.scrim` for the tour dim.

## Not verified (needs the device pass)

- PixelCopy output and the redacted frame timing (2 frames + 120 ms).
- The big-border rounded hole rendering on Android.
- `measureInWindow` vs overlay origin under edge-to-edge.
- Spring feel.
- TalkBack `activate`.
- The jid extra opening the right chat.

## DEVICE PLAN (for later; not run)

Rules: only `com.tracker`, with a foreground check before every action and an abort if it fails. UI dumps are grep-filtered to `bounds`, `content-desc` and `resource-id` only. No screenshots. No db access. No owner settings changed.

The plan:

- **Never** opens, launches or inspects WhatsApp, WhatsApp Business, the share chooser or any other app. The owner tests the WhatsApp send by hand.
- **Never** pulls, lists contents of or opens the captured PNG. `run-as` / `adb pull` on `cache/feedback` is forbidden.

1. **Install and launch.** Install the debug/release build with `install -r`, so data is kept. Launch, then confirm that `dumpsys window | grep mCurrentFocus` shows com.tracker.
2. **No auto-tour on the owner's phone (upgrade path).**
   - After launch on Home, grep the dump for `resource-id="tour-overlay"`. Expect 0 hits.
3. **Docked button.**
   - `grep -o 'content-desc="Send feedback"[^>]*bounds="[^"]*"'`. Expect 1 hit.
   - The bounds should be at the right edge, with roughly 18 dp of the 52 dp visible (most of the bounds off-screen or clipped).
4. **Expand.**
   - Tap the visible part once and re-grep the bounds. Expect the button fully on-screen, 16 dp from the right edge.
   - Wait 4 s and re-grep. Expect it back to the docked bounds.
5. **Drag and snap.**
   - `adb shell input swipe <x> <y> <screenW*0.3> <y-300> 400` from the docked button.
   - Re-grep after 1 s. Expect left-edge docked bounds with Y about 300 px higher, clamped below the header and above the tab bar.
6. **Persistence.** Force-stop, relaunch and re-grep. Expect the same side and Y.
7. **Hidden states.**
   - On AddRecord, expect 0 hits for "Send feedback". Go back without saving.
   - With the Transactions search focused (keyboard open), expect 0 hits. Press back to close the keyboard.
8. **Open the sheet without sending.**
   - Expand, then tap the button again. Grep only for `text="Share Feedback"`, `text="Send on WhatsApp"` and the `text="✓ Screenshot` caption prefix (counts or bounds only).
   - **Do not** tap Send.
   - Close with ✕. Expect "Share Feedback" to be gone and the button docked again.
9. **Replay tour.**
   - Home → greeting → settings sheet → `text="Replay tour"` → tap.
   - Check `resource-id="tour-tooltip"` and `tour-counter` for "1 / 6". Then tap Next through the steps, checking each time:
     - the counter text
     - that the foreground stays com.tracker
     - the active tab, via the grep of the tab's selected state
   - On "6 / 6", "Send feedback" must be present and fully on-screen. Tap Done. Expect 0 `tour-overlay` hits.
   - Tap once outside the tooltip on one step and confirm nothing under it opened: the same screen, no navigation.
10. **Logcat.** `logcat -d --pid=$(pidof com.tracker)`, counted for FATAL / AndroidRuntime only.
11. **Cleanup.** Leave the button docked where the owner had it. There is no data to clean up, because the sheet was never sent and nothing is written but the two settings keys.

## Leak scan

The dispatch's pattern was run in the shell against this report: 0 hits. The new code files were also scanned (0 hits), and none of the new code contains a `console.*` or `Log.*` call.
