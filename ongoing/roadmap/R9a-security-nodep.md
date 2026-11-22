# R9a — Security, no-dependency half

Branch `phase/R9a-security-nodep`. NO migration (still 14), NO permission
(AndroidManifest untouched), NO dependency (package.json / gradle untouched).
R9b (biometric app lock, androidx.biometric) is deferred.

## Built

- **T1 Hide amounts.** app_settings key `hide_amounts` ('on'/'off', default off).
  `src/features/security/securitySettings.ts`: `initSecurityOnLaunch()` reads
  the key and calls `setRedacted()`; `setHideAmounts(on)` writes the key + one
  `settings_changed` audit (from/to on/off) in one transaction via
  `settingsRepository.setMany`, then applies live. App.tsx holds the first
  screen until the init finished (no flash of real amounts). Also re-run after
  a restore (reloadAfterRestore). Settings sheet row + switch.
  Feedback screenshot now restores the previous redaction value instead of
  forcing false (it would have cleared a persistent Hide amounts).
- **T2 FLAG_SECURE.** key `secure_screen` (default off). Native
  `SecurityModule` (`TrackerSecurity.setSecureScreen`) stores a boolean in its
  own SharedPreferences (`SecurityPrefs`, file `tracker_security`) and applies
  addFlags/clearFlags on the UI thread. `MainActivity.onCreate` reads the
  prefs and sets FLAG_SECURE before any UI. app_settings stays the source of
  truth; JS re-mirrors the value on every launch and toggle. Settings switch
  + `settings_changed` audit.
- **T3 CSV export.** `csvFromTransactions(rows, accounts, categories)`.
  Columns: `date,type,account,category,merchant,amount,notes` (date = occurredAt
  ISO; amount = real rupees `123.45` from integer paise, no floats). Approved
  rows only, oldest first. Escaping: fields with comma/quote/CR/LF are quoted,
  inner quotes doubled; CRLF line ends; free text starting with = + - @ gets a
  `'` prefix (spreadsheet formula guard). Never any SMS body, sender, preview
  or reference hash. Native path reused: `BackupModule` SAF
  ACTION_CREATE_DOCUMENT, new method `saveText(text, name, mime)` (request
  code 47303). Settings action "Export transactions (CSV)", user-triggered.
- **T4** `scripts/device/r9a.sh` + README section (not run).

## Tests added (all synthetic)

`src/features/security/__tests__/csvExport.test.ts` (escaping, approved-only,
no SMS text, transfer/blank names, paise, sort, formula guard, filename);
`securitySettings.test.tsx` (launch init, defaults, toggle persists + audits +
applies live, failed write, AmountText mask, native bridge calls, audit
sanitise + Activity wording); feedbackFlow restore test.

## Decisions

- The existing redaction flag also masks merchant/notes/last-4/user name, not
  just amounts, so Hide amounts ON masks those too (same flag, per spec).
- `saveText` added to BackupModule rather than a new SAF module; MIME limited
  to text/csv or text/plain; file name sanitised, `.csv` forced.
- New audit keys `hide_amounts`, `secure_screen` added to AuditedSettingKey
  with Activity sentences.

## Known limits

- FLAG_SECURE and the SAF sheet are device-checked only. Export reads the
  in-memory store (all loaded approved rows).
- After a restore from a backup, the secure_screen value comes from the
  restored app_settings.

## Run

`scripts/device/r9a.sh [--skip-install]` (owner-assisted; cancels the save sheet).
