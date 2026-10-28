import type { NavigatorScreenParams } from '@react-navigation/native';
import type { AccountType } from '../../domain/accounts/account.types';
import type { SmsAccountSuggestion } from '../../features/sms-sync/smsSyncLogic';

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
  Onboarding: 'Onboarding',
  ProfileSetup: 'ProfileSetup',
  Permissions: 'Permissions',
} as const;

export type MainTabParamList = {
  Home: undefined;
  Transactions: undefined;
  Pending: undefined;
  Accounts: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<MainTabParamList> | undefined;
  TransactionDetail: { transactionId: string };
  AddRecord: undefined;
  EditTransaction: { transactionId: string };
  AddAccount:
    | { prefill?: { name: string; type: AccountType; lastFour: string | null } }
    | undefined;
  SmsSuggestions: { suggestions: SmsAccountSuggestion[] };
  Activity: undefined;
  Onboarding: undefined;
  ProfileSetup: undefined;
  Permissions: undefined;
};
