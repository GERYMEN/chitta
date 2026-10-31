/**
 * R4 insights — plain result shapes of the pure aggregates in
 * insights.rules.ts. Money is integer paise everywhere.
 */

/** One category's spend in a period (spendByCategory). */
export interface CategorySpend {
  categoryId: string;
  /**
   * Expenses minus linked refunds dated in the period (R3b). Can be negative
   * when refunds dated in the period exceed the spend dated in it.
   */
  spendMinor: number;
  /** Rows that moved this category's spend: expenses + linked refunds. */
  count: number;
  /**
   * spendMinor / total positive spend (0..1). Total positive spend = the sum
   * of every category whose spend is above 0. A category at or below 0 keeps
   * its number but has share 0, so the positive shares add up to 1.
   */
  share: number;
}

/** A row of the Home "Where it went" card: a real category or "Other". */
export interface CategoryBreakdownRow {
  /** Stable key: the category id, or OTHER_BREAKDOWN_KEY. */
  key: string;
  /** null only for the "Other" row. */
  categoryId: string | null;
  spendMinor: number;
  count: number;
  share: number;
  /** How many categories this row stands for (1, or N for "Other"). */
  categoryCount: number;
}

/** One calendar month of the trend chart (monthlyTrend). */
export interface MonthBucket {
  /** 'YYYY-MM', local time. */
  monthKey: string;
  /** Income that counts (never transfers, twins, duplicates or linked refunds). */
  incomeMinor: number;
  /** Expenses minus linked refunds dated in this month (and in the range). */
  spendMinor: number;
  /**
   * The range covers only part of this month: the month is still in
   * progress (`to` = now) or the range starts after its 1st (1Y).
   */
  partial: boolean;
}

/** One merchant's approved, counting rows in a period (merchantHistory). */
export interface MerchantHistory {
  count: number;
  /** Expenses minus linked refunds at this merchant. */
  spendMinor: number;
  /** Plain income from this merchant (linked refunds excluded). */
  incomeMinor: number;
}
