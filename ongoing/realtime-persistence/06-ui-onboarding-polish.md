# Phase 6 — UI/Onboarding Polish (Home SafeArea + persisted onboarding flag)

Two user-reported problems fixed:

1. Home greeting header rendered under the Android status bar (no `SafeAreaView`).
2. Onboarding Tour + Permissions showed on every launch (no persisted
   "already onboarded" flag).

## Files changed (chronological)

1. `src/features/home/screens/HomeScreen.tsx`
   - Imported `SafeAreaView` from `react-native-safe-area-context`.
   - Root is now `<SafeAreaView style={styles.screen} edges={['top']}>`; the
     existing `ScrollView` became a child with `style={styles.scroll}`
     (`flex: 1`). Bottom edge left to the bottom tab bar, matching the tab
     screen convention.
2. `src/data/db/schema.ts`
   - Added `app_settings` DDL to `SCHEMA_STATEMENTS`:
     ```sql
     CREATE TABLE IF NOT EXISTS app_settings (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL
     );
     ```
3. `src/data/repositories/settings.repository.ts` (new)
   - `settingsRepository.getValue(key)` → `SELECT value FROM app_settings WHERE key = ?`.
   - `settingsRepository.setValue(key, value)` → `INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)`.
   - Same `@op-engineering/op-sqlite` `db.execute(...)` + `?` parameter pattern
     as the transaction/account repositories.
4. `src/features/transactions/state/transactionsStore.ts`
   - Added `hasOnboarded: boolean` and `completeOnboarding(): Promise<void>`.
   - `hydrate()` now reads the flag alongside `loadAll()`:
     `hasOnboarded = (await settingsRepository.getValue('has_onboarded')) === 'true'`.
   - `completeOnboarding()` writes `('has_onboarded', 'true')` then sets
     `hasOnboarded: true` in state.
5. `src/app/App.tsx`
   - Reused the existing `isHydrated` gate (already present from Phase 1). Now
     also reads `hasOnboarded` and passes it down:
     `{isHydrated ? <RootNavigator initialRouteName={hasOnboarded ? 'Tabs' : 'Onboarding'} /> : <loading/>}`.
   - No new loading screen invented — the existing ActivityIndicator gate is reused.
6. `src/app/navigation/RootNavigator.tsx`
   - `RootNavigator` now accepts `initialRouteName: 'Tabs' | 'Onboarding'` as a
     prop (no more hardcoded `"Onboarding"`), passed to
     `Stack.Navigator initialRouteName={initialRouteName}`. Known at first render
     because it's gated behind `isHydrated` in App.tsx.
7. `src/features/onboarding/screens/PermissionsScreen.tsx`
   - Both exit paths call `useTransactionsStore.getState().completeOnboarding()`:
     - `enterAppManual` — fire-and-forget before `navigation.reset(...)`.
     - `enterApp` — `await ...completeOnboarding()` before `navigation.reset(...)`.
   - Either outcome (SMS granted or skipped) marks onboarding complete.
8. `src/data/repositories/__tests__/settings.repository.test.ts` (new)
   - Light round-trip test: missing key → null; set then get; replace. Mocks
     `db/connection.getDatabase` with an in-memory map (no existing repository
     test pattern existed; matches the mapper-test convention of a focused
     `describe` block).

## Gating logic (exact)

- App renders a loading `ActivityIndicator` until `isHydrated`.
- `hydrate()` runs migrations + loads transactions/accounts/categories + reads
  `app_settings.has_onboarded`, then flips `isHydrated`.
- After hydration, `RootNavigator` mounts with `initialRouteName` already decided
  by the persisted flag — never changed post-mount.

## Gates

| gate | command | result |
|------|---------|--------|
| typecheck | `npx tsc --noEmit -p tsconfig.json` | clean (exit 0) |
| lint | `npx eslint src --ext .ts,.tsx` | 0 errors, 3 warnings (same 3 pre-existing: MainTabs/PendingScreen nested component + StatTile inline style) |
| tests | `npx jest` | 10 suites / 76 tests passed (73 prior + 3 new settingsRepository tests) |
| android build | `./gradlew assembleDebug` (JAVA_HOME + PATH exported) | BUILD SUCCESSFUL in 8s |

## On-device verification (fresh install → onboard → relaunch → skip)

Device `00015365L001524`, package `com.tracker`. Metro running, `adb reverse`
in place. `com.tracker/.MainActivity` confirmed `topResumedActivity` before each
step. Fresh `adb uninstall com.tracker` first, then `adb install -r` of the
debug APK (clean reset of the new `app_settings` flag).

1. **Fresh install, launch** — Onboarding tour shows ("Your money, automatically
   tracked.", "Skip Tour"). Expected on first launch.
2. **Complete onboarding** — tapped "Skip Tour" → Permissions screen (STEP 7 OF 7),
   then "Enter transactions manually instead". Landed on Home. `uiautomator dump`
   (grep-filtered to the single greeting node only) shows
   `text="Good morning, Siraj" bounds="[48,210][1212,312]"` — top bound y=210,
   clearly below the status bar (screen 1260x2800 @480dpi, status bar ≈72–84px),
   no longer overlapping the y≈0–30 icon region.
3. **Force-stop + relaunch (NOT reinstall)** — `adb shell am force-stop com.tracker`
   then `am start`. Landed DIRECTLY on Home ("Good morning, Siraj", tab bar
   Pending/Accounts). No Onboarding/Tour text in the dump — onboarding did not
   reappear.
4. **Crash scan** — `adb logcat -d` grep `FATAL EXCEPTION` / `Maximum update depth
   exceeded` → 0 matches.

## Privacy statement

Only `com.tracker` interacted with. Home/Pending screens were dump-grepped to
structural element labels only (greeting header, section headers, tab names) —
no transaction merchant/amount content transcribed.
