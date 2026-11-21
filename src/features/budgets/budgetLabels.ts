import { colors } from '../../theme';
import { transactionStateColors } from '../../theme/colors';
import { BudgetState } from '../../domain/budgets/budget.rules';
import { formatRupeesFromMinor } from '../../shared/utils/currency';

/**
 * R5c (D-c): budget state → theme colour tokens (green / amber / red). Every
 * value is an existing design-system token — never a hardcoded hex. `track` is
 * the empty part of the progress bar; `fill` the used part; `bg` a soft tint
 * for chips / the card.
 */
export const BUDGET_STATE_COLORS: Record<BudgetState, { fill: string; track: string; bg: string; fg: string }> = {
  under: {
    fill: colors.primary,
    track: transactionStateColors.approved.bg,
    bg: transactionStateColors.approved.bg,
    fg: transactionStateColors.approved.fg,
  },
  near: {
    fill: transactionStateColors.pending.fg,
    track: transactionStateColors.pending.bg,
    bg: transactionStateColors.pending.bg,
    fg: transactionStateColors.pending.fg,
  },
  over: {
    fill: transactionStateColors.failed.fg,
    track: transactionStateColors.failed.bg,
    bg: transactionStateColors.failed.bg,
    fg: transactionStateColors.failed.fg,
  },
};

export const BUDGET_STATE_LABEL: Record<BudgetState, string> = {
  under: 'On track',
  near: 'Near limit',
  over: 'Over budget',
};

/** "₹X of ₹Y" (both via the redaction-aware formatter). */
export function spentOfLabel(actualMinor: number, budgetMinor: number): string {
  return `${formatRupeesFromMinor(actualMinor)} of ${formatRupeesFromMinor(budgetMinor)}`;
}

/** "₹Z left" when under/at the cap, "₹Z over" when past it. */
export function leftOrOverLabel(remainingMinor: number, overMinor: number): string {
  return overMinor > 0
    ? `${formatRupeesFromMinor(overMinor)} over`
    : `${formatRupeesFromMinor(remainingMinor)} left`;
}
