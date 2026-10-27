# Phase 13: Profile setup, approval-mode slider, opt-in auto-approve

Executor: Claude subagent. Nothing was committed to git. No new npm dependencies.

## Gates

| gate | result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx eslint src --ext .ts,.tsx` | 0 errors. The same 3 warnings as before, none in new files. |
| `npx jest` | 21 suites, 226 tests pass (was 16 / 195). 5 new suites, 31 new tests. |
| `./gradlew assembleDebug` | BUILD SUCCESSFUL. Only JS changed this phase, so it was an up-to-date build. |

## Files changed (23)

New (15):
- `src/shared/ui/Slider/sliderMath.ts`: pure functions `clamp`, `roundToStep`, `positionToValue`, `valueToFraction`, `nudge`.
- `src/shared/ui/Slider/Slider.tsx`: `Slider` and `TwoPositionSlider`.
- `src/shared/ui/Slider/index.ts`
- `src/shared/ui/Slider/__tests__/sliderMath.test.ts`
- `src/domain/settings/approval.rules.ts`:
  - the `ApprovalMode` type
  - constants and `SETTINGS_KEYS`
  - `clampThreshold`, `parseApprovalMode`, `parseThreshold`, `shouldAutoApprove`
- `src/domain/settings/__tests__/approval.rules.test.ts`
- `src/features/profile/components/profileForm.schema.ts`: zod schema. The name is trimmed and 1–30 chars, the mode is the enum, and the threshold is an integer from 70 to 100.
- `src/features/profile/components/__tests__/profileForm.schema.test.ts`
- `src/features/profile/components/ProfileForm.tsx`: the shared form (name, mode slider, threshold slider with explanatory copy, submit).
- `src/features/profile/components/ProfileSettingsSheet.tsx`: the Home settings BottomSheet.
- `src/features/profile/utils/greeting.ts`: `timeOfDay` and `greetingFor` (falls back to "Welcome").
- `src/features/profile/utils/__tests__/greeting.test.ts`
- `src/features/sms-sync/syncToast.ts`: `formatSyncToast`.
- `src/features/sms-sync/__tests__/syncToast.test.ts`
- `src/features/onboarding/screens/ProfileSetupScreen.tsx`

Modified (8):
- `src/shared/ui/index.ts`: exports Slider.
- `src/features/transactions/state/transactionsStore.ts`:
  - Adds `userName`, `approvalMode` and `autoApproveThreshold` state, hydrated in `hydrate()`.
  - Adds `updateProfile(patch)`.
  - `addTransaction` now returns the created `Transaction`. Existing callers ignore the return value.
- `src/features/sms-sync/syncSms.ts`: the auto-approve step, plus `autoApproved` in the result.
- `src/features/home/screens/HomeScreen.tsx`: dynamic greeting, avatar and pencil affordance, the sheet, and the new toast.
- `src/app/navigation/routes.ts`: adds `ProfileSetup`.
- `src/app/navigation/RootNavigator.tsx`: registers `ProfileSetup`.
- `src/features/onboarding/screens/OnboardingScreen.tsx`: finishing or skipping the tour now goes to `ProfileSetup` instead of Permissions.
- `src/features/onboarding/screens/PermissionsScreen.tsx`:
  - The step label is now "STEP 8 OF 8".
  - The "You Always Have The Final Say" copy now ends with "— unless you opt in to auto-approve".

## Settings keys (app_settings)

| key | values | default | read/write rule |
|---|---|---|---|
| `user_name` | string | `''` | Trimmed on write and on read. |
| `approval_mode` | `'manual'` or `'auto'` | `'manual'` | Any value other than exactly `'auto'` reads as manual. |
| `auto_approve_threshold` | integer string | `90` | Clamped to [70, 100] on read and on write, and rounded. A missing or non-numeric value becomes 90. 70 is `CONFIDENCE_NEEDS_REVIEW`, so the threshold can never go below it. |

`updateProfile(patch)` writes only the keys present in the patch through `settingsRepository.setValue`, then updates the store.

## Slider design

- **Built only from core PanResponder and Animated.** There is no gesture-handler or reanimated dependency.
- **Touch area:** the container is 48dp tall, with a 24dp horizontal inset on each side so the thumb can reach both ends. The thumb's touch target is 48×48 and the visible thumb is 26dp. Colours come from theme tokens: the track is `surfaceContainerHigh`, the fill is `primary`, and the thumb is `surfaceContainerLowest` with a `primary` border.
- **Tap or drag:** all children have `pointerEvents="none"`, so `locationX` at grant is relative to the track container.
  - A tap jumps to that position.
  - A drag uses the grant position plus `dx`.
  - Every move is stepped and clamped through `positionToValue`, and `onChange` fires only when the stepped value changes.
  - On release the thumb animates to the stepped position.
- **Works inside the BottomSheet:** `onPanResponderTerminationRequest` returns false, so the sheet's ScrollView cannot take over the gesture.
- **Accessibility:**
  - `accessibilityRole="adjustable"` with an `accessibilityValue` of min, max, now and text (for example "95 percent", or "Auto").
  - Increment and decrement actions step by `step` through `nudge`.
- **`TwoPositionSlider`:** the same Slider with min 0, max 1 and step 1. The "Manual" and "Auto" labels are shown on either side, and each label is also a 48dp tappable button.

## Auto-approve rules

- `shouldAutoApprove(mode, threshold, score)` is a pure function:
  - Manual mode returns false.
  - A null or non-finite score returns false.
  - Otherwise it returns `score >= clampThreshold(threshold)`.
- **`syncSms` reads the mode and threshold once, at the start of the sync.** For each transaction this sync creates, if `shouldAutoApprove` returns true, it calls `store.approve(id)`. That is the same path as a manual approve, guarded by `canTransition`. Transactions are never inserted as `'approved'` directly. A transaction counts toward `autoApproved` only if its status is `approved` after the call.
- **Scope:**
  - Only transactions created in that sync are considered.
  - Existing pending items are **not** approved retroactively when the mode changes. The settings sheet subtitle says "Changes apply to future syncs only."
  - Manual entries never go through this path.
- **No audit record:** `src/domain/audit/audit.types.ts` defines only types. There is no audit repository or writer, so no audit event is recorded for auto-approvals. As instructed, I did not build one.
- **Toast:** "Synced: scanned N, found M new, A auto-approved". The last part is left out when A is 0.
- **Finding: the parser never reaches a 95 threshold.** The v1 SMS parser only produces the scores 90, 60 and 40. Any threshold above 90 (for example 95, the value used on device) can never auto-approve anything with the current parser. Auto mode only has an effect at thresholds of 90 or lower. You may want to state this in the UI copy, or default to 90 (which is already the default).

## ProfileSetup (onboarding)

- **Flow:** Tour (finished or "Skip Tour") → ProfileSetup → Permissions (`navigation.replace`) → Tabs.
- **Layout:** SafeAreaView with top and bottom edges, a KeyboardAvoidingView and a ScrollView. It uses the onboarding header style ("Tracker" brand, a "STEP 7 OF 8 · PROFILE" label in `labelMd`/`primary`, then a headline and subtext).
- **Validation:** the name is required, so Continue shows "Please enter your name" until it is filled in. Continue saves through `updateProfile` and then navigates.
- **Not reached on device.** Uninstalling the app is not approved, and this install had already completed onboarding. The screen is verified only by `tsc`, the schema unit tests, and the fact that it shares `ProfileForm`, which was exercised on device through the Home sheet.

## Device results

I installed with `adb install -r`. Metro was already running from this project.
- **`adb reverse` had been dropped.** The first launch showed a RN "Unable to load script" redbox. I restored the reverse and relaunched, and it loaded normally.
- **Foreground check:** `dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'` had to show `com.tracker` on both lines before every tap and dump.
  - It failed once early on, with 0 of 2 lines showing Tracker.
  - I pressed HOME and relaunched Tracker. Nothing about the other window was inspected.

| # | check | result |
|---|---|---|
| 1 | Home greeting | PASS, with a caveat. Before I changed anything the greeting read "Good morning, Siraj" (the device clock was 01:xx). So `user_name` was **already stored** as "Siraj", and the settings were already **Auto / 85**. Something set these before this run, probably the owner or an earlier attempt; I did not set them. Because of this, the "Welcome" fallback was not visible on device. It is covered by unit tests. |
| 2 | Tap greeting → sheet; name "QA User"; Manual ⇄ Auto; threshold drag to 95; Save; force-stop and relaunch | PASS. The sheet opened. A real `input swipe` on the mode thumb switched Auto→Manual and back, and the threshold block hid and reappeared each time. A real `input swipe` dragged the threshold thumb from 85 to 95 (a11y value "95 percent", "95%" label). After Save the greeting read "Good morning, QA User". After force-stop and relaunch the greeting was still "Good morning, QA User", and the sheet showed Auto and 95 percent. |
| 3 | Sync SMS at Auto/95 | PASS for behaviour, with nothing auto-approved. The toast read "Synced: scanned 200, found 5 new", with no auto-approved part, so autoApproved was 0. Pending went from 33 to 38 waiting, up by exactly 5 new with 0 approved. This matches the parser finding above: the parser's maximum score is 90, which is below 95. |
| 4 | Switch to Manual, Save, sync again | PASS. The toast read "Synced: scanned 200, found 0 new", so autoApproved was 0, and pending stayed at 38. After a relaunch the sheet showed Manual. |
| 5 | Final state | The device is left in **MANUAL** mode. The stored threshold is still 95 and is hidden while Manual is selected. The name is left as **"QA User"**, so the owner should rename it from the Home greeting. The previously stored name was "Siraj". |
| 6 | logcat (cleared at the working launch) | 0 FATAL EXCEPTION, 0 AndroidRuntime lines for com.tracker, 0 "Maximum update depth", 0 ReactNativeJS errors. |

How the toast was read:
- I ran `adb shell "timeout 20 uiautomator events | grep -o 'Synced: …'"`, so the event stream was filtered on the device.
- Only the toast's own count text reached the host.
- The temporary files holding that text were deleted.

`com.tracker` was force-stopped at the end, and `pidof` returned nothing.

### Not verified on device
- **ProfileSetup screen:** needs a fresh install, and uninstalling is not approved.
- **The "Welcome" fallback:** a name was already stored.
- **A non-zero auto-approve count:**
  - At 95 the parser can never qualify a transaction.
  - At 90 only newly arriving SMS would qualify, because the 5 new messages were already created as pending and are not approved retroactively.
  - Forcing a non-zero count would have meant approving the owner's real transactions into the ledger, which cannot be undone. I did not do that.
  - The positive path is covered by the `shouldAutoApprove` unit tests and a code review showing it uses `store.approve`.

## Usability note
When the mode switches, the threshold block appears or disappears. This changes the sheet's height, and because the sheet is anchored to the bottom, the controls move by about 324px. It works, but the controls jump. A future polish could keep the sheet height fixed.

## Device safety
- **Dumps:**
  - Every uiautomator dump was filtered on the host to the bounds or content-desc of one element I wrote myself (greeting, sliders, Save, "N waiting").
  - The redbox check printed only that one node.
  - `/sdcard/u.xml` was removed after every dump.
- **No other app data was printed:** no SMS bodies, senders, merchants or amounts.
- **Nothing forbidden was used:** no tracker.db, sqlite3 or run-as access, no uninstall, no clear-data, no screenshots.
- **Leak scan of this report:** it contains only counts, UI labels, synthetic "QA User", and the owner's first name. That name was already hard-coded in the old greeting source and was the stored name found on device.
