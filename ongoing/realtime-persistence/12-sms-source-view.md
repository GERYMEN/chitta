# Phase 12: Live original-SMS source view and confidence-scale fix

Executor: Claude subagent. Nothing was committed to git.

## Gates

| gate | result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx eslint src --ext .ts,.tsx` | 0 errors. The 3 warnings were already there before this phase. |
| `npx jest` | 16 suites and 195 tests pass. That is 5 more than before: 4 `parseSmsReference` tests and 1 test for migration 3. |
| `./gradlew assembleDebug` | BUILD SUCCESSFUL. Kotlin changed, so this was a real build. |

## Files changed (10)

New:
- `src/features/sms-sync/smsReference.ts`: the `parseSmsReference(hash)` function. It parses `sms-<digits>-<digits>` into `{ smsId, dateMs }` and returns null for anything else.
- `src/features/sms-sync/__tests__/smsReference.test.ts`: tests for a valid hash, null/undefined/empty input, garbage or wrong formats, and non-numeric parts.
- `src/features/transactions/components/OriginalSmsView.tsx`: the "View original SMS" UI.

Modified:
- `android/app/src/main/java/com/tracker/SmsReaderModule.kt`: adds `readById`.
- `src/native/android/sms/smsReader.ts`: adds `readSmsById`. This is still the only file that handles raw SMS data.
- `src/features/transactions/components/TransactionDetailContent.tsx`:
  - Shows the confidence as a rounded 0–100 value with a tier label from a `TIER_LABEL` map.
  - The "% match" chip is also rounded.
  - Mounts `OriginalSmsView` when the source is SMS and the reference parses.
- `src/features/sms-sync/smsParser.ts`: confidence scores changed from 0.9 / 0.6 / 0.4 to 90 / 60 / 40.
- `src/features/sms-sync/__tests__/smsParser.test.ts`: expected values updated to the 0–100 scale.
- `src/data/db/migrations.ts`: adds migration version 3.
- `src/data/db/__tests__/migrations.test.ts`: new test that runs migrations twice and checks the rescale is issued once and version 3 is recorded.

## Native method

`@ReactMethod fun readById(id: String, promise: Promise)`:
- It uses the same `READ_SMS` permission check as `readInbox`. Without permission it rejects with `E_SMS_PERMISSION_DENIED`.
- It queries `content://sms` (all boxes) with the projection `_id, address, body, date`.
- The selection is `"_id = ?"` with `arrayOf(id)`. The id is bound as a parameter and never concatenated into the query.
- The cursor is closed with `.use {}`.
- It resolves `{id, address, body, date}`, or `null` if no row matches.
- Any other exception rejects with `E_SMS_READ_FAILED` and a fixed message. Exception text is not passed through.

## UI states (OriginalSmsView)

The view only appears when `sourceType === 'sms'` and `parseSmsReference(sourceReferenceHash)` succeeds. It is placed below the sanitized-preview box in the Detection Transparency card. This card is shared by the Pending review sheet and the Transaction Detail screen.

| state | what the user sees |
|---|---|
| hidden | A green "View original SMS" text link, styled like the existing link. |
| loading | A small spinner and "Reading from your inbox…". |
| shown | A box using the same `sourceBox` tokens as the sanitized box. It contains the label "ORIGINAL SMS · read live from your inbox, not stored", then "From <address> · <formatTransactionTimestamp(date)>", then the full body. The link changes to "Hide original SMS". |
| permission denied | "Allow SMS access to view the original message", with an "Allow SMS access" link. The permission is requested only when the user taps that link, and never automatically. |
| not found, or the stored date does not match | "Original message no longer in inbox". SMS ids can be reused, so a message whose date differs is never shown. |
| native error | "Couldn't read the message". |

How the SMS text is kept private:
- The text exists only in this component's `useState`.
- Hiding the box or unmounting the component clears it.
- A request token stops a late response from filling the box again after the user hides it, leaves the screen, or the transaction changes.
- The text is never logged, sent to the console, put in the store, or written to the database.

## Migration 3 and other confidence displays

Migration 3 runs this statement:

```sql
UPDATE transactions SET confidence_score = confidence_score * 100
WHERE source_type = 'sms' AND confidence_score IS NOT NULL AND confidence_score <= 1
```

- The `schema_migrations` guard makes it run once.
- The `WHERE` clause makes it safe even if it ran again.

The other places that show confidence now work on the 0–100 scale:
- **Pending card chip:** uses `confidenceTier`, so it now says "High confidence" for a score of 90.
- **Home fast-approve list:** `canFastApprove` can now be true. Before this fix it was always false. This means SMS items with a score of 90 or more can now appear in the Home fast-approve list. That is the intended behaviour, but users will notice it.
- **Detail "% match" chip:** now shows `Math.round(score)`.

## Device results

I installed with `adb install -r`. Metro was already running on 8081 from this project, and `adb reverse` was set.

| # | check | result |
|---|---|---|
| 1 | Open the review sheet for an SMS-sourced pending item and read the Confidence value | PASS: "90% High Match" |
| 2 | Tap "View original SMS" | PASS. The "ORIGINAL SMS · read live…" label is present at `[193,2061][1067,2103]`. The sender/date line below it has 33 characters, and the body node below that has 145 characters at `[193,2169][1067,2409]`. No text was printed. |
| 3 | Tap Hide | PASS. The label is gone and the "View original SMS" link is back. |
| 4 | Open a manual record, "QA-Merchant-05" (₹55, Shopping, QA Test Bank 0002), created through Add Record, and expand its review sheet | PASS. It shows "Manual Entry" and "N/A". "original SMS" appears 0 times in the dump, while the Advanced Logs link is present. |
| 5 | Force-stop and relaunch | PASS. The process came up, with 0 "Migration failed" lines and 0 crashes. A different SMS item showed "90% High Match", not 9000. |
| 6 | Logcat | PASS for Tracker. There was 1 `FATAL EXCEPTION` in the whole buffer, from a third-party app process (a banking app's background service), not `com.tracker`: 0 of the FATAL lines mention `com.tracker`. There were 0 "Maximum update depth" lines. There was 1 ReactNativeJS line, the info-level "Running" bundle line. 0 ReactNativeJS lines matched debited/credited/Rs./INR/A/C/avl bal/body/OriginalSms/readById, and 0 lines across all tags matched debited/credited/avl bal. |

At the end, `com.tracker` was force-stopped and `pidof` returned nothing.

## Device safety notes (honest disclosure)

- **Another app was in the foreground during check 4.** While I was creating QA-Merchant-05, `dumpsys window mCurrentFocus` showed WhatsApp's status-playback activity was focused.
  - My foreground check at the time only grepped the first `topResumedActivity` line, which still reported Tracker, so it did not catch this.
  - I never tapped anything outside Tracker on purpose, so I do not know how WhatsApp came forward. It may have been the owner or a notification.
  - About 5 filtered dumps were taken in that window. Each printed only the `bounds` of allowlisted Tracker labels ("Approve", "QA-Merchant-05", static tab names). No other app's text was printed.
  - When I noticed, I pressed HOME and relaunched Tracker.
  - I then made the foreground check stricter: it now requires `mCurrentFocus` to be `com.tracker` and every `topResumedActivity` line to be `com.tracker`. I used that check before every later tap.
- **A swipe opened the original-SMS box once.** A swipe I meant as a scroll in the review sheet started on the full-width "View original SMS" link and acted as a tap. I only confirmed this from the "Hide original SMS" label. I hid the box, then did check 2 with a deliberate tap. After that, every scroll started at x=30, away from the controls.
- **Two QA-Merchant-05 records were created.** My first Add Record attempt saved after the Category error was fixed, which I only noticed later. Both are synthetic, pending, and not counted in the balance. They can be rejected later.
- **Other rules followed:**
  - Every dump was grep-filtered to one element, or reduced to counts or character lengths by a local script that never prints text.
  - `/sdcard/u.xml` was removed after every dump, and no `/sdcard` path was given to a file tool.
  - There was no tracker.db, sqlite3 or run-as access, no uninstall, no clear-data, and no screenshots.
- **Leak check on this report:** I scanned it. It contains only synthetic names (QA-Merchant-05, QA Test Bank 0002), static UI labels and numbers. The crashing third-party app is described generically on purpose, and nothing needed redacting.
