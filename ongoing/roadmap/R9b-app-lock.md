# R9b — App lock (biometric) + Private mode relabel

Branch `phase/R9b-app-lock` (stack tip, migration 14). **No migration.**

## Dependency / permission
- `androidx.biometric:biometric:1.1.0` (android/app/build.gradle). `assembleDebug` OK (proves it resolves).
- Manifest: `USE_BIOMETRIC` only (normal permission). Nothing else added.

## BiometricModule (Kotlin, `TrackerBiometric`)
- `canUseAppLock()` -> `'available' | 'none_enrolled' | 'no_hardware' | 'unavailable'`.
- `authenticate(title, subtitle)` -> resolves `true`; rejects `cancelled | lockout | no_activity | error`.
- Authenticators: `BIOMETRIC_WEAK | DEVICE_CREDENTIAL` for both calls. Any biometric, or the phone PIN / pattern /
  password as the built-in fallback; no negative button (the library forbids one with DEVICE_CREDENTIAL).
  WEAK|CREDENTIAL is valid on every API >= minSdk 24 (STRONG|CREDENTIAL is not on API 28-29). No crypto, no keys,
  nothing stored or logged. Runs on the UI thread against the current FragmentActivity (ReactActivity is one).
- JS wrapper `src/native/android/security/biometricNative.ts` never throws (missing module = unavailable / false).

## Settings keys + enable guard (`securitySettings.ts`)
- `app_lock_enabled` ('on'|'off', default off), `app_lock_timeout` ('immediate'|'1'|'5', default immediate), in
  app_settings. Each change writes the key + a `settings_changed` audit (key + from/to enums only) in one tx.
  Both keys added to `AuditedSettingKey` with Activity sentences.
- `enableAppLock()` calls `canUseAppLock()` first; anything but `available` writes nothing and returns the reason.
  Settings shows "Set up a screen lock first" (or "not available right now" for `unavailable`).
- Live config cache (`getAppLockConfig`) loaded by `initSecurityOnLaunch` (also runs after a restore).

## Lock rule + overlay
`shouldLock(enabled, timeout, backgroundedAtMs, nowMs, coldLaunch)`: disabled -> false; cold launch -> true; no
background timestamp -> false; `immediate` -> true; `1`/`5` -> elapsed >= minutes; clock gone backwards -> true.
`AppLockGate` (wraps the app content in App.tsx): opaque absolute overlay above everything, content stays mounted
(navigation survives) but is hidden from touch + accessibility. Records the background time only while open;
re-evaluates on foreground; auto-prompts on lock; "Unlock" re-triggers after cancel; a prompt already in flight is
never doubled (the device-PIN screen backgrounds the app, ignored while locked). Overlay is opaque until the cold
decision is made (no content flash).

## Relabel (fold-in)
Global toggle: title "Private mode", subtitle "Hides amounts, names, notes and card numbers", a11y
"Private mode. On/Off". Activity: "You turned on/off Private mode", impact "Amounts, names, notes and card numbers
are masked". Key `hide_amounts` unchanged; Activity-screen eye untouched. r9a.sh + README labels updated.

## Tests added
`appLock.test.ts` (enable guard x4, disable, timeout, launch load, audit/Activity sentences, shouldLock x6),
`AppLockGate.test.tsx` (8: disabled, cold lock + prompt, pending, success, cancel + retry, immediate, timed,
no-screen-lock fail-open). `securitySettings.test.tsx` wording updated.

## Decisions
- Fail-open when the phone has no screen lock / biometric (`none_enrolled`/`no_hardware`): never trap the owner
  (e.g. a backup restored onto a new phone). A transient `unavailable` still locks (Unlock retries).
- Disabling App lock needs no re-auth (the app is already unlocked when Settings is open).
- Enabling does not run a test prompt (spec: availability check only).

## Known limits
- System dialogs that background the app (SMS permission, CSV save sheet) count as leaving: with "Right away" the
  app locks after them.
- The native prompt and the real lock/unlock are device-only (manual R5 in r9b.sh).
- Private mode / FLAG_SECURE are independent of App lock.

## Run
`scripts/device/r9b.sh [--skip-install]` (flips nothing; manual lock steps are printed). Not run here.
