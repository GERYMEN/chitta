import type { NavigatorScreenParams } from '@react-navigation/native';
import type { AccountType } from '../../domain/accounts/account.types';

export const Routes = {
  Tabs: 'Tabs',
  Home: 'Home',
  Transactions: 'Transactions',
  Pending: 'Pending',
  Accounts: 'Accounts',
  TransactionDetail: 'TransactionDetail',
  AddRecord: 'AddRecord',
  EditTransaction: 'EditTransaction',
  AddAccount: 'AddAccount',
  SmsSuggestions: 'SmsSuggestions',
  Activity: 'Activity',
  Categories: 'Categories',
  Uncategorised: 'Uncategorised',
  Review: 'Review',
  Insights: 'Insights',
  Onboarding: 'Onboarding',
  ProfileSetup: 'ProfileSetup',
  Permissions: 'Permissions',
  SyncStart: 'SyncStart',
  Backup: 'Backup',
  Restore: 'Restore',
  NotUnderstood: 'NotUnderstood',
} as const;

/**
 * R5: "Add as transaction" from Messages not understood — the SMS reference
 * (id + date) plus the reader's best guess. Derived values only, in memory.
 */
export interface FromSmsPrefill {
  smsId: string;
  smsDate: number;
  type: 'expense' | 'income' | null;
  amountMinor: number | null;
  lastFour: string | null;
}

export type MainTabParamList = {
  Home: undefined;
  Transactions: undefined;
  /** R2b: `accountId` filters Pending to one account (from the Add/Link snackbar). */
  Pending: { accountId?: string; focusKey?: number } | undefined;
  Accounts: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<MainTabParamList> | undefined;
  TransactionDetail: { transactionId: string };
  AddRecord: { fromSms?: FromSmsPrefill } | undefined;
  EditTransaction: { transactionId: string };
  AddAccount:
    | {
        prefill?: { name: string; type: AccountType; lastFour: string | null };
        /** R2b: the New Accounts Found card this form came from (ids only). */
        suggestion?: { runId: string; key: string };
      }
    | undefined;
  /** R2b: only the in-memory suggestion session id — never SMS data. */
  SmsSuggestions: { runId: string };
  Activity: undefined;
  Categories: undefined;
  Uncategorised: undefined;
  /** R3b: possible transfers + possible duplicates (Home "N to review"). */
  Review: undefined;
  /** R4: Home "Where it went → See all" (stack screen — the 4-tab cap stays). */
  Insights: undefined;
  Onboarding: undefined;
  ProfileSetup: undefined;
  Permissions: undefined;
  /** R4b: onboarding "Where should SMS sync start?" */
  SyncStart: undefined;
  /** R4e: Settings → "Back up data" (password + SAF save). */
  Backup: undefined;
  /** R4e: Settings → "Restore from backup", or the onboarding link. */
  Restore: { fromOnboarding?: boolean } | undefined;
  /** R5: Pending header link / Settings row. */
  NotUnderstood: undefined;
};
