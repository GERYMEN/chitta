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
  Onboarding: 'Onboarding',
  ProfileSetup: 'ProfileSetup',
  Permissions: 'Permissions',
} as const;

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
  AddRecord: undefined;
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
  Onboarding: undefined;
  ProfileSetup: undefined;
  Permissions: undefined;
};
