# R5d — stable SMS identity, persisted reference dedupe, account aliases

Branch `phase/R5d-identity-aliases` (from R5 234e9de + fb1ee77). Not committed.
CODE + TESTS + GATES only — no device work, no adb, no assembleRelease.
No new dependency, no new Android permission (one new method on the existing
`TrackerBackup` native module).

## Status per task

| Task | Status |
|---|---|
| T0a reversal of a debit → refund | done (C6 tests unchanged and green) |
| T0b receiving account on credits (wallet + "from … a/c") | done |
| T0c long masks → last 4 of the digit run | done |
| T0d 3-digit masks → `lastDigits` | done |
| T0e card bill paid from a bank a/c → bank + `card_payment` hold | done |
| T1 stable SMS identity (content hash + salt + lazy backfill) | done |
| T2 persisted reference dedupe (SHA-256 ref digest) | done |
| T3a suffix match (unique, same bank) | done |
| T3b debit-card link suggestion (O2) | done |
| T3c "Linked card / account numbers" + Unlink | done |
| T3d duplicate-pair proof (before / after link) | done (tests only, no rule change) |

None of the T0 items was already fixed by R5-fix: all 8 affected review
bodies failed before this phase (table below).

## Files

New (12):
- `src/shared/crypto/sha256.ts` — pure-TS SHA-256 (FIPS 180-4) + UTF-8 encoder.
- `src/features/sms-sync/smsIdentity.ts` — `smsContentHash`, `refDigestFor`, `refTombstoneKey` (pure).
- `src/features/sms-sync/smsIdentitySalt.ts` — per-install salt load / create.
- `src/features/accounts/state/linkedNumbersStore.ts` — T3c list + Unlink.
- Tests: `shared/crypto/__tests__/sha256.test.ts`, `sms-sync/__tests__/smsIdentity.test.ts`,
  `smsIdentitySalt.test.ts`, `syncSms.r5d.test.ts`, `linkSuggestions.r5d.test.ts`,
  `parser/__tests__/readSms.r5d.test.ts`, `screens/__tests__/SmsSuggestionsScreen.r5d.test.tsx`,
  `accounts/state/__tests__/linkedNumbersStore.test.ts`.

Changed (36): `android/.../BackupModule.kt` (randomBytes), `backupNative.ts` (+test),
`migrations.ts` (+test), `backup.tables.ts`, `transaction.types.ts`, `transaction.mapper.ts` (+test),
`transaction.repository.ts`, `smsDeletedRefs.repository.ts`, `account.repository.ts`,
`duplicate.rules.ts` (+test), `refund.rules.ts` (+test), `readSms.ts`, `extract.ts` (FNV removed),
`normalizeAccountKey.ts`, `smsSyncLogic.ts`, `syncSms.ts`, `importSuggestion.ts`,
`suggestionGroups.ts`, `SmsSuggestionsScreen.tsx`, `AccountsScreen.tsx`, `ReviewSections.tsx`,
`transactionsStore.ts`, test helpers `fakeDb.ts`, `backupRows.fixture.ts`, `smsReader.fixture.ts`,
existing tests adjusted (`syncSms.reviewFixes/session/transfer`, `transactionsStore.transfers`,
`backup.repository`), `ROADMAP.md` (R6 migration 9 → 10). Plus this report.

## T0 — the review set (30 synthetic bodies)

The orchestrator's 30 review bodies are not in the repo, so I wrote 30 new
synthetic ones in the same shapes (QA names, XX1234 / XX9999 / XXXXX123456 /
XX888 masks, references 000000000xxx), including the three shapes the review
found wrong. They live in `R5D_REVIEW_FIXTURES` (smsReader.fixture.ts) with
class / type / amount / last-4 / kind expectations. Before R5d: 22/30. After: 30/30.

| # | Fixture | Class | Type | Amount | Last-4 | Kind | Extra | Before | After |
|---|---|---|---|---|---|---|---|---|---|
| 1 | hdfc UPI sent (multi-field) | txn_debit | expense | 250.00 | 1234 | bank | – | pass | pass |
| 2 | hdfc UPI credit from VPA | txn_credit | income | 1500.00 | 1234 | bank | – | pass | pass |
| 3 | hdfc credit card spend | card_spend | expense | 799.00 | 9999 | credit_card | – | pass | pass |
| 4 | hdfc debit card spend | card_spend | expense | 300.00 | 5678 | bank | – | pass | pass |
| 5 | sbi UPI debit unprefixed | txn_debit | expense | 75.00 | 1234 | bank | – | pass | pass |
| 6 | sbi long-mask credit (T0c) | txn_credit | income | 2000.00 | 3456 | bank | – | FAIL | pass |
| 7 | sbi long-mask debit (T0c) | txn_debit | expense | 500.00 | 3456 | bank | – | FAIL | pass |
| 8 | icici 3-digit mask debit (T0d) | txn_debit | expense | 1250.00 | null | bank | digits 888 | FAIL | pass |
| 9 | icici 3-digit mask credit (T0d) | txn_credit | income | 5000.00 | null | bank | digits 888 | FAIL | pass |
| 10 | icici credit card spend | card_spend | expense | 2499.00 | 9999 | credit_card | – | pass | pass |
| 11 | axis UPI debit info tail | txn_debit | expense | 600.00 | 1234 | bank | – | pass | pass |
| 12 | axis UPI credit by VPA | txn_credit | income | 1000.00 | 1234 | bank | – | pass | pass |
| 13 | kotak UPI sent | txn_debit | expense | 450.00 | 1234 | bank | – | pass | pass |
| 14 | kotak UPI received | txn_credit | income | 900.00 | 1234 | bank | – | pass | pass |
| 15 | federal UPI debit to VPA | txn_debit | expense | 350.00 | 1234 | bank | – | pass | pass |
| 16 | federal UPI credit | txn_credit | income | 4000.00 | 1234 | bank | – | pass | pass |
| 17 | pnb UPI debit | txn_debit | expense | 220.00 | 1234 | bank | – | pass | pass |
| 18 | bob UPI credit | txn_credit | income | 1200.00 | 1234 | bank | – | pass | pass |
| 19 | canara UPI debit | txn_debit | expense | 150.00 | 1234 | bank | – | pass | pass |
| 20 | union mobile banking credit | txn_credit | income | 2500.00 | 1234 | bank | – | pass | pass |
| 21 | federal ATM withdrawal | txn_debit | expense | 2000.00 | 1234 | bank | – | pass | pass |
| 22 | hdfc NEFT salary credit | txn_credit | income | 45000.00 | 1234 | bank | – | pass | pass |
| 23 | reversal of a debit is a refund (T0a) | refund | income | 500.00 | 1234 | bank | – | FAIL | pass |
| 24 | card bill paid from a bank a/c (T0e) | txn_debit | expense | 10000.00 | 1234 | bank | cp 9999, card_payment | FAIL | pass |
| 25 | wallet top-up from a bank a/c (T0b) | txn_credit | income | 1000.00 | null | other | cp 1234 | FAIL | pass |
| 26 | debit naming a "reversal of credit" stays a debit (C6) | txn_debit | expense | 500.00 | 1234 | bank | – | pass | pass |
| 27 | credit naming the sender a/c first (T0b) | txn_credit | income | 2000.00 | 1234 | bank | cp 9999 | FAIL | pass |
| 28 | OTP for a card txn | otp | – | – | – | – | – | pass | pass |
| 29 | credit card bill due | bill_due | – | – | – | – | – | pass | pass |
| 30 | e-mandate future debit | mandate_future | – | – | – | – | – | pass | pass |

Targeted cases (readSms.r5d.test.ts, 21 cases): three reversal wordings
(has been / is / was; reversed / refunded; to / into), C6 stays a debit, a
"will be reversed" footer stays a debit; wallet top-up, other-account credit,
lone sender a/c kept, debits untouched, plain wallet top-up unchanged; long
mask normalizer + "never changes a key v1/v2 produced"; 3-digit extraction;
three card-payment wordings, a card spend and a card issuer's
"payment received" are NOT card payments.

Rules (reader only; versions unchanged — see Decisions):
- T0a: `debited … (has been|is|was) (reversed|refunded) (to|in|into) your a/c` → label `refund`, income.
- T0b: credit + `from <words> a/c NNNN`: wallet sender (institutionKind 'wallet') → kind `other`,
  bank = the wallet, lastFour null; otherwise the account named OUTSIDE that phrase wins. The
  "from" digits become `counterpartyLastFour` (display only, never matched, not stored).
- T0c: `[x*]+ then 5+ digits` → last 4, checked after every earlier pattern (fills '' only).
- T0d: `(a/c|acct|account|card) … [x*.#]+ NNN` → `lastDigits` only when no last-4 exists.
- T0e: debit verb bound to `from (your) … a/c NNNN` (or `a/c NNNN (is) debited`) + `credit card NNNN … payment`
  (or `payment of … credit card NNNN`) → kind `bank`, the a/c digits, `counterpartyLastFour` = card,
  `moneyHint: 'card_payment'`, label `txn_debit`. Held from auto-approve (`heldForCardPayment`);
  the transfer conversion stays for R5e.

## T1 — hash design + salt lifecycle

- `smsContentHash = hex(SHA-256(salt + ":" + header + ":" + floor(date/1000) + ":" + body))[0..32)`
  - header = the public DLT header ID from `parseSender` (so the operator prefix and the -S/-T suffix do
    not matter), or the literal `<NUMBER>` for any non-header sender (digits never enter the input).
  - body = whitespace folded and trimmed — NOT the footer cut (identity of the whole message).
- SHA-256 is pure TypeScript (`shared/crypto/sha256.ts`), tested against the published vectors
  ("", "abc", the 448- and 896-bit strings, one million "a") and cross-checked with Node's crypto
  (test-only) for every length 0..130 and multi-byte UTF-8.
- Salt (owner decision O1): 32 bytes from `SecureRandom` via the new `TrackerBackup.randomBytes(n)`
  (1..64 bytes, returns hex, nothing logged or kept), stored once as 64 hex chars in
  `app_settings.sms_identity_salt` (INSERT OR IGNORE + re-read; a damaged row is replaced).
  It is NOT a device-local key, so the encrypted backup carries it; a restore replaces app_settings,
  and every sync reads the salt fresh from the database at its start — so the restored salt is in
  place before any sync. If the native module is missing (jest) the WebCrypto CSPRNG is used; if no
  salt can be had at all, sync still runs and dedupes by the old key only.
- `sourceReferenceHash` (`sms-<_id>-<date>`) is UNCHANGED; the content hash sits beside it.
- Lazy backfill: a candidate whose old key matches a row (or tombstone) without a content hash writes
  the hash to it: `UPDATE transactions SET sms_content_hash = ? WHERE id = ?` in one db.transaction
  per page — no audit row, no updated_at, no other field. Same for `sms_deleted_refs`.
- Deleting an SMS item now writes the tombstone with its content hash and reference key.

## T2 — reference digest

- `ref_digest = hex(SHA-256(salt + ":" + upper(ref)))[0..32)`; FNV-1a (`extract.digest`) is removed;
  the reader only produces a digest when given the salt.
- Stored on `transactions.ref_digest` (indexed). Tombstones get `ref_key =
  SHA-256(ref_digest + ":" + type + ":" + amount)[0..32)` so a deleted debit stays deleted when a
  second alert with the same reference arrives, without storing the amount or the reference.
- duplicate.rules: same ref_digest + type + amount = a duplicate suggestion on ANY account at ANY
  distance (taken before time-window pairs; dismissals respected; still user-confirmed).
  `markDuplicate` accepts such a pair across two accounts. Review "Possible duplicates" filter by
  account now matches either side; its hint mentions the payment reference.
- Refund ranker: `sameReference` ranks first (before same merchant / account / date).

## Dedupe order (sync and "New accounts found" Add/Link, same code: `checkSmsCandidate`)

1. lazy backfill (old key matches a row / tombstone with no content hash);
2. old key `sms-<_id>-<date>` on any row (any status) or tombstone → skip;
3. content hash on any row (any status) or tombstone → skip;
4. `ref_digest:type:amount` on a pending / approved / rejected row, an earlier item of this run, or a
   tombstone `ref_key` → skip (counted as skipped);
5. otherwise new. A reversal (income) never collides with its debit (type differs).

## Migration

Migration 9 (R5-fix folded its tombstone table into 8):
```
ALTER TABLE transactions ADD COLUMN sms_content_hash TEXT
ALTER TABLE transactions ADD COLUMN ref_digest TEXT
ALTER TABLE sms_deleted_refs ADD COLUMN sms_content_hash TEXT
ALTER TABLE sms_deleted_refs ADD COLUMN ref_key TEXT
CREATE INDEX IF NOT EXISTS ix_transactions_sms_content_hash ON transactions(sms_content_hash)
CREATE INDEX IF NOT EXISTS ix_transactions_ref_digest ON transactions(ref_digest)
```
No data statement (nothing to replay on restore). ROADMAP R6 now says migration 10.

## Alias rules (T3) — no new table; 'linked' decisions are the aliases

- T3a `resolveAccountBySuffix`: candidate has `lastDigits`, no last-4, a known bank; an ACTIVE account
  whose name resolves to the same bank and whose 4-digit last_four ends with the digits; exactly one
  → matched, else unmatched. Order in `partitionCandidates`: exact → v1 legacy → linked/added
  routes → ignored / deleted drop → suffix → suggested.
- T3b `debitCardLinkTarget`: a 'bank' group of a known bank whose bank has exactly ONE active bank
  account. The card shows "Looks like your debit card for <account>", a "Link to <account>" button
  (opens the existing link confirm dialog, with that copy instead of the last-4 mismatch warning),
  "Link to another account" (picker, that account first), Add, Ignore. Confirm → the existing
  `linkSuggestion` path ('linked' decision + 'account_linked' audit + C11 undo). Never automatic.
- T3c Accounts screen, on each account card: "Linked card / account numbers" from its 'linked'
  decisions (`HDFC · Bank · ••5678`, last-4 masked in feedback screenshots) with Unlink → confirm →
  the existing `undoLink` path with no rows: the decision is removed and one 'account_unlinked' audit
  (bank id, kind, items 0) is written; recorded items stay. No SMS content shown.
- T3d: tests prove a debit-card alert + the account alert for one spend are NOT a duplicate pair before
  linking (card alert unmatched), ARE one after linking, and later card alerts route to the account.

## Backup changes

- `BACKUP_TABLES`: transactions.sms_content_hash / ref_digest and sms_deleted_refs.sms_content_hash /
  ref_key at version 9; completeness test green at every version 0..9.
- `sms_identity_salt` is backed up (asserted not device-local); a v9 round-trip test restores the
  hashes and the salt exactly; a v8 backup restores with NULL hashes (lazy backfill fills them on the
  same phone; on a NEW phone a pre-R5d backup still re-imports, as before).
- Test: restore on a new phone (rows + salt restored, every `_id` changed) imports 0 new items.

## Gates

- `npx tsc --noEmit -p tsconfig.json`: clean.
- `npx eslint src --ext .ts,.tsx`: 0 errors (2 warnings, both pre-existing: MainTabs nested component,
  StatTile inline style).
- `npx jest`: 112 suites, 1762 tests, all pass (was 104 / 1645).
- `cd android && ./gradlew assembleDebug`: BUILD SUCCESSFUL (`:app:compileDebugKotlin` ran).
- Method: T0 tests were written first and failed (20 failing); T1/T2 sync tests were written with the
  code, then checked by a mutation (content-hash + reference checks switched off → 8 tests fail).
- Leak scan (shell only): this report 0 hits. Src diff incl. untracked: only public bank codes
  (21 + 3 occurrences) and synthetic 000000000xxx references, all in fixture / test files
  (smsReader.fixture.ts, readSms.r5d.test.ts, syncSms.r5d.test.ts, smsIdentity.test.ts, and one
  bank-code negative assertion in syncSms.reviewFixes.test.ts). No other hit.

## Decisions

1. The 30 review bodies were not available; I wrote 30 synthetic ones in the same shapes (22/30 → 30/30).
2. Tombstone reference dedupe needed type + amount: added `sms_deleted_refs.ref_key` (one more ALTER
   than the listed statements), a hash of ref_digest + type + amount — no amount or reference stored.
   No index on tombstone columns (the table is read whole into memory once per sync).
3. PARSER_VERSION and ACCOUNT_KEY_NORMALIZER_VERSION stay 2. The normalizer only fills '' (T0c) and
   gained a separate `extractLastDigits`; no v1 / v2 key it produced changes. T0a/b/e change the
   reader's output for those shapes only, and reader v2 has not reached any phone yet (tester APK and
   device tests wait for R5–R5g), so no stored v2 key or decision can be orphaned.
4. `counterpartyLastFour`, `lastDigits`, `moneyHint` live on the parsed candidate only (no column);
   the card-payment hold is applied at insert time (sync and Add/Link).
5. "Account detail" = the account card on the Accounts tab (the app has no separate account screen).
6. Unlink from an account keeps the recorded items (only the decision goes; audit items = 0) — the
   undo-of-a-fresh-link (C11) still removes the items that link added.
7. T3a does not require the account type to match (spec: same bank + suffix + unique); it requires a
   4-digit last_four and a resolvable bank name.
8. Lazy backfill writes only the content hash (spec); old rows get no ref_digest, so T2 covers rows
   recorded from R5d on.
9. Salt fallback order: native SecureRandom → WebCrypto → (none) sync continues on the old key only.
10. Rows added from "Messages not understood" get no content hash (the body is not at hand when saving).

## Anything surprising

- `fakeDb` silently ignored `DELETE … AND decision = 'linked' AND …` (a quoted literal), so the
  undo-link decision delete never actually ran in fake-DB tests before. I taught fakeDb literal
  conditions and UPDATE by a non-id key; every existing test still passes.
- Existing tests adjusted (not weakened): migration "8 is last" moved to the new migration-9 test;
  ALTER count 10 → 14; the tombstone INSERT now has 4 params (asserted: one-way keys only); the
  session-privacy test allows exactly one extra INSERT, the 64-hex salt; the auto-approve result
  gained `heldForCardPayment`.

## DEVICE PLAN (later — after R5–R5g; counts only)

Never open, print or store a real SMS; never link / unlink a real account without the owner.
1. Install the debug-signed build over the existing one (data kept). Force-stop, launch, check
   foreground = com.tracker, no crash in a filtered logcat.
2. Before: note COUNTS only — transactions with source 'sms' (Pending + Transactions screen totals).
3. Settings → "Re-read messages with the new reader" (rescan). After: the SMS item count must be
   +0 (only new SMS since the last sync may add items; compare against the audit row's created count).
4. Rows backfilled with a content hash: COUNT only. The app has no screen for it, so this is
   inferred: after step 3, every SMS item seen by the rescan holds a hash; verify indirectly with
   step 8 (restore + rescan = +0). No database access.
5. A second rescan: created must be 0.
6. Accounts tab: number of "Linked card / account numbers" per account (counts only, no digits).
7. With the owner present, on the synthetic "QA Delete Bank 9999" only: link a QA debit-card group,
   check the hint text appears, Unlink, check the count returns to 0.
8. Backup → restore on the same phone → rescan: created must be 0.
