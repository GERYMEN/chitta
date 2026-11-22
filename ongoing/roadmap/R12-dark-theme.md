# R12 — Dark theme

Branch `phase/R12-dark-theme`. No migration, no dependency, no permission (RN `Appearance` is built in).

## Token split
- `src/theme/colors.ts`: `lightColors` (the old `colors`) + `darkColors` + `type ColorTokens = typeof lightColors`.
  64 keys, identical in both (test: `Object.keys` equal).
- docs/DESIGN.md defines the light palette only (its dark-mode text is prose, no dark hex), so **every dark value is derived**
  (Material-style dark counterparts of the green seed). 44 keys differ from light (all derived): surface*, onSurface*,
  inverse*, outline*, surfaceTint, primary/onPrimary/inversePrimary, secondary*, tertiary/onTertiary, error*, background,
  obsidian (lifted so the "obsidian" card separates from the dark canvas), scrim, the 8 state keys, 2 category-amber keys, backdrop.
  20 keys are intentionally identical (brand/Fixed tokens: primaryContainer, tertiaryContainer, *Fixed*, whatsapp, onObsidian, viewerScrim, ...).
- New flat tokens added to both palettes: transaction state matrix (`approvedFg/Bg`, `pendingFg/Bg`, `rejectedFg/Bg`, `failedFg/Bg`),
  `categoryAmberFg/Bg`, `backdrop` (sheet dim), `viewerScrim` (receipt viewer). `stateColorsFor(c)`, `chartSeriesColorsFor(c)`,
  `chartOtherColorFor(c)` replace the old static `transactionStateColors` / `chartSeriesColors` / `chartOtherColor`.

## Provider, hook, pattern
- `src/theme/ThemeProvider.tsx`, `themeContext.ts`, `useTheme.ts`, `themeMode.ts`. `useColors()` -> `ColorTokens`;
  `useTheme()` -> `{ colors, spacing, radii, typography, shadows, mode }`. No provider (isolated tests) = light.
- Components: `const makeStyles = (c: ColorTokens) => StyleSheet.create({...c.x...})` at module scope (pure);
  in the component `const c = useColors(); const styles = useMemo(() => makeStyles(c), [c]);`.
  Where a file already used an identifier `c`, the palette variable is `pal`. Other helpers became factories taking the palette
  (`getCategoryVisual(id, category, colors)`, `budgetStateColors(c)`, `makeBackupScreenStyles(c)`, `donutItems(rows, cats, c)`, ...).
- 96 source files migrated to the hook (+ `categoryVisuals.ts`, `budgetLabels.ts`, `backupScreenStyles.ts` converted to palette-parameter factories).
  Static `colors` export removed; `theme` object kept as a light snapshot for the `Theme` type only.
- Mechanical part done by a throwaway AST codemod (not committed), then hand-fixed: module-scope maps (Button/Chip/TransactionRow/Activity/Insights), JSX `colors=` prop.

## Mode resolution and the setting
- `app_settings.theme_mode` = `'system' | 'light' | 'dark'` (default `'system'`; unknown value -> system).
- `resolveThemeMode(setting, scheme)`: light/dark forced; system follows `useColorScheme()` live (null -> light).
- Loaded at launch alongside `initSecurityOnLaunch` (before the first screen draws) and after a restore (`reloadAfterRestore`).
- Settings sheet: new "Theme" row with System / Light / Dark radio chips (`settings-theme-*`). `setThemeMode` writes the key +
  `settings_changed` audit (key + from/to enum only, none when unchanged) and applies live only after the write succeeds.
  `theme_mode` is in `AuditedSettingKey`; Activity sentence: "You set the theme to dark/light" / "...to follow your phone".
- `ThemeProvider` also calls `Appearance.setColorScheme('auto' | 'light' | 'dark')` so native chrome (DayNight AppCompat) follows an explicit choice.

## StatusBar / navigation chrome
- `App` = `ThemeProvider` > `AppRoot`. StatusBar `barStyle` follows the mode (light-content in dark). `AppProviders` builds the
  react-navigation theme (DarkTheme/DefaultTheme base + our background/card/text/border/primary) so card background and transitions do not flash.
- BottomSheet, Dialog, Snackbar, Slider, Switch, Card, Chip, Button and all screens read the hook.

## Stray hex
None left outside `src/theme/colors.ts` (tests excepted). Moved to tokens: StatTile badge, Home waiting badge, detail status icons,
DueBills overdue, Bills/Accounts overdue text, Tour icon, category amber (`#FBE3C2`), sheet backdrop, receipt viewer scrim, shadow colour
(`shadows.ts` now references `lightColors.obsidian`). Minor: the old overdue red `#B91C1C` is now the state `failed` token.

## Tests added
- `src/theme/__tests__/theme.test.tsx` (10): key parity, state derivation, mode resolution (system/light/dark, live flip through the provider),
  no-provider default, launch load + fallback, set + audit + live apply, no-audit when unchanged, failed write leaves mode, audit sanitise + Activity sentence.
- `src/theme/__tests__/themedRender.test.tsx` (8): Home, Transactions, BottomSheet, Card/Chip/Button render in light and dark without throwing
  (Card/Chip read the active palette's tokens). Structure only — no contrast assertions.
- `CategoryDonut.test.tsx` updated for the palette parameter (both palettes, distinct series).

## Not migrated / known limits
- No file left unmigrated. Contrast is visual and device-only (manual step in r12.sh). Donut slice `onTertiaryContainer` (#694000) on a dark card
  is the weakest chart colour and the first thing to eyeball. Fixed-family category swatches (lime/amber/grey) stay light-tinted chips in dark by design.

## Gates
tsc clean; eslint 0 errors (1 pre-existing MainTabs warning); jest 181 suites / 2812 tests pass; validate_v2 ALL OK (rules.json untouched);
`./gradlew assembleDebug` BUILD SUCCESSFUL.

## Device script
`scripts/device/r12.sh [--skip-install]` (owner-assisted, `bash -n` only, not run). README section "R12 — Dark theme" added.
