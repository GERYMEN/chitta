# Phase 17: Polish (F1 and F2) and the threshold note

Executor: Claude subagent. Nothing was committed to git.

## Code changes

### T1 (F1): wording of the remove-account dialog
- New pure helper `src/features/accounts/components/removeAccountMessage.ts` builds the message as `removeAccountMessage(name, transactionCount)`:
  - **0 transactions:** "Remove X? It has no transactions. New SMS from this account won't be imported. You can restore it later."
  - **1 transaction:** "… Its 1 transaction stays in your history but stops counting toward your balance. …"
  - **N transactions:** "… Its N transactions stay in your history but stop counting toward your balance. …"
- `src/features/accounts/screens/AccountsScreen.tsx`: `confirmRemove` now uses the helper. The old inline template is removed.

### T2 (F2): the sheet no longer jumps when the switch flips
- `src/features/profile/components/ProfileForm.tsx`: the text under the slider sits in a new `View` (`testID="threshold-copy-block"`).
- That view has `minHeight = 4 × bodyMd lineHeight (20) + spacing.xs (4) = 84dp`. This fits the longest variant: the 2-line ON helper plus the 2-line threshold note.
- Flipping the switch or dragging the slider therefore no longer changes the sheet height.

### T3: the threshold note
- When Auto-approve is ON and the threshold is above the parser maximum, the copy block also shows muted text (`colors.outline`, `testID="threshold-note"`):
  "SMS matches currently score up to 90%, so thresholds above 90% won't auto-approve anything yet."
- The 90 comes from a constant, not a literal:
  - `src/domain/settings/approval.rules.ts` adds `SMS_PARSER_MAX_CONFIDENCE = CONFIDENCE_HIGH`.
  - `src/features/sms-sync/smsParser.ts` now assigns `CONFIDENCE_HIGH` instead of the literal `90`, so the note's value is tied to what the parser actually emits. The value is unchanged, so parser behaviour is unchanged.
- The slider range is still 70–100. `clampThreshold`, the storage keys and `shouldAutoApprove` are unchanged.

### T4: tests
- New pure function `shouldShowThresholdNote(mode, threshold)` in `approval.rules.ts`. It returns true when `mode === 'auto' && clampThreshold(threshold) > SMS_PARSER_MAX_CONFIDENCE`.
- `src/features/accounts/components/__tests__/removeAccountMessage.test.ts` covers 0, 1 and many transactions.
- `src/domain/settings/__tests__/approval.rules.test.ts` covers `shouldShowThresholdNote` at:
  - auto with 90, 91, 100 and 70
  - manual with 95 and 100
  - clamping of 90.4, 150 and NaN
  - the link between the constant and `CONFIDENCE_HIGH`, and that the max is still 100
- `src/features/profile/components/__tests__/ProfileForm.test.tsx`:
  - the note renders for auto at 95, and not for auto at 90 or manual at 95
  - the copy block has minHeight 84

## Gates
| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx eslint src --ext .ts,.tsx` | 0 errors (3 warnings that were already there, outside the touched files) |
| `npx jest` | 26 suites / 263 tests pass |
| `./gradlew assembleDebug` | BUILD SUCCESSFUL |

## Device (USB, serial 00015365L001524)

Setup: `adb install -r` of the debug APK succeeded. Metro was already running, and I ran `adb reverse tcp:8081 tcp:8081`. Logcat was cleared at the start of the run.

| # | check | result |
|---|---|---|
| D1 | Accounts → "Remove account" on the synthetic "QA Delete Bank 9999" | **PASS**. The dialog read "Remove account?" / "Remove QA Delete Bank 9999 ••9999? It has no transactions. New SMS from this account won't be imported. You can restore it later." I tapped **Cancel**. The account is still active and was not removed. No other account was opened. |
| D2 | Settings sheet layout and the note | **PASS**. See the breakdown below this table. |
| D3 | Restore the owner's settings | **PASS**. I set the slider back to exactly 95 and switched it OFF, then closed with Back and did **not** tap Save. Reopening showed OFF / 95%. The name field was never touched. |
| D4 | Force-stop, relaunch and check logcat | **PASS**. After relaunch the settings sheet still showed OFF / 95%. Logcat over the whole run: 0 FATAL EXCEPTION, 0 "Maximum update depth", 0 ReactNativeJS errors. com.tracker was force-stopped at the end. |

D2 in detail:
- **Original settings:** switch **OFF**, threshold **95%**.
- **Positions in four states:** I measured four elements with the switch OFF at 95, ON at 95, ON at 89, ON at 90, ON at 91 and ON at 100. They were identical every time:

  | element | bounds |
  |---|---|
  | "Your name" label (sheet top proxy) | [72,1174][1188,1228] |
  | switch | [1048,1475][1188,1556] |
  | copy block | [72,2140][1188,2392] (252px = 84dp) |
  | Save | [72,2464][1188,2632] |

- **Threshold note:** visible at 91, 95 and 100 with the switch ON, at [72,2272][1188,2392], which is inside the reserved block. It was hidden at 89 and 90 with the switch ON, and hidden with the switch OFF at 95.
- **Size change:** the sheet is now 192px taller than in Phase 16's OFF state, because the room is reserved permanently. It no longer changes between states.

## Device safety
- **Foreground check:** `adb shell dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'` ran before every tap, swipe, key event and dump, and both lines had to contain com.tracker. It never failed during this run.
- **Dumps:** every dump was grep-filtered to the specific testIDs or labels needed, and `/sdcard/u.xml` was removed after each one. No full dump was ever printed, and no `/sdcard` path was used outside `adb shell`.
- **Data not printed:** no SMS bodies, senders, real merchants, real account names or real amounts. The only account opened was the synthetic "QA Delete Bank 9999", and it was not removed.
- **Forbidden actions:** none. No tracker.db, sqlite3 or run-as access, no uninstall, no clear-data, no screenshots and no Sync SMS. Save was never tapped and the name field was never edited.
- **Leak scan:** this report contains only synthetic QA names, UI copy, testIDs, bounds and counts.
