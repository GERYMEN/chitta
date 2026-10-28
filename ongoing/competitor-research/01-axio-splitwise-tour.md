# 01 — Competitor tour: Axio + Splitwise (view-only)

Date: 2026-10-28. Device: owner's phone over USB. Mode: view-only. The only taps
were on tabs, menus, one list item, settings pages and Back, plus scrolling.
Screenshots are in the session scratchpad `competitor-shots/` (25 files, not in
the repo). This report covers **features, layout and UX only**. All personal
values are placeholders: "Friend A", "Group 1", "₹X", "Bank A", "••XXXX".

Tracker baseline, from docs/PROJECT.md, docs/DESIGN.md, ongoing/realtime-persistence/STATE.md and a quick look at `src/`:
- 4 tabs: Home / Transactions / Pending / Accounts.
- SMS sync with a parser, dedup and confidence scoring. Unmatched SMS become account suggestions.
- Pending approval queue, Home fast-approve, and an auto-approve toggle with a threshold.
- Manual add/edit/delete. Accounts support soft delete and restore. Balance is calculated, never stored.
- On-demand "View original SMS". Notes field.
- Monthly income and expense tiles.
- Transactions has a search box that matches merchant only. Its All/Expenses/Income chips are static: they show counts but do not filter.
- Categories are a fixed system list. **SMS sync files every expense under "Shopping" and every income under "Salary & Wages"** (`resolveCategoryIdForSms`).
- Audit types exist but nothing writes audit events. No budgets, charts, transfers, refunds, tags, splits, export, app lock or dark theme.

---

## 1. Screen inventory

### Axio (15 screens)

| # | Screenshot | Screen | What it shows / key features / notable UX |
|---|---|---|---|
| 1 | axio-01-home.png | Home (top) | Greeting with avatar (opens Profile). A full-width **personal-loan promo hero** takes the top third. Below it, a "Money Manager › <Month>" card shows this month's spends (₹X), last month's income (₹X), and a horizontal carousel of recent transactions: category icon, merchant, ₹X, ↗/↙ direction arrow, time • date. A Pay Later credit card starts below. Bottom nav has 4 **icon-only** tabs with no labels. A floating edge widget sits on the left. |
| 2 | axio-02-home-scrolled.png | Home (mid) | Pay Later limit card (Available ₹X / Total ₹X). "Deposits" fixed-deposit promo. **Accounts carousel**: per account, the bank logo, masked number (••XXXX), this month's spend from that account with ↗, last-updated time, an **SMS-reported available balance** and a refresh icon. |
| 3 | axio-03-home-scrolled2.png | Home (lower) | "Splits" card in its empty state ("Create group & split expenses…") with + and › actions. A third-party BNPL "check balance" ad card. |
| 4 | axio-04-home-bottom.png | Home (bottom) | The feed ends in another sponsored banner (device financing). About half of Home's vertical space is ads or cross-sell. |
| 5 | axio-05-money-manager.png | Money Manager tab (top) | Search icon. "Spent in <Month>" with a big ₹X inside a **ring**: an empty budget-progress ring because no budget is set. Previous-month income, and a **"Set monthly budget"** CTA. Pill buttons for **Trends** and **Categories**. A dismissible investment promo. A dismissible "needs permissions → Check now" warning. "Recent transactions" with an **Add** pill. |
| 6 | axio-06-mm-transactions.png | Money Manager (list) | Recent transactions. Each row has a category icon, merchant, an auto **tag chip (e.g. "#Online")**, ₹X with a direction arrow, and the date. "›" opens the full list. **Dues & Reminders** carousel: auto-detected recurring payments to people, each card showing "Repeats Yearly", next date, payee (Friend A), ₹X and an inline "Set reminder? No / Yes". |
| 7 | axio-07-mm-categories.png | Money Manager (categories) | **Categories grid**, 2 columns and horizontally scrollable. Each tile has the category icon, name, "N spends" and ₹X, plus an inline **"Set budget ›"**. An **"Unknown" bucket** (the biggest by count) shows **"Categorise ›"** instead. The Accounts carousel and Deposits promo repeat below. |
| 8 | axio-08-txn-detail.png | Transaction detail (the one list item opened) | "Debit transaction" header with an overflow menu. A hero card with the merchant name (underlined link), a **"N visits" chip** with a chart icon (merchant history), a big ₹X, a category pill (tap to change), date/time and a category-themed photo background. Account row: bank logo, masked number, and an **"Expense" switch** (counts toward spend or not). Notes ("Tap to add"). Two tiles: **Split** with friends, **Attach** receipt/warranty photo. Tags with +. |
| 9 | axio-09-txn-detail-scrolled.png | Transaction detail (bottom) | "Other info": the UPI reference number and the **full raw SMS text shown inline by default** (including the account balance). |
| 10 | axio-10-txn-overflow-menu.png | Detail overflow sheet | Bottom sheet "Menu options": **Link refund**, **Link duplicate**, then a divider and a red **Delete transaction**. Closed with Back; nothing was selected. |
| 11 | axio-11-splits-tab.png | Splits tab | Two summary tiles: **You get ₹X ↙ / You pay ₹X ↗**. "No groups" empty state. + and search in the header. |
| 12 | axio-12-credit-tab.png | Credit tab | Top tabs: Pay Later / Personal Loan / partner BNPL. Limit hero. "Purchases": EMI plans with merchant, ₹X/month, a progress bar and a "FULLY PAID" status. |
| 13 | axio-13-profile-menu.png | Profile / Account (settings menu) | Name, verified phone, "Add Email ID". Pay Later section (Bills & Dues, FAQ). **Expense tracking**: Preferences, **Weekly summary**, **Export statement**, **Report undetected SMS**, Help & FAQ. |
| 14 | axio-14-profile-menu-scrolled.png | Profile (bottom) | Deposits FAQ. General: Theme, Rate us, Invite friends, Blog, Chat with us, Logout, About/version. |
| 15 | axio-15-preferences.png | Preferences (one level deep) | "Launch in Money Manager" switch (pick the default start screen). Manage accounts. **Link accounts ("fix duplicate or redundant accounts and cards")**. Manage reminders. **Spend categories / Credit categories (create/delete)**. **Tags (create/delete)**. **"Mark as transfer amount" (a ₹X threshold)**. Notifications & Reminders. **Backup**. **Security**. **Rescan SMS inbox**. |

### Splitwise (10 screens)

| # | Screenshot | Screen | What it shows / key features / notable UX |
|---|---|---|---|
| 1 | splitwise-01-launch.png | Groups tab | Header with search and add-group. **"Overall, you are owed ₹X"** with a filter icon. Group cards show cover art, net per group ("you are owed ₹X" in green, "you owe" in orange), the **top 2 per-person lines plus "Plus N other balances"**, and a "Non-group expenses" pseudo-group. **"Hiding groups that have been settled up over one month" + "Show N settled-up groups"**. Extended FAB "Add expense". **Labelled** bottom nav: Groups / Friends / Activity / Account (avatar). |
| 2 | splitwise-02-group-detail.png | Group detail (the one list item opened) | Cover header with back and a settings gear. Group name and an "N people" chip. A **collapsible "You are owed ₹X overall"** with a per-person breakdown. Action chips: **Settle up** (primary), "Convert to USD" (Pro, gem icon), "Charts" (Pro). A **month-grouped timeline** mixing payments ("Friend A paid Friend B ₹X") and settle-ups (scale icon). |
| 3 | splitwise-03-group-expenses.png | Group detail (scrolled) | Expense rows: date column (Mon / DD), category thumbnail, title, "You paid ₹X" / "Friend A paid ₹X". The right column gives **your net effect**: "you lent ₹X" (green), "you borrowed ₹X" (orange), or "You are not involved" (grey). Sticky month headers. |
| 4 | splitwise-04-group-settings.png | Group settings (settings screen, one level deep) | Group name with an edit pencil. Add people, invite via link. Member list with avatar, name, **email address**, and "gets back ₹X" / "owes ₹X". |
| 5 | splitwise-05-group-settings-bottom.png | Group settings (bottom) | Advanced: **"Simplify group debts"** switch with a plain-language explanation and "Learn more". "Default split" (Pro). **"Leave group" disabled, with an inline reason** (outstanding debts). Red "Delete group" at the very end. |
| 6 | splitwise-06-friends.png | Friends tab | Overall summary. "Showing friends with outstanding balances" (settled friends hidden by default). Rows: avatar, name, "owes you" / "you owe" with ₹X in colour. A friend with balances in several groups gets an **indented tree breakdown per group**. |
| 7 | splitwise-07-activity.png | Activity tab | "Recent activity" feed. Each item has an action icon with the actor's avatar badge, a sentence ("You added '<Expense>'", "Friend A updated '<Expense>'", "You recorded a payment from Friend B"), a coloured **impact line** ("You get back INR X", "You owe INR X", "You received INR X") and a timestamp. Searchable. |
| 8 | splitwise-08-account.png | Account tab | Profile (photo, name, email, Edit). Large **Pro upsell card**. Scan code. Preferences: Email settings, Device & push notification settings, Security, Appearance. |
| 9 | splitwise-09-account-scrolled.png | Account tab (bottom) | Help Center, Contact support, Rate. Log out. Footer with privacy policy and version, and a playful illustration. |
| 10 | splitwise-10-groups-filter-menu.png | Groups filter menu | Popup radio list: **All groups / Outstanding balances / Groups you owe / Groups that owe you**. Closed with Back; nothing was selected. |

---

## 2. Feature comparison matrix

| Feature | Axio | Splitwise | Tracker today |
|---|---|---|---|
| Auto-detect transactions from SMS | yes | no | yes |
| Pending queue: user approves before recording | no (records automatically) | no | **yes** |
| Auto-approve threshold | no (everything automatic) | no | **yes** |
| Manual add | yes | yes | yes |
| Rescan / re-sync SMS inbox | yes | no | yes (Sync SMS + dedup) |
| Report a missed (undetected) SMS | yes | no | no |
| Original SMS view | yes (full raw text, always shown inline) | no | yes (on demand, not stored) |
| Accounts with balances | yes (balance as reported by SMS) | no | yes (calculated) |
| SMS balance vs tracked balance check | partial (shows SMS balance only) | no | no |
| Merge duplicate / redundant accounts | yes (Link accounts) | no | partial (duplicate-account block, suggestions) |
| Account remove / restore | not seen | no | yes (soft delete) |
| Category auto-assignment | yes (with "Unknown" bucket) | partial (icon by title) | partial (fixed default per type) |
| Create / delete custom categories | yes | no | no |
| Tags | yes (auto "#Online" + custom) | no | no |
| Notes | yes | not seen | yes |
| Receipt photo attach | yes | not seen | no |
| Monthly spend / income summary | yes | no | yes |
| Spending by category breakdown | yes | partial (Charts, Pro) | no |
| Trends over time | yes | partial (Pro) | no |
| Monthly / category budgets | yes | no | no |
| Recurring dues + reminders | yes | not seen | no |
| Link refund to original debit | yes | no | no |
| Link / merge duplicate transaction | yes | no | partial (SMS dedup at sync only) |
| Mark self-transfer (excluded from spend) | yes (threshold + Expense switch) | no | no |
| Search | yes | yes | partial (merchant only) |
| Filters | not seen | yes (radio filter) | partial (chips don't filter) |
| Merchant history ("N visits") | yes | no | no |
| Split an expense / IOUs | yes (groups, empty here) | yes (core) | no |
| You get / you owe summary | yes | yes | no |
| Settle up / simplify debts | no | yes | no |
| Activity / audit feed | no | yes | partial (types exist, no writer, no UI) |
| Weekly summary | yes | no | no |
| Export statement | yes | not seen | no |
| Backup | yes | n/a (cloud account) | no |
| App lock / security | yes | yes | no |
| Theme / dark mode | yes | yes | no |
| Hide settled / stale items | no | yes | partial (deleted accounts collapsed) |

---

## 3. Suggestions for Tracker's next phase

PROJECT.md caps bottom navigation at 4 tabs, so none of these add a tab. New
surfaces go inside Home, Transactions or Accounts, or behind a header icon or sheet.

### P0

**P0-1. Merchant → category memory, plus an "Uncategorised" nudge**
- **What:** When the user changes the category on a pending or approved item, offer "Always use <Category> for <merchant>". Store it in a local `merchant_rules` table and apply it in `syncSms` before the current default. Show uncategorised or defaulted items as a bucket with a "Categorise ›" action.
- **Why:** Inspired by Axio's "Unknown — N spends — Categorise ›" tile. Today every SMS expense lands in "Shopping", so any category view would be wrong. This is the precondition for P0-3 and P1-1.
- **Effort:** M.
- **Fit:** Fully offline. Rules are keyed on the parsed merchant string, never on raw SMS. It also strengthens the approve flow, because the user corrects once and the next items arrive right.
- **Depends on:** the categories repo (exists) and a new migration.

**P0-2. Self-transfers, refunds and duplicates (correct balances)**
- **What:** Add a third transaction kind, `transfer`, between two own accounts. It moves balances but is excluded from income and expense. Add "Link refund" (a credit offsets a prior debit and nets out of spend) and "Mark as duplicate" (reject one of two near-identical items, with an audit note). Suggest a transfer automatically when a debit on one own account and a credit of the same ₹X on another arrive close together.
- **Why:** Axio has Link refund, Link duplicate, "Mark as transfer amount" and the "Expense" switch. Without these, moving money between your own accounts inflates both income and expense, and Home's totals are wrong. PROJECT.md §24 already names refund, reversal and duplicate rules.
- **Effort:** L.
- **Fit:** Offline. The detection-then-approval model fits well: suggest a link, the user approves it.
- **Depends on:** changing the `TransactionType` union; `calculateBalance` and the Home and Transactions totals; a migration.

**P0-3. Category breakdown for the month**
- **What:** A "Where it went" card on Home, or a Transactions header, with ₹X per category and a count, for the selected period. Tapping a category gives a filtered list.
- **Why:** Axio's Categories grid and Trends/Categories pills. It is the single most useful insight after "how much did I spend". The `period.rules` 1M–1Y ranges already exist.
- **Effort:** M.
- **Fit:** Pure local query over approved rows. Pending items are never counted.
- **Depends on:** P0-1, or the numbers mislead.

**P0-4. Make the Transactions filters real**
- **What:** Make the All/Expenses/Income chips actually filter. Add account and category filter chips. Search notes as well, as the placeholder already promises.
- **Why:** Splitwise's radio filter menu and Axio's search. The chips that show counts but do nothing are a credibility bug.
- **Effort:** S.
- **Fit:** Local.
- **Depends on:** none.

### P1

**P1-1. Monthly budget, overall and per category**
- **What:** Fill a progress ring on the Home spend tile against the budget. "Set budget ›" on each category, with an amber warning at 80% and red over budget.
- **Why:** Axio's budget ring and per-category "Set budget".
- **Effort:** M.
- **Fit:** Local `app_settings` and budget rows. Fits the DESIGN.md amber/red state tokens.
- **Depends on:** P0-1 and P0-3.

**P1-2. "Missed a transaction?" from the SMS inbox**
- **What:** A screen that lists recent financial-looking SMS the parser rejected, showing only sender and date until tapped. The user picks one, which pre-fills Add Record as a pending item. Optionally store a local "parser miss" counter to improve rules. **Nothing is uploaded.**
- **Why:** Axio's "Report undetected SMS" and "Rescan SMS inbox". Closes the gap when the regex parser misses a format.
- **Effort:** M.
- **Fit:** Uses the existing native `SmsReader`. Message text is held in memory only, like `OriginalSmsView`.
- **Depends on:** the SmsReader list API.

**P1-3. Activity / audit timeline**
- **What:** Write `audit_events` (detected, auto-approved at N%, approved, edited, rejected, deleted, restored), then show a readable feed: "Auto-approved <merchant> ₹X (90% match)". Reach it from the Home settings sheet or a header icon.
- **Why:** Splitwise's Activity tab, with sentence plus coloured impact line. STATE phase 13 noted auto-approvals are unaudited. A feed makes auto-approve trustworthy and reversible.
- **Effort:** M.
- **Fit:** Core to "Detect → Approve → Record". Local only.
- **Depends on:** an audit writer in the store's approve, edit and delete paths.

**P1-4. Bank-reported vs tracked balance**
- **What:** When an SMS carries "Avl bal", store only that number and its timestamp on the matched account. On Accounts, show "Bank SMS: ₹X as of <time>" next to the calculated balance, with a "Difference ₹X" hint.
- **Why:** Axio's account cards show the SMS balance and last-updated time. Tracker never edits balance directly, so this is a reconciliation signal, not an override.
- **Effort:** M.
- **Fit:** Stores a parsed number, never the SMS text. Respects the calculated-balance rule.
- **Depends on:** a parser extension and an account column.

**P1-5. Recurring payment detection + local reminders**
- **What:** Detect the same payee and similar ₹X repeating monthly or yearly. Show it on Home as a "Upcoming: <payee> ₹X on <date>" card with "Remind me?". Schedule local notifications.
- **Why:** Axio's Dues & Reminders "Repeats Yearly" cards.
- **Effort:** L.
- **Fit:** Offline. Needs a notifications permission, which is a new permission and should be asked for in context, not at onboarding.
- **Depends on:** P0-1 merchant normalisation; a local notification lib.

**P1-6. App lock**
- **What:** Biometric or device-credential lock on open and resume. Hide amounts in the recents-screen thumbnail (FLAG_SECURE option).
- **Why:** Both apps have Security. Tracker holds full financial history on device.
- **Effort:** S–M.
- **Fit:** Strong privacy fit.
- **Depends on:** a native biometric module.

### P2

**P2-1. Personal IOUs, a lightweight split**
- **What:** On an approved expense, "Split" marks a share owed by Friend A, entered as free text with no contacts permission. A "You get ₹X / You owe ₹X" tile on Home. Rows say "you lent ₹X" / "you borrowed ₹X" in Splitwise's language. Settled IOUs hide after 30 days.
- **Why:** Axio's Split tile and Splitwise's core model. Explicitly a **personal ledger, not multi-user sync**.
- **Effort:** L.
- **Fit:** Offline-only is fine for a personal IOU list. No server.
- **Depends on:** a new table; P0-2 so a repayment credit can be linked.

**P2-2. Tags + receipt photo**
- **What:** Free-form tags, with an auto "#UPI"/"#Card" from the payment method. Attach a receipt photo stored in the app sandbox.
- **Why:** Axio's Tags and Attach tiles.
- **Effort:** M.
- **Fit:** Local files. Exclude them from any future export by default.
- **Depends on:** a file-picker or camera permission, requested only when used.

**P2-3. Weekly summary notification**
- **What:** A local notification, "This week: spent ₹X, N items pending".
- **Why:** Axio's Weekly summary. The pending count nudges the approval habit.
- **Effort:** S–M.
- **Fit:** Local.
- **Depends on:** P1-5's notification infrastructure.

**P2-4. Export CSV and local backup/restore**
- **What:** A user-initiated CSV of approved transactions through the share sheet. Backup to an encrypted file the user saves; restore from file.
- **Why:** Axio's Export statement and Backup. Protects against the kind of data loss that `adb uninstall` caused during QA.
- **Effort:** M (export) / L (backup).
- **Fit:** Must be explicit and user-triggered. Never include original SMS.
- **Depends on:** none.

**P2-5. Merchant history chip**
- **What:** "N visits · ₹X this month" on the detail screen, opening a list filtered to that merchant.
- **Why:** Axio's "N visits" chip.
- **Effort:** S.
- **Fit:** Local.
- **Depends on:** P0-4 filters.

**P2-6. Dark theme**
- **What:** Implement the dark-mode inversions DESIGN.md already describes.
- **Why:** Both apps offer a theme setting.
- **Effort:** M.
- **Fit:** Theme tokens already exist.
- **Depends on:** none.

---

## 4. Things NOT to copy

- **Ad- and lending-heavy home (Axio).** A loan hero, FD promos, partner BNPL and device-financing banners take about half of Home and push real data below the fold. Tracker's charter excludes lending and investment. Keep Home data-first.
- **Full raw SMS shown inline by default (Axio).** It exposes balance and reference numbers on every detail view. Tracker's on-demand, not-stored original-SMS view is the better pattern. Keep it.
- **Icon-only bottom navigation (Axio).** Four unlabeled glyphs are ambiguous. Splitwise's labeled tabs read instantly.
- **Paywalled chips inside core flows (Splitwise).** "Convert to USD", "Charts" and "Default split PRO" sit next to Settle up, along with a large upsell card on Account.
- **Persistent permission nag cards (Axio).** "Needs certain permissions → Check now" sits in the main feed. Ask in context when a feature needs a permission.
- **Showing every member's email address in group settings (Splitwise).** Unnecessary personal data on screen. Show names only.
- **An unexplained bare switch on the detail screen (Axio "Expense" toggle).** It silently changes totals. Use an explicit "Mark as transfer" action that is audited.

Good patterns worth keeping: Splitwise's disabled "Leave group" with an inline reason, auto-hiding settled items, and the plain-language "you lent / you borrowed" net-effect column.
