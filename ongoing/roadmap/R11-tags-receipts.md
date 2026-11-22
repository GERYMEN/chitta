# R11 — Tags & receipts

Status: code + tests + gates done; device pass pending (`scripts/device/r11.sh`, owner-assisted).

## Migration 16 (additive)
- `tags(id PK, name, name_key UNIQUE, created_at)`
- `transaction_tags(transaction_id, tag_id, PK(transaction_id, tag_id))` + index `ix_transaction_tags_tag(tag_id)`
- `ALTER TABLE transactions ADD COLUMN receipt_path TEXT` (sandbox file NAME only, never a content:// uri)
- Backup: `tags`, `transaction_tags`, `transactions.receipt_path` all `sinceVersion 16`; N-1 (v15) restore test; fixtures carry synthetic rows.
- Deleting a transaction removes its `transaction_tags` rows (repository `remove`); the tags stay reusable.

## Auto vs custom tags
- AUTO (derived, never stored): `autoTagsFor(txn)` from `paymentMethod`: upi `#UPI`, card `#Card`, cash `#Cash`, bank `#Bank`, other none. Muted, non-removable chips; filterable.
- CUSTOM (stored): `normalizeTagName` = trim, strip leading `#`, collapse spaces, max 30 chars; unique by lower-case `name_key` ('#Food' and 'food' are one tag; display keeps first casing). Add (pick existing or type new) and remove (5 s Undo) on the detail screen.
- Code: `src/domain/tags/`, `src/data/repositories/tag.repository.ts`, store actions `addTagToTransaction` / `removeTagFromTransaction` / `setReceiptPath`.

## Receipts: no permission, no dependency
- `ReceiptModule.kt` (`TrackerReceipt`, registered via `ReceiptPackage` in MainApplication) opens the ANDROID SYSTEM PHOTO PICKER: `MediaStore.ACTION_PICK_IMAGES` on API 33+, else `ACTION_OPEN_DOCUMENT` for images. The picker grants read access to the one chosen image, so no runtime permission and no gradle dependency.
- The bytes are copied (64 KB chunks, 25 MB cap) to `files/receipts/<txnId>-<epochms>.jpg` (app-internal; `allowBackup=false`). Name is unique per attach so the image view never shows a cached old image; a replaced receipt's old file is deleted.
- Served only to the in-app viewer through `ReceiptFileProvider` (`receipt_paths.xml`: `files-path receipts/`), `exported=false`, `grantUriPermissions=false`. File names are validated by regex (no path separators).
- Detail screen (`TagsReceiptCard`): thumbnail (tap = full view), Replace, Remove receipt; or Attach receipt. Remove clears `receipt_path` at once and deletes the file after the 5 s Undo window unless Undo is pressed (Undo re-links only if the file still exists).
- Delete transaction deletes its receipt file (store `deleteTransaction`).
- Missing file (DB backup restored on a new phone, where `receipt_path` points at a file that is not there): the card shows a plain note, "Attach again" and "Clear". No crash.
- Receipts are NOT in the encrypted DB backup, NOT in the CSV export (columns unchanged), NOT in audit, NOT logged.
- Camera capture: DEFERRED (would need the CAMERA permission). Users shoot with their camera app and pick from the gallery.

## Filter + persistence
- `TransactionFilters.tagKey/tagLabel`; predicate matches a custom tag key on the row OR a derived auto tag. Tag counts as an active filter (Reset enabled). Transactions screen: "Tag" chip -> sheet (All tags, 4 auto tags, "Your tags").
- Persisted with the R5j filters in `app_settings` (`tagKey`, `tagLabel`); a custom tag that no longer exists is dropped on load; old stored values load with none; Reset clears it.

## Audit (D-f)
`tag_added` / `tag_removed` (tagId + transactionId), `receipt_added` / `receipt_removed` (transactionId only). Sanitized on read+write; Activity copy + icons added. No tag name, path or bytes.

## Tests added
`domain/tags/__tests__/tag.rules`, `data/repositories/__tests__/tag.repository` (real SQLite: upsert by key, dedupe, detach, delete-with-txn, receipt audit), `domain/audit/__tests__/audit.rules.tags`, `features/transactions/filters/__tests__/transactionFilters.tags`, `features/transactions/state/__tests__/transactionsStore.r11` (store + delete removes receipt file), persistence cases in `filterPersistence.r5j`, migration 16 + run-once in `migrations.test`, N-1 / current backup restore in `backup.repository.test`, mapper receipt_path round trip. Existing tests updated for the new column / version (alter count 19, fixtures, transfers undo).

## Decisions beyond D-a..D-g
- Receipt file name `<txnId>-<epochms>.jpg` (not `<id>.jpg`): avoids image caching on replace and makes Undo-after-remove safe.
- File deletion on Remove is deferred past the Undo window (spec's "deletes the file" + working Undo).
- Tag/receipt card shown for non-pending transactions only.
- `tagLabel` is stored in the persisted filter setting (user text in `app_settings`, which is already backed up) so the chip can show the name without a lookup.
- Auto tags are filter values `#UPI` etc.; custom keys never start with `#`, so they cannot collide.
- Tag loading in `loadAll` is `.catch`-guarded so a tag failure never blocks app open.

## Known limits
- The copied image keeps its EXIF (incl. any location) inside the sandbox only; it is never exported. No downscaling.
- Receipts are lost on a new phone / reinstall (not in backups); the UI says so.
- Orphan receipt file possible if the app is killed inside the 5 s Undo window (harmless; small).
- Camera capture deferred.

## Run the device pass
`scripts/device/r11.sh [--skip-install]` (owner-assisted, counts only; receipt attach = manual, cancel the picker). Not run here (no device).

## Gates
tsc clean; eslint 0 errors (2 existing warnings); jest 179 suites / 2794 tests pass; rules validate ALL OK (rules.json untouched); `assembleDebug` OK.
