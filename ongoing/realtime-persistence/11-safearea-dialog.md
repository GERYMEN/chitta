# Phase 11: Safe-area fixes and themed Dialog

Executor: Claude subagent. Nothing was committed to git.

## Gates

| gate | result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx eslint src --ext .ts,.tsx` | 0 errors. The 3 warnings were already there before this phase (MainTabs nested component, StatTile inline style, PendingScreen separator). |
| `npx jest` | 15 suites and 190 tests pass, including 4 new dialog-store tests |
| `./gradlew assembleDebug` | BUILD SUCCESSFUL |
| `grep -rn "Alert.alert" src` | no matches |
| logcat for the whole device session (13,499 lines) | 0 `FATAL EXCEPTION`, 0 `Maximum update depth`, 0 ReactNativeJS errors. The AndroidRuntime lines are D/I level only, from the adb tools. |

## Files changed (11)

New:
- `src/shared/ui/Dialog/dialogStore.ts`: Zustand store plus `showDialog()` and `isDestructiveDialog()`
- `src/shared/ui/Dialog/Dialog.tsx`: the `Dialog` view and `DialogHost`
- `src/shared/ui/Dialog/index.ts`
- `src/shared/ui/Dialog/__tests__/dialogStore.test.ts`

Modified:
- `src/shared/ui/index.ts`: exports `./Dialog`
- `src/app/App.tsx`: mounts `<DialogHost />` once, inside `AppProviders`, as a sibling of the navigator
- `src/features/home/screens/HomeScreen.tsx`: 3 alert sites now use `showDialog`
- `src/features/transactions/screens/TransactionDetailScreen.tsx`: delete confirm now uses `showDialog`
- `src/features/pending/screens/PendingScreen.tsx`: delete confirm now uses `showDialog`, and the screen is wrapped in `SafeAreaView edges={['top']}`
- `src/features/accounts/screens/AddAccountScreen.tsx`: the duplicate-account message now uses `showDialog`
- `src/features/transactions/screens/TransactionsScreen.tsx`: wrapped in `SafeAreaView edges={['top']}`
- `src/features/accounts/screens/AccountsScreen.tsx`: wrapped in `SafeAreaView edges={['top']}`. Prettier also reformatted this file.

Two other files are covered by the same changes:
- `OnboardingScreen.tsx` needed no change. It renders `OnboardingShell`, which already wraps everything in `SafeAreaView edges={['top','bottom']}`. The orchestrator's audit only looked at `screens/*.tsx`, so it missed this.
- The Pending review `BottomSheet` already adds the bottom inset, from Phase 10.

## Dialog design

- **Structure:** RN `Modal` with `transparent`, `animationType="fade"` and `statusBarTranslucent`. It has a full-screen scrim and a centered surface. No new dependencies were added.
- **Scrim:** `colors.obsidian` at 0.4 opacity, applied as a View opacity so no hex value is hard-coded.
- **Surface:** `colors.surfaceContainerLowest`, `radii.lg` (32), `spacing.lg` padding, `shadows.level2`. These are the same tokens the BottomSheet uses.
- **Icon:** an optional 52px circle (`radii.full`).
  - Destructive dialogs use an `errorContainer` background with an `error` glyph.
  - Other dialogs use a `surfaceContainerLow` background with a `primary` glyph.
  - The icon comes from the shared `Icon` (MaterialCommunityIcons).
- **Text:**
  - Title: `typography.headlineSm`, `colors.onSurface`.
  - Message: `typography.bodyMd`, `colors.onSurfaceVariant`.
- **Actions:**
  - Actions use the shared `Button`. Cancel is `ghost` (48dp). Delete is `destructive` (56dp). OK, Open Settings and Go to Accounts are `primary` (56dp).
  - Two actions sit side by side; any other number stack full-width.
- **API:** `showDialog({ title, message?, icon?, actions?: [{ label, variant?, onPress? }] })`. If no actions are given, the dialog gets a single "OK".
- **Behaviour:**
  - Tapping an action closes the dialog first, then runs `onPress`.
  - Hardware back dismisses without running any handler.
  - A scrim tap dismisses only non-destructive dialogs.
  - Each `DialogHost` selector returns a single stable reference (`current`, `dismiss`, `press`). None returns a new object or array, so `useShallow` is not needed.
- **Icons used:**
  - `trash-can-outline`: delete
  - `message-lock-outline`: SMS permission needed
  - `shield-alert-outline`: SMS permission blocked
  - `wallet-plus-outline`: no accounts
  - `alert-circle-outline`: duplicate account
- **Unchanged behaviour:**
  - Delete still needs an explicit confirm.
  - Open Settings still calls `Linking.openSettings()`.
  - Go to Accounts still runs `navigation.navigate('Accounts')`.
  - ToastAndroid toasts are untouched.

## Device verification

Device: 1260×2800. The status bar inset is `[0,0][1260,162]` and the navigation bar inset is `[0,2728][1260,2800]` (from `dumpsys window`). A screen passes when its top text has y > 162 and its bottom-most content button ends at y ≤ 2650.

| screen | top text y | bottom button bottom y | result |
|---|---|---|---|
| Home | 210 | (tab bar 2582–2728, above nav inset) | PASS |
| Transactions | 210 (was under the status bar) | (tab bar) | PASS |
| Pending | 210 | (tab bar). Review sheet Edit/Reject end ≈2632 | PASS |
| Accounts | 210 | Add New Money Source ≈2380, after scrolling | PASS |
| Transaction Detail | 186 | Delete 2632 (sticky footer) | PASS |
| Add Record | 186 | Save 2536, after scrolling | PASS |
| Edit Transaction | 186 | Save 2536, after scrolling | PASS |
| Add Account | 186 | Save Account 1656 | PASS |
| Sms Suggestions (reached through Sync SMS) | 186 | Add Account 2617 (2463 after scrolling) | PASS |
| Permissions | not reachable | not reachable | Code review only: `SafeAreaView` top and bottom |
| Onboarding | not reachable | not reachable | Code review only: `OnboardingShell` `SafeAreaView` top and bottom |

Permissions and Onboarding only appear on first launch. Reaching them would require uninstalling or clearing data, which this phase does not allow.

### Dialogs

All dialogs were checked with filtered dumps. Every dump showed 0 stock AlertDialog ids (`android:id/alertTitle`, `button1`, `button2`).

- **Account already exists:** I re-entered the synthetic "QA Test Bank 0002", Bank, 2222. The themed dialog appeared with its title and message at y 1274–1490 and an OK button. Tapping OK closed it, the app stayed on Add Account, and no duplicate was created.
- **Delete transaction? (Transaction Detail):** I tested this on a synthetic record "QA-Merchant-04" (₹44, QA Test Bank 0002), which I created through Add Record and approved.
  - The themed dialog appeared with its title, message, Cancel and Delete.
  - Tapping the scrim did not dismiss it, because it is destructive.
  - Hardware back dismissed it and the record was kept.
  - Cancel closed it and the record was kept.
  - Delete removed the record and navigated back to Transactions, where QA-Merchant-04 was gone.
- **Delete transaction? (Pending):** I migrated this site, but in the current UI it cannot be reached. The Pending sheet only shows pending records, and `TransactionDetailActions` renders Delete only for records that are not pending. I verified this site by code review. It uses the same dialog config as the Transaction Detail site, which passed on device.
- **The three Home sync dialogs** (SMS permission needed, SMS permission blocked, Add an account first): I could not trigger these. READ_SMS is granted on the device and accounts exist. Triggering them would mean revoking the owner's permission or deleting accounts, so I verified them by code review only. They use the same `Dialog` component as the dialogs that passed on device.

## Device safety

- Only `com.tracker` was used. `topResumedActivity` was checked before every tap and every dump, and no other app ever came to the foreground.
- Every dump went through a probe that prints only the top text node, the bottom clickable, and allowlisted labels. Any other text was printed as `<other>`. `/sdcard/u.xml` was deleted after each dump.
- Sync SMS was tapped once to reach the Suggestions screen. Only the screen title and button bounds were read, with no counts or content.
- No tracker.db, sqlite3 or run-as access. No uninstall, clear-data or screenshots. `font_scale` is 1.0.
- At the end, `com.tracker` was force-stopped.
- Synthetic data left on the device: none new. QA-Merchant-04 was deleted, and the duplicate account was blocked.
- I scanned this report for leaks. It contains only synthetic names (QA Test Bank 0002, QA-Merchant-04) and static UI labels.
