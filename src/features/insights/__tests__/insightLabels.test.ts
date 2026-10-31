import {
  categoryBarA11yLabel,
  categoryBarDetail,
  formatDayMonthYear,
  formatMonthYear,
  merchantChipLabel,
  merchantFilterChipLabel,
  monthBarA11yLabel,
  monthBarLabel,
  monthDetailTitle,
  noSpendingLabel,
  otherCategoriesA11yName,
  partialDataNotice,
  PERIOD_CAPTION,
  periodChipA11yLabel,
  periodPhrase,
  pendingNotIncludedLabel,
  shareLabel,
  trendCaption,
  trendSpanLabel,
} from '../insightLabels';

describe('R4 insight labels', () => {
  it('period captions (Home tile captions) and phrases', () => {
    expect(PERIOD_CAPTION).toEqual({
      '1M': 'This month',
      '3M': 'Last 3 months',
      '6M': 'Last 6 months',
      '9M': 'Last 9 months',
      '1Y': 'Last 12 months',
    });
    expect(periodPhrase('1M')).toBe('this month');
    expect(periodPhrase('1Y')).toBe('last 12 months');
    expect(periodChipA11yLabel('3M')).toBe('3M, Last 3 months');
  });

  it('partial-data notice uses d MMM yyyy (local) and the pending hint is a count', () => {
    expect(formatDayMonthYear(new Date(2026, 9, 5, 18))).toBe('5 Oct 2026');
    expect(partialDataNotice(new Date(2026, 9, 5, 18).toISOString())).toBe(
      'Records start 5 Oct 2026 — earlier months may be incomplete.',
    );
    expect(pendingNotIncludedLabel(3)).toBe('3 pending not included');
    expect(formatMonthYear(new Date(2026, 9, 31))).toBe('October 2026');
  });

  it('shares, bar caption and a11y label', () => {
    expect(shareLabel(0.4)).toBe('40%');
    expect(shareLabel(0.004)).toBe('<1%');
    expect(shareLabel(0)).toBe('0%');
    expect(shareLabel(-1)).toBe('0%');
    expect(categoryBarDetail({ count: 1, share: 0.25 })).toBe('1 item · 25% of spend');
    expect(categoryBarDetail({ count: 3, share: 0.7083 })).toBe('3 items · 71% of spend');
    expect(categoryBarA11yLabel('QA Category', { spendMinor: 120000, count: 3, share: 0.4 })).toBe(
      'QA Category: ₹1,200, 3 items, 40% of spend',
    );
    expect(categoryBarA11yLabel('QA Category', { spendMinor: -30000, count: 1, share: 0 })).toBe(
      'QA Category: -₹300, 1 item, 0% of spend',
    );
    expect(otherCategoriesA11yName(1)).toBe('Other, 1 category');
    expect(otherCategoriesA11yName(4)).toBe('Other, 4 categories');
    expect(noSpendingLabel('3M')).toBe('No spending last 3 months.');
  });

  it('merchant chip: "N visits · ₹X <period>", singular, income, none', () => {
    expect(merchantChipLabel({ count: 1, spendMinor: 20000, incomeMinor: 0 }, 'spend', '1M')).toBe(
      '1 visit · ₹200 this month',
    );
    expect(merchantChipLabel({ count: 4, spendMinor: 22000, incomeMinor: 700 }, 'spend', '3M')).toBe(
      '4 visits · ₹220 last 3 months',
    );
    expect(merchantChipLabel({ count: 2, spendMinor: 0, incomeMinor: 50000 }, 'income', '1M')).toBe(
      '2 visits · ₹500 received this month',
    );
    expect(merchantChipLabel({ count: 0, spendMinor: 0, incomeMinor: 0 }, 'spend', '6M')).toBe(
      'No visits last 6 months',
    );
    expect(merchantFilterChipLabel('QA-Merchant-12')).toBe('Merchant: QA-Merchant-12 ✕');
    expect(merchantFilterChipLabel(null)).toBe('Merchant: selected ✕');
  });

  it('trend labels mark partial months', () => {
    const partial = { monthKey: '2026-10', incomeMinor: 100000, spendMinor: 30000, partial: true };
    const whole = { monthKey: '2026-09', incomeMinor: 0, spendMinor: 4000, partial: false };
    expect(monthBarLabel(partial)).toBe('Oct*');
    expect(monthBarLabel(whole)).toBe('Sep');
    expect(monthBarA11yLabel(partial)).toBe('October 2026, partial month: spent ₹300, income ₹1,000');
    expect(monthBarA11yLabel(whole)).toBe('September 2026: spent ₹40, income ₹0');
    expect(monthDetailTitle(partial)).toBe('October 2026 · partial');
    expect(trendSpanLabel([whole, partial])).toBe('Sep 2026 – Oct 2026');
    expect(trendSpanLabel([partial])).toBe('Oct 2026');
    expect(trendSpanLabel([])).toBe('');
    expect(trendCaption('1M')).toBe('This month and the 2 months before it, for context');
    expect(trendCaption('1Y')).toBe('Month by month, last 12 months');
  });
});
