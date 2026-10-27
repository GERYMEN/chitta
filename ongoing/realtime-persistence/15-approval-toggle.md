# Phase 15 — Approval mode as a toggle (code only)

## What changed
- **T1** `src/features/profile/components/ProfileForm.tsx`: the Manual⇄Auto `TwoPositionSlider` is replaced by a row with the label "Auto-approve" and a React Native `Switch` (`testID="approval-mode-switch"`). The row is at least 48dp tall and the switch has `accessibilityLabel="Auto-approve"` and `accessibilityRole="switch"`. ON = `'auto'`, OFF = `'manual'`. It uses the same trackColor and thumbColor tokens as PermissionsScreen (`primary` / `surfaceContainerHigh`, thumb `surfaceContainerLowest`). The helper text below it is the copy from the prompt. The `MODE_OPTIONS` constant and the `ApprovalMode` import are removed.
- **T2** The threshold block (`testID="threshold-block"`) is always rendered, so toggling no longer makes the sheet jump.
  - When the switch is off, the header and range labels are dimmed to 0.5 opacity. The `Slider` gets `disabled`: the PanResponder refuses the gesture, accessibility actions do nothing, it dims itself to 0.5 and reports `accessibilityState.disabled`.
  - The helper text under the slider reads "Turn on Auto-approve to use the threshold" when off, and the existing "≥ N% approved automatically…" copy when on.
  - The slider itself is unchanged.
- **T3** `TwoPositionSlider` was only used by ProfileForm. I deleted it from `src/shared/ui/Slider/Slider.tsx`, along with `TwoPositionOption`/`TwoPositionSliderProps`, its `two*` styles and the imports that are now unused (`Pressable`, `Text`, `spacing`, `typography`). It had no tests of its own and no explicit barrel export (the barrel uses `export *`). `Slider` and `sliderMath` are kept.
- **T4** New render test `src/features/profile/components/__tests__/ProfileForm.test.tsx` (react-test-renderer, the same approach as `__tests__/App.test.tsx`). It checks three cases:
  - manual: switch off, slider disabled, "Turn on…" copy shown
  - toggling on: switch on, slider enabled and still mounted
  - auto initial: switch on
  
  The schema tests are unchanged. Storage keys and approval rules are untouched.

## Gates
| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx eslint src --ext .ts,.tsx` | 0 errors (3 warnings that were already there, outside the touched files) |
| `npx jest` | 25 suites / 254 tests pass |
| `./gradlew assembleDebug` | OK |

No device work and no git commit.

## For the orchestrator to check on the device
- Toggling the switch in the Home settings sheet and in onboarding ProfileSetup should not change the sheet height.
- When off, the threshold should look dimmed and should not drag.
