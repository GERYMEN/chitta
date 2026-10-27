export type TourStepId =
  | 'welcome'
  | 'dashboard'
  | 'detection'
  | 'approval'
  | 'history'
  | 'accounts';

export interface TourStep {
  id: TourStepId;
  headline: string;
  subtext: string;
  ctaLabel: string;
}

/**
 * Tour sequence (docs/PROJECT.md §5.6):
 * Welcome -> Dashboard -> Automatic Detection -> User Approval ->
 * Transaction History -> Accounts -> Permissions -> Home.
 * Permissions is its own screen (see PermissionsScreen); this list
 * covers the 6 illustrated tour slides that precede it.
 */
export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    headline: 'Your money, automatically tracked.',
    subtext:
      'Tracker catches your income and expenses from SMS & UPI notifications. You stay in control by approving every single entry before it’s saved.',
    ctaLabel: 'Get Started',
  },
  {
    id: 'dashboard',
    headline: 'See your financial picture at a glance.',
    subtext:
      'Your total balance, monthly income, expenses, pending approvals, and verified transactions are centralized here for instant clarity.',
    ctaLabel: 'Next Step',
  },
  {
    id: 'detection',
    headline: 'Detected automatically. Never recorded without you.',
    subtext:
      'SMS and UPI notifications are parsed on-device into candidate transactions. Detection only ever creates a pending item — it never touches your balance.',
    ctaLabel: 'Next Step',
  },
  {
    id: 'approval',
    headline: 'You decide what becomes a record.',
    subtext:
      'High-confidence detections can be approved in one tap. Anything uncertain opens a review sheet so you can edit or reject it first.',
    ctaLabel: 'Next Step',
  },
  {
    id: 'history',
    headline: 'Every approved transaction, organized.',
    subtext:
      'Search, filter, and group your verified transaction history by day — pending items never mix in until you’ve approved them.',
    ctaLabel: 'Next Step',
  },
  {
    id: 'accounts',
    headline: 'Track every account, calculated automatically.',
    subtext:
      'Balances are derived from opening balance plus approved income minus approved expenses — never edited directly.',
    ctaLabel: 'Continue',
  },
];
