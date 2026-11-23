# Tracker — App Prototype Specification

> Reverse-engineered spec for rebuilding an exact Figma replica (with a clickable
> prototype) of the Tracker app **as it is today**. Documents the app exactly,
> flaws included; no redesign. Companion files in this folder:
> `design_tokens.json`, `navigation_map.mmd`, `screenshots/`.
>
> **Capture note:** screenshots were taken on the real device with **Private mode
> ON**, so amounts, names, merchants, notes and last-4 appear masked (`₹ ••••`,
> `••••••`). That masking is a real app feature, not a redaction added for this
> doc. Many states (error / loading / specific empty states) could not be forced
> on the live build and are marked **code-derived, no screenshot**.

## Table of contents
1. [App overview](#1-app-overview)
2. [Global design system](#2-global-design-system)
3. [Navigation map](#3-navigation-map)
4. [Screen inventory](#4-screen-inventory)
5. [Screen-by-screen specification](#5-screen-by-screen-specification)
6. [Figma build instructions](#6-figma-build-instructions)
7. [Gaps and assumptions](#7-gaps-and-assumptions)
8. [Appendix](#8-appendix)

---

## 1. App overview

| Field | Value |
|---|---|
| App name | Tracker (package `com.tracker`) |
| Purpose | Private, offline personal-finance tracker that reads bank SMS and builds accounts, transactions, bills, budgets, IOUs — everything on-device, no backend. |
| Target users | Individuals in India tracking bank/UPI spending from SMS. |
| Platform | Android (React Native 0.87.1 + Kotlin native modules). iOS not built. |
| Framework | React Native 0.87.1, React 19.2.3, TypeScript. |
| Navigation | React Navigation 7 — `native-stack` (root) + `bottom-tabs`. |
| State | Zustand 5 (per-feature stores). |
| DB | SQLite (op-sqlite), schema at migration 16. Money = integer paise. |
| Charts | Plain RN Views + `react-native-svg` 15.16.0 (Home donut only). |
| Design basis | `docs/DESIGN.md` ("Vibrant Pulse Fintech"). |
| Device captured | 1260 × 2800 px physical Android (Nothing phone), density ~3.5. All sizes below are **dp** unless noted. |
| Supported sizes | Phone portrait. 16 dp screen edge margin, safe-area aware. |
| Theme | System / Light / Dark (R12); Plus Jakarta Sans throughout. |

---

## 2. Global design system

All raw values live in `design_tokens.json`. Summary below.

### 2.1 Colors
Material-3-style token set, **64 keys**, each with a light and dark value (see
`design_tokens.json` → `colors.light` / `colors.dark`). Key roles:

| Role | Light | Dark | Used for |
|---|---|---|---|
| primary | `#006e14` | `#2ae540` | brand green, primary pills, selected |
| primaryContainer | `#00d632` | `#00d632` | bright-green CTA (Add Record) |
| onPrimary | `#ffffff` | `#003907` | text on primary |
| obsidian | `#0B0E11` | `#1f272b` | dark balance card / primary pill |
| onObsidian | `#ffffff` | `#ffffff` | text on obsidian |
| background / surface | `#f6faff` | `#0e1417` | screen background |
| surfaceContainerLowest | `#ffffff` | `#090f12` | cards |
| onSurface | `#141d23` | `#dde3e9` | primary text |
| onSurfaceVariant | `#3c4b38` | `#bbcbb3` | secondary text |
| outlineVariant | `#bbcbb3` | `#3c4b38` | hairline borders (primary elevation device) |
| error | `#ba1a1a` | `#ffb4ab` | errors |
| whatsapp | `#25D366` | `#25D366` | WhatsApp share button only |
| approvedFg/Bg | `#00A827`/`#E6F9EC` | `#4ade80`/`#10301c` | approved state chip |
| pendingFg/Bg | `#B7791F`/`#FEF3C7` | `#f5c76b`/`#3a2c0c` | pending state chip |
| rejectedFg/Bg | `#6C757D`/`#E9ECEF` | `#aab2ba`/`#2a3136` | rejected/duplicate |
| failedFg/Bg | `#DC2626`/`#FEE2E2` | `#ff8a80`/`#3d1a1a` | failed/overdue |
| categoryAmberFg/Bg | `#694000`/`#FBE3C2` | `#ffb961`/`#3a2c0c` | Food/Coffee category badge |
| scrim | `rgba(11,14,17,.72)` | `rgba(0,0,0,.72)` | tour dim |
| backdrop | `rgba(11,14,17,.4)` | `rgba(0,0,0,.6)` | bottom-sheet dim |
| viewerScrim | `rgba(0,0,0,.92)` | same | full-screen receipt viewer |

Donut slice colours are ranked (largest→smallest) via `chartSeriesColorsFor` /
`chartOtherColorFor` (see `colors.ts`).

### 2.2 Typography — Plus Jakarta Sans (5 weights)
Weights picked by family name (RN ignores numeric weight for non-variable custom
fonts): ExtraBold 800, Bold 700, SemiBold 600, Medium 500, Regular 400.

| Style | Family | Size | Line height |
|---|---|---|---|
| displayHero | ExtraBold | 56 | 64 |
| displayHeroMobile | ExtraBold | 44 | 52 |
| headlineLg | Bold | 32 | 40 |
| headlineLgMobile | Bold | 26 | 34 |
| headlineMd | Bold | 22 | 28 |
| headlineSm | SemiBold | 18 | 24 |
| bodyLg | Medium | 16 | 24 |
| bodyMd | Regular | 14 | 20 |
| labelLg | Bold | 14 | 18 |
| labelMd | SemiBold | 12 | 16 |
| labelSm | Bold | 10 | 14 |

### 2.3 Spacing / radius / elevation
- **Spacing (dp):** xs 4, sm 8, md 16, lg 24, xl 32; screen edge margin 16.
- **Radius (dp):** sm 8, default 16, md 24, lg 32, xl 48, full 9999 (pills).
- **Elevation:** philosophy = hairline `outlineVariant` borders over shadows.
  level0/1 = flat (border only); level2 = sheets/modals (y+12, blur 32,
  opacity .08, android elevation 8); level3 = bottom nav (y−2, blur 12,
  opacity .06, elevation 4).

### 2.4 Iconography
Icon-font glyphs (Private Use Area codepoints, e.g. `U+F00xx`) rendered as text;
a line-style set. Bottom-nav icons: Home, Transactions, Pending, Accounts.
Common glyphs: back arrow (48 dp `HeaderBackButton`), edit (pencil), add (+),
income (down arrow in green circle), expense (up arrow in red circle), category
icons (coffee cup, etc.), eye (reveal), chevron `›`. (Exact glyph list = Appendix.)

### 2.5 Reusable components (from `src/shared/ui/`)
| Component | Spec |
|---|---|
| **Card** | bg `surfaceContainerLowest`, radius 16–24, 16 dp padding, hairline `outlineVariant` border, no shadow (level0/1). |
| **Obsidian card** (balance) | bg `obsidian`, radius ~24, white text; holds balance + 2 pills. |
| **Button — primary pill** | bg `primaryContainer` (bright green), `onPrimaryContainer`/dark text, radius full, ~56 dp tall, labelLg. (e.g. "Add Record") |
| **Button — secondary pill** | bg `secondaryContainer` light grey, radius full (e.g. "Sync SMS"). |
| **Button — WhatsApp** | bg `whatsapp` green, radius full. |
| **Chip (period)** | pill; selected = obsidian bg + white text; unselected = transparent + `outlineVariant` border. (1M/3M/6M/9M/1Y) |
| **Chip (filter / tag)** | pill, selectable, `selected` state. |
| **State badge** | fg/bg pair from `stateColorsFor` (approved/pending/rejected/failed). |
| **Stat tile** | Card with label (labelMd, uppercase), amount (headline), period caption; a round tinted icon top-right (income green / expense red). |
| **HeaderBackButton** | 48 dp touch target, back glyph, `onSurface`. |
| **BottomSheet** | slides up, radius 24 top corners, `backdrop` dim behind, level2 shadow. |
| **Snackbar** | bottom toast with message + "Undo" action, ~5 s; shared across undo flows. |
| **AmountText** | formats paise → `₹x,xxx`; respects Private-mode redaction (shows `₹ ••••`). |
| **Bottom nav** | 4 tabs (Home/Transactions/Pending/Accounts); selected = primary green icon+label; Pending shows a count badge. Height ~56 dp + safe area. |
| **ChartBars / CategoryDonut** | swappable chart primitives; donut uses react-native-svg. |

### 2.6 Animations / transitions
- Stack push: default native-stack slide (iOS-style horizontal / Android default).
- Bottom sheets: slide up + backdrop fade.
- Snackbar: slide/fade in from bottom, auto-dismiss ~5 s.
- Tour (R4c): coach-mark overlay with `scrim` dim, RN Animated + PanResponder.
- App-lock overlay (R9b): opaque cover, biometric prompt.
- (No durations declared in tokens; use RN defaults ~250–300 ms, ease-in-out.)

---

## 3. Navigation map
See `navigation_map.mmd` (Mermaid). Structure:
- **Root stack** (`headerShown:false`), initial = `Onboarding` (first launch) or `Tabs`.
- **Onboarding flow:** Onboarding → ProfileSetup → Permissions → SyncStart → Tabs.
- **Tabs (bottom nav):** Home, Transactions, Pending, Accounts.
- **Settings** is a bottom sheet opened from the Home greeting header (not a tab);
  its rows push: Activity, Budgets, People & IOUs, Hidden accounts, Backup,
  Restore, Messages-not-understood, and hold inline toggles (Private mode, Theme,
  App lock, Notifications, Auto-read, Auto-approve) + Export CSV (system sheet).
- **Pushed screens:** TransactionDetail, AddRecord, EditTransaction, AddAccount,
  SmsSuggestions, Categories, Uncategorised, Review, Insights, Bills, AddBill,
  EditBill, Budgets, SetBudget, People, PersonIous, Upcoming, NotUnderstood,
  IgnoredAccounts.

---

## 4. Screen inventory

| ID | Screen | File | Route | Entry | Screenshot |
|---|---|---|---|---|---|
| S01 | Home | features/home/screens/HomeScreen.tsx | Home (tab) | app launch | ✅ light |
| S02 | Transactions | features/transactions/screens/TransactionsScreen.tsx | Transactions (tab) | tab | ✅ light |
| S03 | Pending | features/pending/screens/PendingScreen.tsx | Pending (tab) | tab | ✅ light |
| S04 | Accounts | features/accounts/screens/AccountsScreen.tsx | Accounts (tab) | tab | ✅ light |
| S00 | Settings sheet | features/profile/components/ProfileSettingsSheet.tsx | (sheet) | Home greeting | ✅ light |
| S05 | TransactionDetail | features/transactions/screens/TransactionDetailScreen.tsx | TransactionDetail | txn row | code-derived |
| S06 | AddRecord | features/transactions/screens/AddRecordScreen.tsx | AddRecord | Add Record / reconcile | code-derived |
| S07 | Activity | features/activity/screens/ActivityScreen.tsx | Activity | Settings | code-derived |
| S08 | EditTransaction | features/transactions/screens/EditTransactionScreen.tsx | EditTransaction | detail → Edit | code-derived |
| S09 | Budgets | features/budgets/screens/BudgetsScreen.tsx | Budgets | Settings / Home card | ✅ light |
| S10 | SetBudget | features/budgets/screens/SetBudgetScreen.tsx | SetBudget | Budgets → Set/Add | code-derived |
| S11 | Insights | features/insights/screens/InsightsScreen.tsx | Insights | Home "Where it went" | code-derived |
| S12 | People (IOUs) | features/iou/screens/PeopleScreen.tsx | People | Settings | code-derived |
| S13 | PersonIous | features/iou/screens/PersonIousScreen.tsx | PersonIous | People → person | code-derived |
| S14 | Review | features/review/screens/ReviewScreen.tsx | Review | Home Review card | code-derived |
| S15 | Bills | features/bills/screens/BillsScreen.tsx | Bills | Home due banner | code-derived |
| S16 | AddBill | features/bills/screens/AddBillScreen.tsx | AddBill | Bills → Add | code-derived |
| S17 | EditBill | features/bills/screens/AddBillScreen.tsx | EditBill | Bills → Edit | code-derived |
| S18 | Categories | features/categories/screens/CategoriesScreen.tsx | Categories | Settings | code-derived |
| S19 | Uncategorised | features/categories/screens/UncategorisedScreen.tsx | Uncategorised | Home card | code-derived |
| S20 | Hidden accounts | features/sms-sync/screens/IgnoredAccountsScreen.tsx | IgnoredAccounts | Settings | code-derived |
| S21 | Upcoming | features/upcoming/screens/UpcomingScreen.tsx | Upcoming | Home Upcoming card | code-derived |
| S22 | NotUnderstood | features/sms-sync/screens/NotUnderstoodScreen.tsx | NotUnderstood | Settings | code-derived |
| S23 | SmsSuggestions | features/sms-sync/screens/SmsSuggestionsScreen.tsx | SmsSuggestions | Pending "new accounts" | code-derived |
| S24 | AddAccount | features/accounts/screens/AddAccountScreen.tsx | AddAccount | Accounts → Add | code-derived |
| S25 | Backup | features/backup/screens/BackupScreen.tsx | Backup | Settings | code-derived |
| S26 | Restore | features/backup/screens/RestoreScreen.tsx | Restore | Settings | code-derived |
| S27 | Onboarding | features/onboarding/screens/OnboardingScreen.tsx | Onboarding | first launch | code-derived |
| S28 | ProfileSetup | features/onboarding/screens/ProfileSetupScreen.tsx | ProfileSetup | onboarding | code-derived |
| S29 | Permissions | features/onboarding/screens/PermissionsScreen.tsx | Permissions | onboarding | code-derived |
| S30 | SyncStart | features/onboarding/screens/SyncStartScreen.tsx | SyncStart | onboarding | code-derived |

Overlays (not routes): App-lock biometric overlay (R9b), bottom sheets (Split,
Add tag, meaning confirm), system photo picker (receipt), system save sheet
(CSV), Snackbars, the first-run tour (R4c coach marks).

---

## 5. Screen-by-screen specification

> Screens with screenshots are specified from the captured frame; others are
> **code-derived** (layout from source + feature knowledge) and should be
> screenshot-verified before pixel-final Figma work.

### S01 — Home  ✅ `S01_home_default_light.png`
**Purpose:** dashboard — total balance, period spend/income, pending, cards.
**Frame:** 1260×2800 px device; bg `background` `#f6faff`.
**Layout (top→bottom):**
1. Status bar (system).
2. Header row: avatar circle (primary green, person glyph) · greeting title
   ("Welcome" when Private mode on, else "Good morning, {name}") headlineLg +
   month subtitle (bodyMd, onSurfaceVariant) · edit (pencil) glyph top-right
   → opens **Settings sheet** (the whole greeting is the `home-greeting` button).
3. **Obsidian balance card** (radius ~24, bg obsidian): "TOTAL BALANCE" labelMd
   white · "Verified & Approved" badge w/ green check · amount (headline, masked
   `₹ ••••`) · two pills: **Add Record** (primary-green, →AddRecord) + **Sync SMS**
   (grey, triggers sync).
4. Period chips row: 1M/3M/6M/9M/1Y (selected = obsidian pill).
5. Info lines: "Records start {date} — earlier months may be incomplete." +
   "N pending not included" (clock glyph, pending/amber).
6. Two **stat tiles** side by side: INCOME (down-arrow green circle) / EXPENSES
   (up-arrow red circle), each amount (masked) + "This month".
7. (Conditional cards, in order) Uncategorised, Review, Budget, Upcoming,
   Where-it-went (donut), due banner — each shown only when it has data.
8. **Pending Approval** section: title + "N waiting" amber chip + "See All →";
   helper "Detected from SMS & UPI. Approve before recording."; pending rows
   (category icon, masked merchant, time·method, masked amount).
9. Bottom nav (Home selected green).
**Scroll:** whole body scrolls; header + bottom nav effectively fixed ends.
**Interactions:** greeting→Settings sheet; Add Record→AddRecord; Sync SMS→sync
(spinner in card); period chip→re-filter tiles/cards; card taps→respective
screens; pending row→TransactionDetail; See All→Pending tab.
**States:** populated (shown); empty (no pending/cards → only balance+tiles);
Private-mode masked (shown); loading = Sync spinner. Error states code-derived.

### S02 — Transactions  ✅ `S02_transactions_default_light.png`
**Purpose:** full transaction list with filters.
**Elements:** header title; filter chips (All/Expenses/Income + Account +
Category + Tag bottom-sheet pickers + search merchant/notes + Reset); day-grouped
list (TODAY/YESTERDAY/date headers); rows = category icon, merchant, time·method,
signed amount, state badge. Filter state persists across restart (R5j).
**Interactions:** row→TransactionDetail; chip→filter; search field→keyboard;
Tag chip→tag picker. **States:** populated/empty/filtered/search-open.

### S03 — Pending  ✅ `S03_pending_default_light.png`
**Purpose:** SMS-detected items awaiting approval (nothing auto-recorded, R5h).
**Elements:** header; "Approve all (N)" + Undo; grouped-by-account pending rows
with Approve/Reject; "New accounts found" entry → SmsSuggestions; manual-mode note.
**States:** list / empty ("nothing waiting") / approve-all confirm.

### S04 — Accounts  ✅ `S04_accounts_default_light.png`
**Purpose:** account list + balances + reconciliation.
**Elements:** header + Add; account cards (name, type, masked balance); R6
**balance reconciliation** row when an SMS snapshot differs: "Bank SMS: ₹X as of
{time}" + "Difference ₹Y" + actions Use-bank-balance / Add-missing / Dismiss.
**Interactions:** Add→AddAccount; reconcile actions (see R6). **States:**
list / empty / has-difference / reconciled.

### S00 — Settings sheet  ✅ `S00_settings-sheet_default_light.png`
**Purpose:** profile + all app settings (bottom sheet).
**Rows (as captured):** Your name · Auto-approve (approval mode) · Read new SMS
automatically (toggle) · SMS sync starts: {date} · Re-read messages · Private
mode (toggle, "Hides amounts, names, notes & card numbers") · Theme
(System/Light/Dark chips) · App lock (toggle + Lock right-away/1-min/5-min) ·
Bill reminders / Recurring payment reminders / Weekly summary (toggles + weekday
+ time chips) · Budgets · People & IOUs · Hidden accounts · Activity ·
Messages not understood: N · Export transactions (CSV) · Back up data (+ last
backup date) · Restore from backup · Send feedback.
**States:** default; toggles on/off; "set up a screen lock first" dialog when
enabling App lock with no enrolled lock.

### S09 — Budgets  ✅ `S09_budgets_default_light.png`
**Purpose:** overall + per-category monthly budgets.
**Elements:** "Overall monthly budget" + "Set overall budget" (or progress
bar/ring with state colour + "₹X of ₹Y" + "₹Z left/over"); "Category budgets"
list; "Add budget" (+). State colours: under <0.8 green, near 0.8–1.0 amber,
over >1.0 red. **Interactions:** Set/Add→SetBudget; Remove + Undo. **States:**
empty (no budgets) / with budgets / near / over.

### S05 — TransactionDetail  (code-derived)
**Purpose:** one transaction's full detail + actions.
**Elements:** back header; amount + merchant + category + account + date + method;
**Tags card** (auto chips #UPI/#Card non-removable + custom chips removable +
"Add tag"); **Receipt** section ("Attach receipt" or thumbnail→full viewer);
actions: Edit, **Split** (→IOU sheet), **Mark as transfer**, link refund/duplicate,
View original SMS (for SMS rows). **Interactions:** Edit→EditTransaction;
Split→Split sheet; Attach receipt→system photo picker; tag add/remove + Undo.
**States:** approved/pending; SMS-sourced vs manual; has-receipt vs none; split vs none.

### S06 — AddRecord  (code-derived)
**Purpose:** manual add (also reconcile "Add missing" prefill, R6).
**Elements:** form — amount, type (Expense/Income/Transfer radio), account(s)
picker (radio a11y), category picker, merchant, date, notes; Save. Reconcile
entry prefills amount/kind/account and saves as **pending**.
**States:** untouched/focused/filled/invalid(>0 validation)/disabled; Transfer tab
shows from/to accounts.

### S07 — Activity  (code-derived)
**Purpose:** audit feed (Splitwise-style). Sentence + coloured impact line + time,
grouped by day, newest first. Every money-changing action + settings change.
Amounts masked per Private mode. Tap row → TransactionDetail where applicable.

### S08 — EditTransaction  (code-derived)
Edit form; guards for linked rows (refund/transfer/duplicate), type-locked where
applicable (R3b.1 F1). States: valid/invalid/linked-locked.

### S10 — SetBudget  (code-derived)
Pick category (expense/both only; Uncategorised allowed) + amount (>0). Overall
budget has no category. Save/Edit; Remove+Undo on Budgets.

### S11 — Insights  (code-derived)
Period selector; "Where it went" category bars (₹ + count + % of spend); month
trend bars (income vs expense); merchant history chip → list. Approved non-transfer
only. Donut on Home; bars here.

### S12 — People (IOUs)  (code-derived)
List of people with per-person net ("you lent/you borrowed"); "Add an IOU";
settled hidden after 30 days + "Show settled". Empty = "Add an IOU" only.

### S13 — PersonIous  (code-derived)
One person's shares/history; Record repayment (settle, optional credit link);
delete share + Undo.

### S14 — Review  (code-derived)
Sections: transfers, duplicates, **"Linked by rules"** chain suggestions (R5i:
refund_link/incomplete always; duplicate/transfer_twin if not already listed),
**Money-meaning** cards (R5e: Card bill payment / Cash withdrawal / Wallet top-up
/ EMI → Confirm transfer + "Do this automatically next time"), bill "paid?"
suggestions. Accept re-checks stale/superseded; Dismiss + Undo.

### S15 — Bills  (code-derived)
Open bills (due-soon / overdue sections); Mark paid; manual bills (monthly
repeat); Add bill. Home due banner links here. States: list/empty/overdue.

### S16/S17 — AddBill / EditBill  (code-derived)
Form: payee, amount, due date (nullable), repeat none/monthly, account; validation.
(AddBillScreen also serves EditBill route.)

### S18 — Categories  (code-derived)
Manage categories: create/rename/archive (no hard delete), **Restore** archived
(R5j), icon + colour from theme set. Merchant rules管理 (delete).

### S19 — Uncategorised  (code-derived)
Quick-assign list for uncategorised items (one tap per item, optional "remember"
→ merchant rule). Rows show amount, account, SMS description + View original SMS.

### S20 — Hidden accounts  ✅ (opened; "Nothing hidden" empty state)
Ignored new-accounts list; **Un-ignore** flips the 'ignored' decision. Empty =
"Nothing hidden".

### S21 — Upcoming  (code-derived)
Recurring series due in window (R8a): merchant, ~amount, cadence, last paid, next
due; **Remind me?** (R8b). "Not recurring" session-only dismiss. Empty when none.

### S22 — NotUnderstood  (code-derived)
SMS the parser rejected; masked "Share pattern" over WhatsApp; computes content
hash from live body (R5j). Count shown in Settings.

### S23 — SmsSuggestions  (code-derived)
New accounts found during sync: proposed name, N waiting, date range, in/out,
expandable rows + View original SMS; Add / Link to existing / Ignore.

### S24 — AddAccount  (code-derived)
Form: name, type (Bank/Card/Wallet/Cash/Pay-later), opening balance, credit limit
(pay-later/card). Validation.

### S25/S26 — Backup / Restore  (code-derived)
Backup: password field → SAF save (encrypted PBKDF2-SHA256 600k + AES-256-GCM).
Restore: SAF open → password → confirm (replaces everything, one transaction).

### S27–S30 — Onboarding flow  (code-derived)
Onboarding (welcome/value) → ProfileSetup (name) → Permissions (SMS access +
states) → SyncStart ("Where should SMS sync start?": install date / this month /
last 3 months / whole inbox; manual skip). Then Tabs.

---

## 6. Figma build instructions

### 6.1 Page structure
`00 Cover` · `01 Design System` (colors + type + spacing) · `02 Components` ·
`03 Flows` (the Mermaid map rebuilt as frames + arrows) · `04 Screens — Light` ·
`05 Screens — Dark` · `06 Prototype`.

### 6.2 Frame naming
`S01 Home / Light / Default`, `S01 Home / Dark / Default`, `S05 TransactionDetail
/ Light / Has-receipt`, etc. One frame per (screen, theme, state). Device frame
**360 × 800 dp** (or match the 1260×2800 px device ÷ 3.5 ≈ 360×800 dp).

### 6.3 Color + text styles
Create Figma color styles named exactly as the tokens (`primary`, `obsidian`,
`surfaceContainerLowest`, `approvedFg`…) in two **variable modes** Light/Dark
(use Figma Variables so one component flips). Text styles = the 11 typography
tokens (`headlineLg`, `bodyMd`, `labelSm`…) with Plus Jakarta Sans weights.

### 6.4 Components with variants
| Component | Variant properties |
|---|---|
| Button | kind = primary/secondary/whatsapp/text; state = default/pressed/disabled |
| Chip | type = period/filter/tag; selected = true/false |
| StateBadge | status = approved/pending/rejected/failed |
| StatTile | kind = income/expense |
| Card | elevation = flat/sheet |
| ListRow (txn) | state = approved/pending/rejected; hasIcon |
| BottomNavItem | tab = home/transactions/pending/accounts; selected; badge |
| Toggle/Switch | on/off/disabled |
| Snackbar | withUndo = true/false |
| InputField | state = untouched/focused/filled/invalid/disabled |

### 6.5 Auto Layout
Every screen = vertical Auto Layout, 16 dp horizontal padding, gaps from the
spacing scale (8/16/24). Cards = Auto Layout, 16 dp padding, radius 16–24. Stat
tiles = 2-col, fill-container, equal gap. Bottom nav = horizontal, space-between.

### 6.6 Prototype wiring (key flows)
| Source | Trigger | Destination | Animation |
|---|---|---|---|
| S01 Home greeting | tap | S00 Settings sheet | Move In ↑ (overlay, from bottom) |
| S01 Add Record pill | tap | S06 AddRecord | Push / Move In ← |
| S01 pending row / See All | tap | S05 Detail / S03 Pending | Smart Animate |
| S00 row (Budgets/People/…) | tap | S09/S12/… | Push ← |
| S00 Export CSV | tap | system save sheet (placeholder overlay) | Dissolve |
| S00 Theme chip | tap | (swap Light/Dark variant) | Smart Animate |
| S02 row | tap | S05 Detail | Push ← |
| S05 Edit / Split / Attach | tap | S08 / Split sheet / photo-picker overlay | Push / Move In ↑ |
| S04 reconcile action | tap | dialog / S06 AddRecord | Move In ↑ |
| App-lock overlay | unlock | underlying screen | Dissolve |

Overlays (Settings sheet, Split/Tag/meaning sheets, Snackbar, App-lock, receipt
viewer) = Figma **overlays** with `backdrop`/`scrim` dim, "Move in from bottom"
(sheets) or "Dissolve" (lock/viewer), close on outside-tap except App-lock.

### 6.7 Suggested build order
1. Variables (color modes) + text styles. 2. Components + variants. 3. S01 Home
(anchors most patterns). 4. Tabs S02–S04. 5. Settings sheet + its sub-screens.
6. Detail + forms. 7. Remaining screens. 8. Dark duplicates (swap variable mode).
9. Wire the prototype. 10. Flows page from `navigation_map.mmd`.

---

## 7. Gaps and assumptions
- **Screenshots:** 20 of 31 screens captured live (light, Private-mode masked —
  see 8.1). 11 not captured (flaky adb nav / no data to show the entry /
  first-launch gating). Dark-mode descoped per owner. Remaining screens are
  **code-derived**; verify against device before pixel-final. Screenshots are
  kept LOCAL only (gitignored) — the account pickers reveal real bank names that
  Private mode does not mask, so they must not be pushed to the remote.
- **States not reproduced:** loading, network/validation/server errors, and most
  empty states couldn't be forced on the live build — rebuild from code/UX logic
  and mark as assumptions in Figma.
- **Icon glyphs:** the icon font uses PUA codepoints; exact glyph→name mapping
  needs the font file (`assets/fonts`) inspected — listed as a TODO in Appendix.
- **Exact dp of individual elements:** component styles give padding/radius/type;
  per-element pixel boxes were read from one 1260×2800 device and should be
  treated as that device's layout (÷3.5 for dp).
- **Dark palette** is derived (not from DESIGN.md); contrast is unverified.
- Assumes RN default transition timings (~250–300 ms) where none are declared.

## 8. Appendix

### 8.1 Screenshot index (20 captured, all light, Private-mode masked, local-only)
| File | Screen | State |
|---|---|---|
| S00_settings-sheet_default_light.png | Settings sheet | default |
| S01_home_default_light.png | Home | default |
| S02_transactions_default_light.png | Transactions | default |
| S03_pending_default_light.png | Pending | default |
| S04_accounts_default_light.png | Accounts | default |
| S05_transaction-detail_default_light.png | TransactionDetail | default |
| S06_addrecord_untouched_light.png | AddRecord | untouched form |
| S07_activity_default_light.png | Activity | default |
| S08_edit-transaction_default_light.png | EditTransaction | default |
| S09_budgets_default_light.png | Budgets | default |
| S10_setbudget_untouched_light.png | SetBudget | untouched form |
| S11_insights_default_light.png | Insights | default |
| S12_people_default_light.png | People (IOUs) | default |
| S15_bills_default_light.png | Bills | default |
| S16_addbill_untouched_light.png | AddBill | untouched form |
| S18_categories_default_light.png | Categories | default |
| S20_hidden-accounts_empty_light.png | Hidden accounts | empty |
| S22_not-understood_empty_light.png | NotUnderstood | empty |
| S25_backup_default_light.png | Backup | default |
| S26_restore_default_light.png | Restore | default |

**Not captured (11)** — reasons: S14 Review, S23 SmsSuggestions, S24 AddAccount
(reachable but adb nav flaky — retry manually); S19 Uncategorised, S21 Upcoming,
S13 PersonIous, S17 EditBill (entry/card only appears with data not present —
need an uncategorised item / a recurring series / a person / a bill); S27
Onboarding, S28 ProfileSetup, S29 Permissions, S30 SyncStart (first-launch gated;
need a fresh install / cleared app, which would also trip the biometric App lock).
Dark-mode captures were descoped per owner request.

### 8.2 Asset list
- **Fonts:** Plus Jakarta Sans (ExtraBold/Bold/SemiBold/Medium/Regular) —
  `android/app/src/main/assets/fonts/` (or `assets/fonts/`). TODO: confirm path.
- **Icon font:** PUA glyph set (TODO: file + glyph map).
- **Images/logos:** app icon; R4c feedback screenshot is generated at runtime, no
  static asset. react-native-svg draws the donut (no image asset).
- **Native assets:** none beyond fonts/icon font.

### 8.3 Copy deck (observed, S01 Home — exact strings)
"Welcome" · "November 2026" · "TOTAL BALANCE" · "Verified & Approved" ·
"Add Record" · "Sync SMS" · "1M/3M/6M/9M/1Y" · "Records start {date} — earlier
months may be incomplete." · "N pending not included" · "INCOME" · "EXPENSES" ·
"This month" · "Pending Approval" · "N waiting" · "See All →" · "Detected from
SMS & UPI. Approve before recording."
(Full copy deck per screen = TODO once each screen is screenshot-verified.)

---
*Generated 2026-11-23 from the Tracker codebase (migration 16, R1–R12) + a
device capture with Private mode on. Pair with `design_tokens.json`,
`navigation_map.mmd`, and `screenshots/`.*
