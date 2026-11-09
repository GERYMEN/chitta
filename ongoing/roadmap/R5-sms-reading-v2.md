# R5 — SMS reading v2, auto-read and "Messages not understood": report

- **Executor:** Claude subagent.
- **Dates:** 2026-11-03 to 2026-11-07. The run was resumed once after a network error.
- **Branch:** `phase/R5-sms-reading-v2`. Nothing was committed or staged.
- **Scope:** code, tests and gates only. There was no device work and no adb.
- **Owner additions:** A, B and C (2026-11-06) are included. They have their own sections below.

## Summary

**Gates: all pass.**

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx eslint src --ext .ts,.tsx` | 0 errors. 2 warnings, both already there (MainTabs, StatTile). Every new warning was fixed. |
| `npx jest` | 99 suites, 1442 tests, all pass. Baseline was 93 suites / 853 tests. |
| `./gradlew assembleDebug` | BUILD SUCCESSFUL |

**Files:** 63 source/test files, plus this report.
- 40 were modified and 23 are new.
- The orchestrator had already modified `ongoing/roadmap/STATE.md`. I did not touch it.

**Permissions and dependencies**
- New permission: `RECEIVE_SMS` only (user-approved).
- No new dependency.
- No `WAKE_LOCK`. See "Auto-read design" for why.
- The merged debug manifest also lists SYSTEM_ALERT_WINDOW and ACCESS_LOCAL_NETWORK. These come from the RN debug tooling, not from R5. The release manifest gains only RECEIVE_SMS.

**Fixtures:** 144 synthetic fixtures, all in `src/test/fixtures/smsReader.fixture.ts`.
- 135 are table fixtures and 9 are v1-regression fixtures.
- They cover 28 bank groups (27 named banks, with Fi and Jupiter as separate groups), 6 card issuers and 2 wallets.
- They also cover a generic path for unknown banks (9 fixtures), 18 negative fixtures and 2 refund fixtures.

## Files

### New

**Parser**
- `src/features/sms-sync/parser/senders.ts`: the sender stage. It parses DLT headers and holds the financial sender table.
- `src/features/sms-sync/parser/institutions.ts`: canonical ID → display name, plus the set of v1 canonical IDs.
- `src/features/sms-sync/parser/extract.ts`: pulls out amounts (with their role), verbs, the verb–amount binding, the payee, the reference and its digest, and the salary token.
- `src/features/sms-sync/parser/readSms.ts`: the entry point.
  - Pipeline, classes and confidence.
  - The footer cut (owner addition A).
  - `PARSER_VERSION = 2` and `bestGuessForSms`.
- `src/features/sms-sync/parser/maskSmsPattern.ts`: the allowlist masker and the share message.

**Auto-read**
- `src/features/sms-sync/autoRead/autoReadRules.ts`: pure rules. Setting, skip reasons and the coalescer.
- `src/features/sms-sync/autoRead/autoReadRunner.ts`: the run itself, the headless task and the foreground listener.

**Other source**
- `src/features/sms-sync/smsReaderStore.ts`: the auto-read setting and grant, the reader version, the not-understood rows, the hint rule and the rescan window.
- `src/features/sms-sync/screens/NotUnderstoodScreen.tsx`
- `src/features/home/components/ReaderUpgradeHint.tsx`
- `src/data/repositories/smsUnparsed.repository.ts`
- `src/native/android/sms/smsAutoRead.ts`

**Native**
- `android/app/src/main/java/com/tracker/SmsReceivedReceiver.kt`
- `android/app/src/main/java/com/tracker/SmsAutoReadService.kt`
- `android/app/src/main/java/com/tracker/SmsAutoReadModule.kt`
- `android/app/src/main/java/com/tracker/SmsAutoReadPrefs.kt`

**Tests**
- `src/features/sms-sync/parser/__tests__/readSms.fixtures.test.ts`
- `src/features/sms-sync/parser/__tests__/maskSmsPattern.test.ts`
- `src/features/sms-sync/autoRead/__tests__/autoReadRules.test.ts`
- `src/features/sms-sync/__tests__/syncSms.r5.test.ts`
- `src/features/sms-sync/__tests__/smsReaderStore.test.ts`
- `src/data/repositories/__tests__/smsUnparsed.repository.test.ts`
- `src/test/fixtures/smsReader.fixture.ts`

### Modified

**Native and entry**
- `AndroidManifest.xml`: RECEIVE_SMS, the receiver and the service.
- `SmsReaderPackage.kt`: registers `SmsAutoRead`.
- `index.js`: registers the headless task.

**App and navigation**
- `src/app/App.tsx`: loads the reader store and starts the foreground listener.
- `routes.ts`: adds `NotUnderstood` and `AddRecord.fromSms`.
- `RootNavigator.tsx`

**Data and domain**
- `migrations.ts`: migration 8.
- `backup.tables.ts`: `DEVICE_LOCAL_TABLES` and new device-local setting keys.
- `audit.types.ts` and `audit.rules.ts`: `sms_rescan`, `auto_read`, `added`, `account_linked`, `account_unlinked`, and the setting key `sms_auto_read`.
- `suggestion.repository.ts`: the link audit and `undoLink`.
- `transactionsStore.ts`: the `added` audit and `undoLinkSuggestion`.

**SMS sync**
- `smsParser.ts`: now a wrapper around v2.
- `normalizeAccountKey.ts`: v2 aliases, last-4 fallbacks, the masked-card kind and `accountKindV1`.
- `smsSyncLogic.ts`:
  - Version tag `sms-reader-v2` and `SMS_USER_ADDED_PARSER_VERSION`.
  - The salary category.
  - Legacy decision keys and legacy-kind account matching.
- `syncSms.ts`:
  - Uses the reader v2.
  - Records not-understood rows and resolves them.
  - In-run reference dedupe.
  - Run kinds and the run audit.
  - `requestPermission`.
- `syncRunner.ts`: run kinds. It refreshes the not-understood rows after each run.
- `syncToast.ts`
- `importSuggestion.ts`, `suggestionGroups.ts`, `suggestionSession.ts`, `SmsSuggestionsScreen.tsx`: owner addition C.

**UI**
- `HomeScreen.tsx`: the hint and the rescan.
- `ProfileSettingsSheet.tsx`: three rows.
- `PendingScreen.tsx`: the "N not understood" link.
- `PermissionsScreen.tsx`: requests both SMS permissions.
- `AddRecordScreen.tsx`: the prefill, and saving as approved (owner addition B).
- `activityFeed.ts`

**Test updates**
- `migrations.test.ts`, `backup.tables.test.ts`, `backup.repository.test.ts`, `smsParser.test.ts`, `syncSms.audit.test.ts`, `syncSms.transfer.test.ts`, `importSuggestion.test.ts`, `suggestionGroups.test.ts`, `transactionsStore.audit.test.ts`, `activityFeed.test.ts` and `fakeDb.ts`.
- The smsParser test was rewritten with QA-only names. The old file had real merchant names in it.

## Parser architecture (T1)

The pipeline is `readSmsMessage(msg) → SmsReadResult`, with these fields:
- `label`
- `institution` (public ID)
- `senderKind`
- `transaction` or `nonTransaction` or `notUnderstood`

`parseSmsMessage(msg)` keeps its v1 contract: it returns a transaction or null. Sync calls `readSmsMessage` because it also needs the classes and the reasons.

The pipeline has these stages:

1. **Normalize.** Collapse whitespace, then cut the fraud-help footer. The footer starts at text such as "If not you / not done by you / call <digits> / SMS BLOCK / to block". Nothing after it is ever read. This is owner addition A.
2. **Sender stage** (`parseSender`):
   - It reads DLT headers: `XX-ABCDEF`, `XX-ABCDEF-S/T/P/G` and bare 6-letter IDs.
   - `-P` (promotional) senders are dropped. So are plain phone numbers and short codes.
   - Known headers map to a canonical institution and a kind (bank, card, wallet or paylater). There are about 90 exact header IDs plus prefix fallbacks.
   - The header IDs are public codes written from general knowledge and are not verified against the registry.
   - Unknown headers are not dropped. They go through the classifier with a lower prior and must mention an account, card, UPI, bank or rail.
3. **Classifier** (targeted classes replace v1's blanket reject words, so "Avl Bal" no longer rejects anything). In order:
   1. OTP (a code next to OTP wording).
   2. Collect request.
   3. Refund or reversal (a refund word plus a real, non-future credit verb).
   4. Failed or declined.
   5. Bound verb inside a "will be debited / scheduled / upcoming" span → `mandate_future`.
   6. Bound past-tense transaction → txn, unless it is a promo with no account (loan_or_promo), or it comes from an unknown sender with no account mention.
   7. With no transaction: bill_due or statement, then mandate, then promo, then balance_info, then unknown_financial (with a reason), then not_financial.
4. **Direction.** It comes from the verb nearest the transaction amount, not from any word in the body.
   - "paid by X" is not a debit verb.
   - "transferred to your a/c" counts as a credit.
   - "Dr", "Cr" and "received" are weak verbs that lose ties.
5. **Extraction:**
   - **Amount:** the transaction amount is the txn-role amount closest to a verb.
     - The prefix is optional ("debited by 100.0"). Indian digit grouping works.
     - Amounts after Avl/Avail/Available Bal, AvlBal, Avlbl, limit, Lmt, due, min due or outstanding are given the balance, limit, due or min_due role.
   - **Last-4:** taken from the shared `normalizeAccountKey`.
     - Covers XX1234, X1234, *1234, "ending 1234", "A/c no. XXXXXX1234" and card endings.
     - A 5-digit masked card tail gives its last 4.
   - **Payee:** the sources are, in order:
     1. UPI slash tails.
     2. "trf to", "to VPA", "at", "to" and "; NAME credited".
     3. ICICI-style "on <date> on MERCHANT", as the last resort.
     4. For credits: NEFT/IMPS/RTGS tails, "by VPA", "from" and "paid by".
     5. "Info:" tails.
   - **Payee cleanup:**
     - Phone-number-like digit runs are removed.
     - A VPA whose local part is a phone number is never used.
     - A payee that names a bank is dropped.
   - **Reference:** UPI, IMPS or NEFT, held in memory only. The result carries only `refDigest`, an FNV-1a hash.
   - **Date:** the SMS date. No date is parsed from the body (decided as not robust enough).
6. **Confidence** is recomputed from signals:
   - Base 30.
   - Sender: known +15, unknown DLT +5, plus 5 more for -T/-S.
   - Verb: bound within 40 characters +20, loose +10.
   - Amount: with a currency prefix +10, without +5.
   - Last-4 +10, merchant +10, reference +5.
   - Caps: 90 for known senders (the same as `SMS_PARSER_MAX_CONFIDENCE`), 88 for unknown -T/-S, 85 for other unknown DLT headers, 80 for anything else.
   - Integer amounts are not penalised.

**Classes:** `txn_debit`, `txn_credit`, `card_spend`, `refund`, `failed`, `otp`, `mandate_future`, `collect_request`, `bill_due`, `statement`, `loan_or_promo`, `balance_info`, `unknown_financial`, `not_financial`.
- Only the first four produce transactions.
- bill_due and statement return a typed `nonTransaction` (total due, min due, last-4) for R5b. They are not inserted.

**Account key compatibility**
- **Normalizer version:** `ACCOUNT_KEY_NORMALIZER_VERSION` is now 2. v2 aliases come after every v1 alias.
  - Fixed: "Central Bank of India" (v1 read it as Bank of India).
  - Fixed: "South Indian Bank" (v1 read it as unknown).
- **Bank canonical:** a v1 bank name in the body still wins. Otherwise the known sender's institution is used, then a v2-only alias.
- **Legacy decisions:** "Add" and "Link" decisions saved under a v1 key still route the SMS. These are the bank → `unknown` variant and the v1 account kind.
- **Legacy matching:** an account matched under the v1 kind still matches.

## Institutions and fixture counts

Table-driven tests check, per fixture: class, type, amount, last-4, payee, salary, institution, account kind and bank name. Each bank group has at least one debit and one credit.

| Group | Fixtures |
|---|---|
| Banks | 3 each: ICICI, Axis, Kotak, Federal, PNB, Bank of Baroda, Canara, Union, Bank of India, Indian Bank, IOB, Central, IDFC First, Yes, IndusInd, South Indian Bank, CSB, Kerala Gramin, AU, RBL, Bandhan, DBS, Paytm Payments Bank, Airtel Payments Bank, Fi, Jupiter. SBI 4, HDFC 6. |
| Cards | SBI Card 3, ICICI card 3, HDFC card 2, Axis card 2, Amex 2, OneCard 2 |
| Wallets | Amazon Pay 2, Paytm wallet 2 |
| Generic (unknown bank) | 9 |
| Negative | 18: OTP, promo/loan, limit increase, mandate (future, registered, autopay scheduled), collect request, failed, declined, bill due, card due, balance info, unknown_financial (no_amount, no_direction), info-only |
| Refund / reversal | 2 |
| v1 regression | 9 |

Fi and Jupiter run on Federal Bank accounts, so they resolve to the `federal` institution.

**Owner multi-line HDFC shape:** the "Sent Rs.… / From … A/C *1234 / To … / On … / Ref …" debit and its "Received …" credit sibling are fixtures in two groups:
- HDFC: result is debit 15000.00, last-4 1234, payee QA PAYEE.
- Generic (unknown bank): the same shape.

**Property checks** run over all fixtures:
- No output field contains the body, the sender address, the header ID or the raw reference. 25-character body windows are checked too.
- The transaction amount never equals the balance or limit figure.
- No merchant contains 5 or more digits.
- Confidence is always in 30..90.

**v1 regressions covered:**
1. A credit with "Avail Bal" (also a salary) is read.
2. "debited by 100.0" with no prefix is read.
3. "credited … paid by" is a credit.
4. When the first amount is the balance, the transaction amount is still correct.
5. An unknown bank sender is still read.
6. A "click/offer" footer on a real debit is still read.
7. ICICI card: the payee never comes from the SMS-BLOCK footer, and the kind is never UPI.
8. The footer never supplies the last-4 (the BLOCK code differs from the account).
9. The footer never supplies a payee or an account when the main text has none.

## Salary rule

- A `txn_credit` is tagged salary when the body has SAL, SALARY, SALARIES or PAYROLL as a whole word.
  - The match ignores case, so "Sal" and "salary credit" count.
  - "-SALARY OCT" and "-SAL NOV" in NEFT tails count.
  - It does not count when followed by a/c, account or acct. "Salary A/c" is an account name, not a salary credit.
- Category: a merchant rule still wins. Otherwise the item goes to the seeded `cat-salary` ("Salary & Wages") if it exists, is not archived and fits income. Otherwise it goes to Uncategorised.
- Confidence: at least 90 when the sender is known and a last-4 was found.
- Detecting salary from recurring patterns is out of scope (R8).

## Re-scan rules (T2)

- **Entry points:**
  - Settings row "Re-read messages with the new reader".
  - A one-time Home hint, "Tracker reads bank SMS better now".
- **When the hint shows:** only on a phone where v1 recorded SMS items (rows tagged `sms-heuristic-v1`), and only while `sms_reader_version_seen` is below PARSER_VERSION. So new installs never see it.
  - "Not now" marks the version as seen.
  - A completed re-scan also marks it as seen.
- **Window:** the R4b window from the sync start to now (whole inbox when there is no start).
  - It uses the gap-scan path, so `sms_last_synced_at` never moves.
  - It shows the estimate dialog when the count is above 500. Cancel keeps whatever was inserted.
- **Dedupe:** by `sourceReferenceHash`. The hash format is unchanged: `sms-<id>-<date>`.
  - If the hash changed, every item v1 already recorded would come back as a duplicate. The UPI reference therefore never enters the stored hash.
  - The reference is used only, hashed, for an in-run guard: two SMS with the same reference digest, type and amount in one run make one item.
- **Existing items are never rewritten.** New items land in Pending as usual. "Approve all" and Undo work on them.
- **Audit:** `sms_rescan` (actor user), counts only: scanned, created, notUnderstood, autoApproved.

## Auto-read design (T3)

**Manifest**
- `RECEIVE_SMS`.
- `SmsReceivedReceiver`: exported, with `android:permission="android.permission.BROADCAST_SMS"` so only the system can send to it. It filters on `SMS_RECEIVED`.
- `SmsAutoReadService`: not exported, not a foreground service, no notification.

**Receiver**
- It never touches the intent extras: no PDUs, no body, no sender. It does not log.
- If the native flag is on, it calls `startService`. The flag is one boolean in SharedPreferences, mirrored from JS.

**Service**
- It waits 4 s for the inbox write, which lands after the broadcast. A further broadcast during the wait restarts it, so a burst becomes one run.
- If the app is in front (React context RESUMED), it emits `TrackerSmsReceived` with no payload. The JS coalescer waits 1.5 s, then runs `runSmsSync({kind:'auto'})` through the single-flight guard. If manual Sync holds the guard, it retries once after 5 s.
- Otherwise it starts the RN-core headless task `TrackerSmsAutoRead` with a 30 s timeout, using `HeadlessJsTaskContext` / `HeadlessJsTaskConfig`. It creates the React instance if the app was killed.

**Why the service is custom:** RN's `HeadlessJsTaskService` always takes a PARTIAL_WAKE_LOCK, which needs WAKE_LOCK. That permission is not approved. Without a wake lock the run is short and best-effort.

**JS run (`runAutoRead`)**
- It hydrates if needed, then checks the skip conditions:
  - onboarding not completed;
  - READ_SMS or RECEIVE_SMS missing;
  - turned off;
  - no active account;
  - the normal window estimate is above 500. A first whole-inbox scan is left to manual Sync with its dialog.
- It then runs the existing incremental sync unchanged: window, cursor, 1-day overlap, dedupe, pair holds and the auto-approve rule.
- There is no dialog and no permission prompt (`requestPermission:false`).
- Audit: `auto_read` (actor system), counts only, written only when the run added items or not-understood rows. Activity shows "Read automatically: N new".

**Setting `sms_auto_read`** (on/off; missing means ON once granted)
- New installs request READ_SMS and RECEIVE_SMS together at the permissions step. It is one system dialog, because both are in the SMS group.
- Existing installs get no automatic prompt. On the owner's phone the toggle shows OFF ("Turn on to allow reading new SMS") until the permission is granted from the toggle. If it was denied with "don't ask again", the toggle opens a dialog that links to system Settings.
- Toggle changes are audited as `settings_changed` with `on`/`off` only.
- The setting is device-local and is not backed up.

**Background behaviour relied on**
- Android 8+ puts an app that receives SMS_RECEIVED on the temporary allowlist, which permits `startService` from the receiver.
- Android 12+ limits only foreground-service starts, and none is used.
- If a device still refuses the start, the receiver catches the exception. Nothing is lost: the next auto or manual sync reads the same window.
- Doze may delay a run, for the same reason.

**No notification** (no POST_NOTIFICATIONS). New items show on Home and in Pending as usual.

## Migration 8 and "Messages not understood" (T4)

**Table**

```sql
CREATE TABLE IF NOT EXISTS sms_unparsed (
  sms_id TEXT NOT NULL,
  sms_date INTEGER NOT NULL,
  reason_code TEXT NOT NULL,
  institution TEXT NOT NULL,
  parser_version INTEGER NOT NULL,
  detected_at TEXT NOT NULL,
  dismissed_at TEXT,
  resolved_at TEXT,
  PRIMARY KEY (sms_id, sms_date)
)
```

Plus the index `ix_sms_unparsed_open (dismissed_at, resolved_at)`.

- **No body and no sender column.** A test asserts this.
- **What is recorded:** `unknown_financial` messages.
  - From a known sender: any amount or verb, with no transaction and no known class.
  - From an unknown sender: a strong verb plus an account mention plus an amount.
- **Reason codes:** `no_amount`, `no_direction`, `unknown_format`.
- **Re-recording:** INSERT OR IGNORE, so a dismissed row stays dismissed. A row is resolved when a later sync understands the message, or when the user adds it.
- **Device-local:** `DEVICE_LOCAL_TABLES = ['sms_unparsed']`.
  - It is excluded from the R4e backup, and restore leaves it untouched.
  - The completeness test now ignores device-local tables and separately asserts the table exists at version 8 and is not backed up.

**Screen** (reached from the Pending link "N not understood" or the Settings row)
- Each row shows the date, the bank label and the reason.
- Tapping a row reads that SMS live with `readSmsById` into component state. Only the exact message (same date) is shown.
- **"Add as transaction":** opens Add Record prefilled with the best-guess type and amount, the SMS date, and the one active account with that last-4.
  - The saved item keeps `sms-<id>-<date>`, so it is never flagged again and "View original SMS" works on it.
- **"Not a transaction":** dismisses the row.
- **"Share pattern":** shows the masked text first. It sends only on "Send on WhatsApp", which reuses the R4c text share path to the same owner-number constant.
  - The message starts "Tracker SMS pattern — <reason> · App v<x> · Parser v<n>", then "Sender: <header>", then the masked text.

**Masking rules (`maskSmsPattern`, allowlist)**
- URLs → `<URL>`, e-mails → `<EMAIL>`, VPAs → `<VPA>`.
- Dates → `<DATE>`, times → `<TIME>`.
- Rs/INR/₹ + number, or any decimal number → `<AMT>`.
- Masked account and card tails → `<ACCT>`.
- Digit runs of 9 or more → `<REF>`. Other digit runs → `<N>`.
- Any word outside the vocabulary, and any non-Latin run, → `<W>`. Runs of `<W>` collapse to one.
- **The output never contains a digit.** That is why digit counts such as `<N4>` are not kept.
- **Sender:** the DLT header ID only. Plain numbers become `<NUMBER>`, anything else `<SENDER>`.

**Vocabulary** (fixed, in code): money verbs, account/card/rail words (a/c, acct, UPI, IMPS, NEFT, RTGS, card, ending, VPA, ATM…), reference and balance words (Ref, RRN, UTR, txn, Avl, Bal, limit, due, min, total…), currency (Rs, INR, ₹), glue words (on, to, from, by, via, with, for, of…), public institution names, and month names. "store" and "merchant" were left out on purpose.

A property test checks every fixture: no digit, no word outside the vocabulary, and no VPA, URL, e-mail or QA name.

## Owner addition A — ICICI card format and the footer rule

- **Fixture** (sender `BP-ICICIT-S`, synthetic values). It is in both the ICICI-card group and the regression set.
  - Result: `card_spend`, 62500 paise (not the Avl Limit), merchant "QA MERCHANT" (from "on <date> on … ."), kind credit_card, last-4 1234, bank ICICI.
- **v1 merchant bug fixed:** the fraud-help footer is cut before anything is read. Two regression fixtures prove the footer never supplies a last-4, a payee or an account.
- **v1 "UPI" kind bug fixed:** "Card XX1234" with no "credit card" / "card ending" wording is now `credit_card`. A "Debit Card" keeps the v1 rules.
- **Keeping old routing:** the v1 kind is kept as `legacyAccountKind`. Decisions and accounts that matched under v1's kind still route.
- **General rule:** phone-like digits never become a merchant. Payees must start with a letter, and digit runs of 5 or more are removed.

## Owner addition B — Add Record needs no verification

- A record the user types is saved **approved** with `approvedAt = now`.
  - It counts in totals and balances at once.
  - It is audited `added` (actor user), with Activity text "Recorded · counts in your totals".
  - Add Record then opens Transactions, not Pending.
- "Add as transaction" from Messages not understood works the same way: approved and `added`.
  - It keeps the SMS reference, with parser tag `sms-user-added`.
- SMS-detected items still go to Pending.
- **No migration:** manual items already in Pending stay pending, and their old `created` audit rows and copy are unchanged. A user-entered row inserted as pending (pre-R5 shape) still audits `created`.
- Tests and the Add Record doc comment were updated. No other UI copy said manual items start pending.

## Owner addition C — "Link to existing account" in New Accounts Found

R2b already had a "Link to existing" action, but it listed only accounts of the same kind with no last-4. R5 changes this:

- **Picker:** lists every active account, compatible ones first. Compatible means the same kind, and a last-4 that is empty or the same.
- **Incompatible picks:** need confirmation. The dialog explains the mismatch (for example, card SMS onto a bank account) and offers "Link anyway".
- **One `db.transaction`:**
  - The 'linked' decision for the key (bank canonical + kind + last-4). Future SMS with that key go to the account; the legacy keys apply too.
  - The group's waiting items are inserted as pending on that account.
  - A new `account_linked` audit row: public bank ID, kind and item count only, with no last-4 and no SMS text. The row's account_id is the chosen account.
- The card leaves the session. Other groups are untouched.
- **Undo** (the snackbar action). The R2b decision model allows it, because a decision is one replaceable row per key. In one `db.transaction`, Undo:
  - removes the 'linked' row, only if it still points at that account;
  - deletes the link's rows that are **still pending**, each audited `deleted` with the usual snapshot;
  - writes `account_unlinked`;
  - puts the card back.
- **Undo limit:** rows the opt-in auto rule already approved are kept and not undone.
- **Tests:**
  - The mapping persists: the next sync's `partitionCandidates` routes the key to the account.
  - Pending items land on the account.
  - The suggestion disappears.
  - Another group is untouched.
  - Undo works.
  - The audit is QA-safe.
  - The compatibility rule.

## Activity / audit (T5)

- **New event types:**
  - `sms_rescan`: counts.
  - `auto_read`: counts.
  - `added`: transaction type.
  - `account_linked` / `account_unlinked`: bank ID, kind, count.
- **New audited setting:** `sms_auto_read`, with on/off values.
- All metadata is whitelisted in `sanitizeAuditMetadata`. There is no SMS text, sender, merchant or amount in audit, settings or logs.
  - The existing `deleted` snapshot keeps the merchant and amount, as decided in R1.
- **Device-local setting keys** (excluded from backups): `sms_auto_read`, `sms_reader_version_seen`.

## Decisions

1. **One reader call per message.** `parseSmsMessage` keeps its contract, but sync calls `readSmsMessage` so it also gets classes and reasons without parsing twice.
2. **Plain phone numbers and short codes are dropped,** not only "non-financial" ones. This guards against forwarded or scam SMS.
3. **Unknown senders need an account, card, rail or wallet mention** to produce a transaction. Two synthetic sync-test bodies gained "in your account" because of this.
4. **The confidence cap stays at 90** (= SMS_PARSER_MAX_CONFIDENCE). Unknown senders cap lower. For the same reason, the existing auto-approve sync tests now use threshold 70.
5. **The reference is never part of the stored hash** (the hash format is unchanged). It is used only hashed, as an in-run duplicate guard.
6. **No body-date parsing.** The SMS date is kept.
7. **Fi and Jupiter → `federal`; SBI Card → `sbi`.** This keeps v1 keys stable.
8. **Normalizer v2 adds legacy keys.** The bank → unknown variant and the v1 kind are kept, so v1 decisions still route.
9. **Masked output has no digit counts.** The output has no digits at all; `<ACCT>` and `<REF>` carry the shape.
10. **Custom auto-read service instead of `HeadlessJsTaskService`.** That class would need WAKE_LOCK, which is not approved.
11. **Auto-read skips windows above 500 SMS** (no dialogs in the background). It audits only runs that added something, to avoid an Activity row for every OTP.
12. **The receiver has a native flag that defaults to false.** After the update nothing is read automatically until the app has run and the user has granted RECEIVE_SMS.
13. **The re-scan hint shows only where v1 recorded SMS items.**
14. **"Add as transaction" saves the item approved** (owner addition B), with `sourceType 'sms'` + parser tag `sms-user-added` + the SMS reference, and audit `added`.
15. **Dismissed not-understood rows stay dismissed** when a later sync sees them again (INSERT OR IGNORE).
16. **Link Undo deletes only the link's still-pending rows** and removes the decision. Approved rows stay.
17. **A payee that names a bank is dropped.** "withdrawn at <bank> banking point" is not a payee.

## Leak scan

The pattern was run in the shell only.
- **This report:** 0 hits.
- **Repo diff and new files:** the only hits are in the expected files:
  - the parser's sender table (`parser/senders.ts`);
  - `normalizeAccountKey.ts` (aliases that already existed);
  - the synthetic fixtures and tests that use public bank header IDs as sender addresses;
  - the owner's synthetic multi-line and ICICI fixtures (`src/test/fixtures/smsReader.fixture.ts`). These contain the footer wording and a "Ref" line with the 000000000001 / 000000000002 references, as dictated.

## DEVICE PLAN (for later — not run)

**Safety rules**
- Only `com.tracker` is used, with the usual foreground check and abort.
- There is no db access, no screenshots and no logcat body output.
- Output is **counts only**. No real SMS is ever opened or printed.
- Never tap "Share pattern", "Send on WhatsApp" or "Add as transaction" on real rows.
- Never open a real not-understood row.
- Toggle auto-read only with the owner's explicit OK.
- **No synthetic test SMS may be sent to the phone.**

1. **Install.** Install the R5 debug-signed build over the existing app, keeping data (owner's phone: `assembleRelease -PtrackerDebugSigning` when the orchestrator asks for a release). Launch and confirm a clean start.
2. **Before counts.** Read only these counts:
   - the Pending "N not understood" link (expect absent or 0 before the first R5 sync);
   - the Settings row "Messages not understood: N".
3. **Hint.** Expect the Home hint "Tracker reads bank SMS better now" on the owner's phone, because v1 recorded items there.
4. **Re-scan.** Only if the owner OKs it, tap "Re-read messages". If the estimate dialog appears, report N and tap Scan only if the owner agrees.
   - Record only the toast counts: "Scanned N SMS · M new · K not understood".
   - Then record the not-understood count again (before/after).
   - Expect Activity to show "You re-read your messages with the new reader: M new · …".
   - Expect items already recorded to be unchanged: the Transactions count before equals the count after, minus the new pending items.
5. **Auto-read registration.** Do not test with a real or synthetic SMS. Check only:
   - `dumpsys package com.tracker`: the receiver `.SmsReceivedReceiver` is registered for `android.provider.Telephony.SMS_RECEIVED`, with permission `BROADCAST_SMS`.
   - RECEIVE_SMS is listed as requested. Report its granted state.
6. **Auto-read setting.** The Settings row "Read new SMS automatically" should show OFF ("Turn on…"), because the owner's phone has no RECEIVE_SMS grant after the update. Do not tap it unless the owner says so.
7. **Owner addition B.** On a synthetic QA account only, Add Record "QA-Merchant-30" ₹1.
   - Expect it in Transactions (not Pending), with the balance moved by ₹1 and Activity "You added … · Recorded".
   - Delete it afterwards.
   - Check that manual items already in Pending are still there (count unchanged).
8. **Owner addition C.** Only if a sync shows New Accounts Found **and** the owner agrees: open the picker to check that all accounts are listed, then close it without linking.
9. **Finish.** Run logcat FATAL/ANR for `com.tracker` since install (counts only), then force-stop.

## R5 review fixes

Code, tests and gates only (no device work, no adb, no commit). Every fix has a test with synthetic data (QA names, XX1234, refs 000000000123, qa.x@okqa). Each test was written first, then the fix.

**Gates:** `tsc --noEmit` clean · `eslint src` 0 errors (2 old warnings) · `jest` 104 suites, 1645 tests pass · `./gradlew assembleDebug` OK.

**This section replaces two earlier statements:**
- Decision 8 above ("bank → unknown variant").
- The `legacyAccountKind` note under owner addition A.

Legacy keys are no longer guessed (see C1).

### Confirmed findings

**C1 (high), v1 decision keys — fixed.**
- The new file `legacy/normalizeAccountKeyV1.ts` is a frozen copy of the v1 key code from commit d76ee0e. It reads the raw SMS body, with no whitespace folding and no footer cut, exactly as v1 did.
- The reader stores v1's exact key on each item as `legacyKey`. `partitionCandidates` then routes in this order:
  1. the v2 key;
  2. otherwise v1's exact key (link, ignore, or D10 delete);
  3. an account match on v1's kind + v1's last-4.
- The guessed `'unknown'` keys are removed (old `legacyDecisionKeysFor`).
- Tests (`smsSyncLogic.legacy.test.ts`):
  - a table of 10 v1 inputs gives the exact v1 keys;
  - Central Bank still routes on 'boi';
  - the Amex 5-digit tail still matches the v1 '' ignore;
  - a debit card that U3 re-kinded to 'bank' still follows its v1 `credit_card` link and matches its v1 account;
  - an `unknown:upi:` ignore no longer drops an SMS that names HDFC;
  - an `unknown:bank:` link no longer captures HDFC;
  - the v2 key still wins.

**C2 (high), auto-read hid "New accounts found" — fixed.**
- Every sync now saves a counts-only summary of undecided keys in `account_suggestion_candidates` (the existing table, already backed up). It holds the bank id, kind, last-4, a count and the first and last SMS date. There is no SMS content.
- New repository: `suggestionCandidates.repository.ts`. A completed scan that covered a key's range and did not see it again removes it. Add, Link and Ignore delete the row in the same transaction as the decision.
- Home shows a new entry, "N new accounts found · Review" (`NewAccountsEntry`). It opens the in-memory cards. If there are none (for example after a restart), it re-reads [earliest first-seen → now] as a gap scan, which does not move the cursor, and then opens the cards.
- Tests (`syncSms.reviewFixes.test.ts`, C2):
  - after auto runs move the cursor past an unmatched SMS and the app restarts, the gap scan rebuilds the card;
  - the summary holds no content;
  - a covering scan after a matching account is added removes the row.

**C3 (medium), a sync replaced an open review — fixed.**
- New `suggestionSession.merge`: every sync merges its groups into the current session and keeps the run id. Groups the user has not acted on are never dropped. Items already recorded or tombstoned are pruned.
- The sync result's `suggestions` is now the merged session.
- Tests: C3 in `syncSms.reviewFixes.test.ts`, plus `syncSms.session.test.ts`, which now expects the run id to stay the same.

**C4 (medium), deleted SMS items came back — fixed.**
- New table `sms_deleted_refs (source_reference_hash PK, deleted_at)`, added to migration 8. Migration 8 was never released; the migration test now covers it.
- `transactionRepository.delete` writes the tombstone in the same transaction as the DELETE, for SMS rows only. Only the hash is stored.
- Sync and the "New accounts found" imports skip tombstoned hashes. Link Undo writes no tombstone, so the restored card can be imported again.
- The table is included in backups (`backup.tables.ts` sinceVersion 8, plus a backup fixture row). The backup test "N-1 → N" now runs against version 7 again, and a separate v6 test is kept.
- Tests: C4 in `syncSms.reviewFixes.test.ts` and `importSuggestion.test.ts`; the migrations and backup tests.

**C5 (medium), future and pre-debit notices booked as expenses — fixed.**
- FUTURE_RE now also covers: 'to be debited', 'due to be debited', 'pre-debit', 'will be presented' and 'is due on/by'.
- A future marker inside the sentence that holds the bound verb and amount makes the message `mandate_future`.
- Tests: all 9 review bodies are negative tests in `readSms.reviewFixes.test.ts`, plus a check that a completed debit followed by a separate due-date sentence is still a debit.

**C6 (medium), "reversal of credit" flipped a debit into income — fixed.** A message is labelled `refund` only when the bound verb is a credit, or when it says "refund of Rs X … credited". Both review bodies are now expenses.

**C7 (medium), salary imported from cards went to Uncategorised — fixed.** `preparePendingRows` now passes `parsed.salary`. Tests: C7 in `importSuggestion.test.ts`.

**C8 (low/medium), dismissed rows counted again — fixed.**
- `recordMany` now returns the number of rows actually inserted, and sync counts only those.
- A dismissed or resolved row seen again counts 0. No `auto_read` audit row is written when nothing was added.
- Tests: C8 in `syncSms.reviewFixes.test.ts`.

**C9 (low), confidence vs the default auto-approve threshold of 90 — fixed.** Only a clean parse reaches 90. Everything else is capped at 85 (`UNCERTAIN_CAP`).

| Signals | Max score |
|---|---|
| Known sender + verb within 40 chars of a prefixed amount + last-4 + payee | 90 |
| Salary credit from a known sender with last-4 | 90 |
| Known sender missing payee, last-4, prefix or proximity | 85 |
| Unknown DLT sender (-T / -S) | 85 (88 before the cap) |
| `other` (incl. 5–6 digit short codes) | 80 |

- `syncSms.audit.test` and `syncSms.transfer.test` are back at `DEFAULT_AUTO_APPROVE_THRESHOLD` (90), using a known sender with last-4 and a payee.
- A new test checks that the same bodies from an unknown sender stay pending at 90.
- Table test: C9 in `readSms.reviewFixes.test.ts`.

**C10 (low), auto-read overlapping a hydrate or a restore — fixed.**
- `hydrate` is single-flight: concurrent calls share one in-flight reload.
- App launch skips hydrate when the store is already hydrated.
- New `useSyncRunStore.restoring`: `restoreBackup` holds it for the replace + reload; `runSmsSync` refuses to start while it is set; `runAutoRead` returns busy before and after its hydrate.
- Tests: `autoReadRunner.test.ts` (restore guard, one shared hydrate) and `backupFlow.test.ts` (guard held during the restore, a second restore is refused).

**C11 (low), Link Undo was not exact — fixed.**
- Undo now deletes every row the link inserted that still exists: pending rows and rows auto-approved during the link. Each is audited 'deleted' with its status.
- The card comes back with all its items, into the current session even when the run is stale.
- The stored summary row is re-created, so Home can reopen the card after the user left the screen.
- The snackbar now says "Link undone · N items removed".
- Tests: C11 in `importSuggestion.test.ts`.

**C12 (low), names leaking through the share masker — fixed.**
- Removed from the vocabulary: institution and brand names, month names, single letters and pvt/ltd. The institution survives only as the DLT header on the Sender line.
- Month names become `<DATE>`.
- New payee-span rule: after to / at / by / from / towards / trf, every word (vocabulary words included) becomes `<W>` until a rail, account, reference or glue word, or a sentence break. Own-account phrases ("to your A/c", "to VPA") keep their shape.
- Tests (`maskSmsPattern.test.ts`, C12): every review example; a vocabulary check; a property over every fixture payee.

### Unverified findings

- **U1 — fixed (reproduced).** With a strong bound verb, OTP, collect, failed and promo wording counts only inside the transaction's own sentence. Footers such as "Never share your OTP", "Beware of payment request frauds", "If txn failed…" and wallet offer lines no longer drop a completed transaction. Real OTP, collect, failed and promo messages are still dropped.
- **U2 — fixed (reproduced).** A bound debit whose sentence names charges, a fee, a penalty or a bounce is a debit even with failure words.
- **U3 — fixed (reproduced).**
  - A debit card is now 'bank', even with "card ending 1234".
  - "Txn Rs.X On HDFC Bank Card NNNN At …" is read: a new weak `txn` verb before an amount, and "Bank Card 1234" is a credit card.
  - v1 routing is kept through C1.
- **U4 — fixed (reproduced).** "Available credit" is no longer a credit verb, and the word 'credit' after an available-type keyword is ignored. A number followed by points, coins, miles or similar units is not an amount.
- **U5 — fixed (reproduced).** Salary detection ignores VPAs and e-mail addresses.
- **U6 — fixed (reproduced).** "ATM card" or "ATM cum Debit Card" on a purchase is not a cash withdrawal. A withdrawal verb, or an ATM machine mention without purchase wording, still is.
- **U7 — fixed (reproduced).** Payee fallbacks that start with a verb, date or reference word (be, is, date, refno…), or with a month followed by digits, give no payee.
- **U8 — fixed (behaviour change).** Plain personal numbers (10+ digits) and 3–4 or 7–8 digit numbers are still dropped before classification. 5–6 digit short codes now go to the classifier as `other`, with a 0 prior, a cap of 80, and a required account mention.
- **U9 — fixed (reproduced).** `transferInputFor` and `addTransfer` keep the SMS reference (`sourceType 'sms'`, parser version `sms-user-added`), and the row is resolved. The next sync no longer lists the SMS as not understood.
- **U10 — fixed (reproduced).**
  - The denied state now explains why, and offers "Allow SMS access", which retries after the grant. When blocked, it offers "Open Settings". "Not a transaction" is also offered.
  - The row accessibility label now includes the date.
  - New screen tests (`screens/__tests__/NotUnderstoodScreen.test.tsx`) cover the reused-id guard, the live read, the label and the grant flows.
- **U11 — fixed.**
  - New `autoRead/__tests__/autoReadRunner.test.ts`: kind 'auto' with no prompt and no dialogs, the skip reasons, busy and failed, and `setAutoRead` on, denied, blocked and off.
  - The fixture table asserts `accountKind` and `bankName` on every one of the 122 transaction fixtures (`ACCOUNT_EXPECT`, with a coverage test).
  - Building that table found two more wrong kinds, both fixed and covered by the table:
    - "Acct XX1234" and "A/cX1234" are now 'bank';
    - a card issuer's own sender never gives 'upi'.

### Other behaviour changes
- An item added from "Messages not understood" as a Transfer is now `sourceType 'sms'`.
- Deleting an SMS-sourced item is permanent across re-scans and restores (tombstone).
- Any manual Sync opens "New accounts found" when the merged session has cards, including cards from earlier auto runs.
