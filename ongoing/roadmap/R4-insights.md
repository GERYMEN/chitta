# R4 — Insights ("where did my money go"): report

Executor: Claude subagent. Date: 2026-10-31. Branch: `phase/R4-insights` (from `phase/R3b-refund-duplicate`). Nothing was committed or staged.

This dispatch was **code + tests + gates only**. There was no device work: no adb taps, dumps, installs or launches. The orchestrator then added B2–B4 (all of BUGS.md) to the same dispatch.

## Summary

- **Gates: all pass.**
  - tsc is clean.
  - eslint has 0 errors and 2 warnings, both already there (MainTabs, StatTile).
  - jest: 69 suites, 650 tests, all pass. Baseline was 53 suites and 544 tests, so +16 suites and +106 tests.
  - `assembleDebug` is OK.
- **Files: 66 source/test files** (33 modified, 33 new), plus `ongoing/roadmap/BUGS.md` and this report.
- **No migration and no new dependency.** Per the orchestrator decision, insights are pure, memoised TS over the in-memory rows. There is no SQL aggregate.
- **Bugs B1–B5 are all fixed in code + tests** (BUGS.md updated). The device check is still pending.

## Files

**New (33)**

- **Domain**
  - `src/domain/insights/insights.types.ts`
  - `src/domain/insights/insights.rules.ts`
- **Chart contract**
  - `src/components/charts/ChartBars.tsx`
- **Insights feature**
  - `src/features/insights/insightLabels.ts`
  - `src/features/insights/hooks/usePeriod.ts`
  - `src/features/insights/components/PeriodSelector.tsx`
  - `src/features/insights/components/PeriodNotices.tsx`
  - `src/features/insights/components/CategoryBars.tsx` (adapter: breakdown rows → ChartBars data)
  - `src/features/insights/components/WhereItWentCard.tsx`
  - `src/features/insights/components/MerchantHistoryChip.tsx`
  - `src/features/insights/screens/InsightsScreen.tsx`
- **B1**
  - `src/features/transactions/daySections.ts`
  - `src/shared/utils/clock.ts`
  - `src/shared/hooks/useNow.ts`
- **B2**
  - `src/shared/ui/HeaderBackButton/HeaderBackButton.tsx` and its `index.ts`
- **B3**
  - `src/shared/hooks/useOnFocusRegained.ts`
- **Tests (16)**
  - `insights.rules.test.ts`
  - `ChartBars.test.tsx`
  - `insightLabels.test.ts`
  - `PeriodSelector.test.tsx`
  - `InsightsScreen.test.tsx`
  - `HomeScreen.period.test.tsx`
  - `TransactionsScreen.period.test.tsx`
  - `TransactionDetail.merchantChip.test.tsx`
  - `daySections.test.ts`
  - `transactionsStore.period.test.ts`
  - `useNow.test.tsx`
  - `HeaderBackButton.test.tsx`
  - `noOwnBackArrow.test.js`
  - `audit.rules.eventType.test.ts`
  - `activityFeed.eventTime.test.ts`
  - `ActivityScreen.mask.test.tsx`

**Modified (33)**

- **Domain**
  - `period.rules.ts`: `PERIODS`, `DEFAULT_PERIOD`, `isWithinRange`.
  - `transaction.rules.ts`: new `incomeContributionMinor`; `incomeExpenseTotals` now sums the two per-row helpers. Its behaviour is unchanged.
  - `audit.types.ts` and `audit.rules.ts`: B4.
- **Data**
  - `transaction.repository.ts`: `setCategories` records the type.
  - `suggestion.repository.ts`: `detected` records the type.
- **State**
  - `transactionsStore.ts`:
    - `selectedPeriod` and `setSelectedPeriod`.
    - Reset now also resets the period.
    - B4 type metadata on every transaction audit write.
- **Filters**
  - `transactionFilters.ts`:
    - range + `merchantKey`/`merchantLabel`.
    - `canResetFilters`, `categoryFilterFor`, `merchantFilterFor`.
- **Screens**
  - `HomeScreen`, `TransactionsScreen`, `TransactionDetailScreen`, `TransactionDetailContent`, `ActivityScreen` + `activityFeed.ts`.
  - B2 headers: `AddRecord`, `EditTransaction`, `AddAccount`, `Uncategorised`, `Categories`, `Review`, `SmsSuggestions`.
- **Navigation**
  - `routes.ts` and `RootNavigator.tsx`: new `Insights` stack route.
  - `shared/ui/index.ts`.
- **Tests updated**
  - `period.rules`, `transaction.rules`, `transactionFilters` (rows got `occurredAt`; generic merchant names renamed to `QA-…`).
  - Audit metadata expectations in store audit/categories/transfers, `syncSms.audit`, `importSuggestion` and `pendingGroups`.

## Insights rules (`src/domain/insights/insights.rules.ts`)

**Rules shared by every aggregate**

- Only **approved** rows count.
- Transfers, transfer twins and hidden duplicates never count (`countsTowardIncomeExpense`).
- A linked refund is not income. It is negative spend in its (original's) category, dated by the **refund's** date.
- A row is in a period when `from ≤ occurredAt ≤ to`, both ends inclusive (`isWithinRange`).
- Each aggregate is **one O(n) loop**. Results are memoised in screens/hooks on `(transactions, range)`.

**Aggregates**

- **`periodTotals(rows, range)`**
  - INCOME / EXPENSES / NET of approved rows in the range.
  - It sums `incomeContributionMinor` + `spendContributionMinor`, the same per-row helpers `incomeExpenseTotals` now sums.
  - A test asserts it equals `incomeExpenseTotals(approvedInRange(...))`.
- **`spendByCategory(rows, range)`** → `[{categoryId, spendMinor, count, share}]`
  - `count` = expenses + linked refunds in that category.
  - `share` = spend / total positive spend. Total positive spend = the sum of the categories whose spend is > 0, so the positive shares add up to 1.
  - A category whose refunds exceed its spend keeps its negative number, with share 0.
  - Sorted by spend, highest first; ties by id. Uncategorised is included like any other category.
- **`topCategories(rows, 5)`** (Home card)
  - Top 5 categories plus one "Other" that sums the rest (spend, count, share by the same rule).
  - If only **one** category would be folded, it is shown as itself, so there are still at most 6 bars.
  - The bars always add up to the EXPENSES tile.
- **`monthlyTrend(rows, range)`** → `[{monthKey 'YYYY-MM', incomeMinor, spendMinor, partial}]`
  - One bucket per calendar month (local time) that intersects the range, including empty months.
  - A bucket only counts rows inside the range.
  - `partial` means the range does not cover the whole month: the running month (`to` = now), or a 1Y first month that starts mid-month. 1Y can therefore give 13 buckets with a partial first and last.
- **`trendRange(period, now)`**
  - **1M charts the current month plus the 2 previous months for context**, the same window as 3M.
  - Every other period charts its own range.
- **`merchantHistory(rows, merchantKey, range)`** → `{count, spendMinor, incomeMinor}`
  - Approved, counting rows with the same `normalizeMerchant` key.
  - `count` includes expenses, plain income and refunds.
  - `incomeMinor` was added beyond the spec so an income row's chip can show what came in.
- **`earliestApprovedAt(rows)`** = source of "Records start …": the earliest **approved row of any type**.
- **`startsBeforeRecords(range, earliest)`** compares **local days**: records that start later on the period's first day still cover it.
- **`pendingInRangeCount`** counts pending income/expense dated in the period.

## ChartBars interface (`src/components/charts/ChartBars.tsx`)

```ts
interface ChartBarsDatum { key: string; label: string; value: number; secondaryValue?: number; color: string }
interface ChartBarsProps {
  data: ReadonlyArray<ChartBarsDatum>;
  orientation: 'horizontal' | 'vertical';
  formatValue: (value: number) => string;
  onPressBar?: (datum: ChartBarsDatum) => void;     // set → every bar is a button
  accessibilityLabelFor: (datum: ChartBarsDatum) => string;
  formatDetail?: (datum: ChartBarsDatum) => string | null; // optional caption under a horizontal bar
  secondaryColor?: string;                           // paired bars; default theme primary
  testID?: string;                                   // bars get testID `chart-bar-<key>`
}
```

**Renderer**

- Plain Views + theme tokens, no dependency.
- Bars are relative to the largest value (primary or secondary). Values ≤ 0 draw no bar; the text and a11y label still show them.
- A tiny positive value stays visible (≥ 2% / 2dp).
- **Horizontal:** rows of at least 48dp with label, value, track, optional secondary track and optional detail.
- **Vertical:** paired bars per group, a scale label (`formatValue(max)`) and labels on a baseline.

**Contract**

- Screens draw bars only through `ChartBars`. `CategoryBars` is a thin data adapter that renders ChartBars.
- The three optional props (`formatDetail`, `secondaryColor`, `testID`) are additions beyond the spec's props. The datum shape is exactly as specified.

## UI

- **PeriodSelector** (Home, Transactions, Insights)
  - Chips 1M 3M 6M 9M 1Y. Each is a ≥48×48dp `Pressable` around the 36dp pill.
  - `accessibilityState.selected` (same pattern as the Transactions filter chips); label e.g. "3M, Last 3 months".
  - The value lives in the store: `selectedPeriod`, default 1M, session-only. It is not persisted, not a setting and not audited.
  - Under it, **PeriodNotices** shows:
    - "Records start <d MMM yyyy> — earlier months may be incomplete."
    - "N pending not included" (a count only).
- **Home**
  - Selector + notices sit above the tiles.
  - INCOME/EXPENSES use `periodTotals`, with caption "This month", "Last 3 months", "Last 6 months", "Last 9 months" or "Last 12 months".
  - Total balance stays all-time.
  - The "Where it went" card sits between Pending Approval and Recent Transactions, to keep the approval flow high on the screen:
    - Top 5 + Other: ₹ amount, "N items · P% of spend", and the R2 category colour (`getCategoryVisual` fg, fallback token; Other uses the outline token).
    - Empty state: "No spending this month."
    - "See all ›" (48dp) opens Insights.
    - A category bar opens Transactions filtered to that category. **Other** opens Insights.
- **Insights** (stack screen, not a tab)
  - Back, then selector + notices.
  - Totals card: INCOME / SPENT / NET.
  - "Where it went": every category; a bar opens Transactions filtered by category.
  - **Trends**:
    - Vertical paired bars: spend in the ink token, income in primary, with a legend.
    - Partial months are marked "Oct*", with a footnote and "partial month" in the a11y label.
    - Tapping a month shows "October 2026 · partial / Spent ₹X · Income ₹Y" (the latest month by default).
    - Span label "Aug 2026 – Oct 2026". 1M has the caption "This month and the 2 months before it, for context".
- **Transactions**
  - The R1 predicate takes the period range. The list, chip counts and INFLOW/SPENT/NET all follow it.
  - Subtitle: "N Settled · <period>" or "Showing X of N settled · <period>".
  - **Reset** shows when any filter is on or the period is not 1M, and resets both.
  - Merchant filter: a removable chip "Merchant: <name> ✕" at the start of the chip row. The search box is unchanged and separate.
- **Transaction detail (T5)**
  - Approved income/expense only (not pending, transfers, twins or hidden duplicates): a 48dp chip "N visits · ₹X <period>", e.g. "1 visit · ₹200 this month".
  - A plain income row shows "… ₹X received …". Zero rows gives "No visits this month".
  - Tap sets `merchantFilterFor(name)` (other filters cleared, period kept) and opens the Transactions tab.

## Call-site map: period + totals helpers

| What | Call site → helper |
|---|---|
| Home INCOME/EXPENSES | `HomeScreen` → `periodTotals(transactions, range)` |
| Home "Where it went" | `HomeScreen` → `topCategories(spendByCategory(transactions, range))` |
| Insights totals / categories / trends | `InsightsScreen` → `periodTotals`, `spendByCategory`, `monthlyTrend(trendRange(period, now))` |
| Transactions list, chip counts | `TransactionsScreen` → `filterTransactions` / `typeCounts(approved, filters, range)` → `matchesTransactionFilters` → `isWithinRange` |
| Transactions INFLOW/SPENT/NET | `totalsFor(filtered)` → `incomeExpenseTotals` |
| Transactions day "Net" chip | `buildDaySections(filtered, now)` → `incomeExpenseTotals` |
| Detail merchant chip | `TransactionDetailScreen` → `merchantHistory(transactions, key, range)` |
| Notices | `usePeriodNotices` → `earliestApprovedAt`, `pendingInRangeCount`; `PeriodNotices` → `startsBeforeRecords` |
| Range | `useSelectedPeriod()` → `periodRange(store.selectedPeriod, useNow(transactions))` (Home, Transactions, Insights, Detail) |
| Per-row rule under all of the above | `countsTowardIncomeExpense`, `incomeContributionMinor`, `spendContributionMinor` (`incomeExpenseTotals` = their sums) |

Unchanged from R3a: the Uncategorised count, rule-apply targets, Activity impact lines and `calculateBalance` (balances are never limited by period).

## B1 / B5 fix notes

- **B1**
  - The fixture `NOW` is gone.
  - `useNow(refreshKey)` reads `clock.now()` (the device clock) on mount, on screen focus, when the app returns to the foreground (a tab can stay focused overnight), and when the store's rows change.
  - Passing the rows matters: a row approved on screen can be newer than a stale now and would otherwise fall outside `to = now`.
  - That one value feeds `periodRange` **and** `buildDaySections` (TODAY/YESTERDAY), plus the row subtitles (`formatTransactionTimestamp(…, now)`).
  - Tests pin the clock with `jest.spyOn(clock, 'now')`.
  - Extra, same root cause: Home's hard-coded "October 2026" date line now uses `formatMonthYear(now)`.
- **B5**
  - The tiles used `incomeExpenseTotals(approved)` over all time. They now use `periodTotals(transactions, range)` for the selected period, captioned with the period label.
  - Tests cover 1M/3M/1Y amounts and captions, and that the balance is unchanged across periods.

## B2–B4 (added to this dispatch)

- **B2 — back target.** New shared `HeaderBackButton`:
  - 48×48dp `Pressable`, `accessibilityRole="button"`, `accessibilityLabel="Back"`.
  - Built from the New Accounts Found 48dp header button.
  - `HeaderSpacer` (48dp) keeps titles centred.
  - Used on all 10 stack headers: Add Record, Edit (both variants), Add Account, Transaction detail (both variants), Uncategorised, Categories, Activity, Review, New Accounts Found and Insights.
  - Header horizontal padding went from 16 to 4dp, so the arrow still sits about 17dp from the edge.
  - Tests: size + label + press, and `noOwnBackArrow.test.js` fails if any `.tsx` outside the component renders `arrow-left`.
- **B3 — Activity re-mask.**
  - Cause: the one `useFocusEffect` both reloaded data and called `setShowAmounts(false)`, so any re-run of that effect without a real blur re-masked.
  - Fix: the reload stays in the focus effect. The mask reset moved to `useOnFocusRegained` (`useIsFocused` + previous value), which fires only on an **unfocused → focused** transition.
  - Tests:
    - The pure transition function.
    - Screen test: revealed amounts survive a re-render, a store refresh and a repeated focus effect/reload; leave + return re-masks.
- **B4 — sentences at event time.**
  - **New events record the type at event time (enum only, never text or amounts):**
    - `created` / `approved` / `rejected` get new metadata kinds `{transactionType}`.
    - `detected` / `auto_approved` / `edited` get an optional `transactionType`.
    - An edit that changes type adds `fromType` / `toType` (e.g. Mark as transfer records expense → transfer) via `editedMetadata`.
    - Writers: store `addTransaction` / `addTransfer` / `approve` / `reject` / `updateTransaction`, R2 category re-file (`setCategories`) and the R2b import (`detected`).
    - The sanitizer whitelists only `'income' | 'expense' | 'transfer'`. A created/approved/rejected payload without a valid type is dropped (null).
  - **Older events:** `typesAtEventTime(events, currentType)` walks the feed newest → oldest per row and uses:
    - the type recorded on the event;
    - otherwise a later `edited` `fromType`;
    - the `transfer_paired` previous snapshot (both rows);
    - `transfer_unpaired` (the row was the transfer before the undo);
    - a pre-R4 type edit: Mark as transfer → **income if `accountId` also changed, else expense**, which is exactly what R3a's patch records. An income↔expense edit flips;
    - otherwise the current row, or the deleted snapshot.
  - `describeActivity` takes `typeAtEvent`. So:
    - the "added"/"approved" events of an expense later marked as a transfer read "You added …" and "Balance −₹…";
    - the edit itself reads "You moved …".
  - Only the type is reconstructed. Merchant and amount still come from the live row, because storing them would break the no-amounts metadata rule.
  - Tests: sanitizer, `editedMetadata`, the new and pre-R4 paths, pairing/unpairing, fallback, and the deleted snapshot.

## Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx eslint src --ext .ts,.tsx` | 0 errors, 2 pre-existing warnings |
| `npx jest` | 69 suites, 650 tests, all pass |
| `./gradlew assembleDebug` | BUILD SUCCESSFUL |

## Decisions I made

1. **Selected period lives in the store** (`selectedPeriod`, default 1M), separate from `transactionFilters`. The predicate gets the range as an argument. Reset clears both. Since the period is shared, Reset on Transactions also puts Home back to 1M.
2. **`now` is refreshed** on focus, on app foreground and on store-row changes, beyond the "on focus" in the spec, so a period's `to` can never exclude a row the user just approved.
3. **The partial-data notice compares by local day** against the earliest approved row of any type.
4. **The pending hint counts pending income/expense** in the period (not transfers).
5. **`spendByCategory.count`** = expenses + linked refunds. **share** = spend / sum of positive category spends.
6. **"Other" is only used when two or more categories would be folded.** It follows the category share rule. Tapping it opens Insights.
7. **Tapping a category bar or the merchant chip resets the other filters** and keeps the period, so SPENT / the list match what was tapped. The search box is never prefilled.
8. **1M Trends show 3 months** (`trendRange`). Partial months are marked with "*", including the running month.
9. **The merchant chip** shows for approved income/expense only. Income rows show "received". Zero visits gives "No visits <period>". `merchantHistory` also returns `incomeMinor`.
10. **"Where it went" sits after Pending Approval** on Home, so the approval flow stays near the top.
11. **ChartBars props:** `formatValue(value)` plus optional `formatDetail`, `secondaryColor` and `testID`. Vertical charts show a scale label instead of per-bar values, and tapping selects a month.
12. **`incomeContributionMinor` was added to `transaction.rules.ts`.** `incomeExpenseTotals` now sums the two per-row helpers; its behaviour is unchanged and tested. Every R4 aggregate uses the same helpers in one pass.
13. **Home date line** ("October 2026") now comes from the injected clock (same root cause as B1).
14. **B2:** one `HeaderBackButton` + `HeaderSpacer`. Header padding was reduced so the arrow position is about the same. The guard test is plain JS because the TS config has no Node types.
15. **B3:** the mask reset and the data reload are separate. The reload still runs on every focus.
16. **B4:** new metadata kinds for created/approved/rejected, optional types on the others, `fromType`/`toType` on any type-changing edit (not only Mark as transfer). Old events use the derivation chain above. Only the type is reconstructed.
17. **Test fixtures:** the existing filter-test rows were renamed to `QA-…` while adding `occurredAt`.

## Still needs the device pass (later, with R3b D1–D6 + F2)

- Period chips switch the Home tile captions/amounts and agree with Transactions. Reset puts Home back to 1M.
- QA-Merchant-12 200.00 (category A) + QA-Merchant-13 50.00 (category B), approved: "Where it went" deltas A +200 / B +50. Tapping A opens Transactions filtered to A with the QA row present.
- The merchant chip on QA-Merchant-12 shows "1 visit · ₹200 this month". Tap gives the "Merchant: QA-Merchant-12 ✕" chip; ✕ removes it.
- Insights opens from "See all ›". Trends render, with the running month marked "*". Notices appear when expected (counts only).
- **B1:** TODAY header for a QA row added today.
- **B2:** each header's Back taps reliably (48dp).
- **B3:** reveal amounts in Activity, wait or pull data, and they stay revealed. Open a row and come back: masked again.
- **B4:** on the device, for a QA expense marked as transfer, the "added" event reads "You added …".
- Logcat clean; release build installed at the end.
- Not yet seen on screen: chart visuals/layout at phone width, bar colours, 13-bar 1Y label fit, header spacing after the B2 padding change.
