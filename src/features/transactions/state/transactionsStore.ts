import { create } from 'zustand';
import { Transaction, TransactionStatus } from '../../../domain/transactions/transaction.types';
import { Account } from '../../../domain/accounts/account.types';
import { Category } from '../../../domain/categories/category.types';
import { canTransition } from '../../../domain/transactions/transaction.rules';
import { activeAccounts, deletedAccounts } from '../../../domain/accounts/account.rules';
import { runMigrations } from '../../../data/db/connection';
import {
  transactionRepository,
  CreateTransactionInput,
  TransactionPatch,
} from '../../../data/repositories/transaction.repository';
import {
  accountRepository,
  CreateAccountInput,
} from '../../../data/repositories/account.repository';
import { categoryRepository } from '../../../data/repositories/category.repository';
import { settingsRepository } from '../../../data/repositories/settings.repository';
import {
  ApprovalMode,
  clampThreshold,
  DEFAULT_APPROVAL_MODE,
  DEFAULT_AUTO_APPROVE_THRESHOLD,
  parseApprovalMode,
  parseThreshold,
  SETTINGS_KEYS,
} from '../../../domain/settings/approval.rules';

export interface ProfilePatch {
  userName?: string;
  approvalMode?: ApprovalMode;
  autoApproveThreshold?: number;
}

/**
 * Hydration/cache layer over the on-device SQLite repositories. Screens read
 * and write through this store only — no screen imports SQLite directly.
 */
interface TransactionsState {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  isHydrated: boolean;
  hasOnboarded: boolean;
  userName: string;
  approvalMode: ApprovalMode;
  autoApproveThreshold: number;
  hydrate: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  updateProfile: (patch: ProfilePatch) => Promise<void>;
  approve: (id: string) => Promise<void>;
  reject: (id: string) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  addTransaction: (input: CreateTransactionInput) => Promise<Transaction>;
  updateTransaction: (id: string, patch: TransactionPatch) => Promise<void>;
  addAccount: (input: CreateAccountInput) => Promise<void>;
  /** D10 soft delete — the account's transactions are never touched. */
  removeAccount: (id: string) => Promise<void>;
  restoreAccount: (id: string) => Promise<void>;
}

function transitionLocal(
  transaction: Transaction,
  to: TransactionStatus,
  now: string,
): Transaction {
  if (!canTransition(transaction.status, to)) return transaction;
  return {
    ...transaction,
    status: to,
    approvedAt: to === 'approved' ? now : transaction.approvedAt,
    updatedAt: now,
  };
}

async function loadAll() {
  const [transactions, accounts, categories] = await Promise.all([
    transactionRepository.listAll(),
    accountRepository.listAllAccounts(),
    categoryRepository.listAll(),
  ]);
  return { transactions, accounts, categories };
}

export const useTransactionsStore = create<TransactionsState>((set, get) => ({
  transactions: [],
  accounts: [],
  categories: [],
  isHydrated: false,
  hasOnboarded: false,
  userName: '',
  approvalMode: DEFAULT_APPROVAL_MODE,
  autoApproveThreshold: DEFAULT_AUTO_APPROVE_THRESHOLD,

  hydrate: async () => {
    await runMigrations();
    const [data, hasOnboardedValue, userNameValue, approvalModeValue, thresholdValue] =
      await Promise.all([
        loadAll(),
        settingsRepository.getValue('has_onboarded'),
        settingsRepository.getValue(SETTINGS_KEYS.userName),
        settingsRepository.getValue(SETTINGS_KEYS.approvalMode),
        settingsRepository.getValue(SETTINGS_KEYS.autoApproveThreshold),
      ]);
    set({
      ...data,
      hasOnboarded: hasOnboardedValue === 'true',
      userName: (userNameValue ?? '').trim(),
      approvalMode: parseApprovalMode(approvalModeValue),
      autoApproveThreshold: parseThreshold(thresholdValue),
      isHydrated: true,
    });
  },

  completeOnboarding: async () => {
    await settingsRepository.setValue('has_onboarded', 'true');
    set({ hasOnboarded: true });
  },

  updateProfile: async patch => {
    const next: Partial<Pick<TransactionsState, 'userName' | 'approvalMode' | 'autoApproveThreshold'>> = {};
    if (patch.userName !== undefined) {
      next.userName = patch.userName.trim();
      await settingsRepository.setValue(SETTINGS_KEYS.userName, next.userName);
    }
    if (patch.approvalMode !== undefined) {
      next.approvalMode = parseApprovalMode(patch.approvalMode);
      await settingsRepository.setValue(SETTINGS_KEYS.approvalMode, next.approvalMode);
    }
    if (patch.autoApproveThreshold !== undefined) {
      next.autoApproveThreshold = clampThreshold(patch.autoApproveThreshold);
      await settingsRepository.setValue(
        SETTINGS_KEYS.autoApproveThreshold,
        String(next.autoApproveThreshold),
      );
    }
    set(next);
  },

  refresh: async () => {
    const data = await loadAll();
    set(data);
  },

  approve: async id => {
    const now = new Date().toISOString();
    const current = get().transactions.find(t => t.id === id);
    if (!current || !canTransition(current.status, 'approved')) return;

    set(state => ({
      transactions: state.transactions.map(t =>
        t.id === id ? transitionLocal(t, 'approved', now) : t,
      ),
    }));

    await transactionRepository
      .update(id, { status: 'approved', approvedAt: now })
      .catch(() => get().refresh());
  },

  reject: async id => {
    const now = new Date().toISOString();
    const current = get().transactions.find(t => t.id === id);
    if (!current || !canTransition(current.status, 'rejected')) return;

    set(state => ({
      transactions: state.transactions.map(t =>
        t.id === id ? transitionLocal(t, 'rejected', now) : t,
      ),
    }));

    await transactionRepository
      .update(id, { status: 'rejected' })
      .catch(() => get().refresh());
  },

  deleteTransaction: async id => {
    await transactionRepository.delete(id);
    await get().refresh();
  },

  addTransaction: async input => {
    const created = await transactionRepository.create(input);
    set(state => ({ transactions: [created, ...state.transactions] }));
    return created;
  },

  updateTransaction: async (id, patch) => {
    const updated = await transactionRepository.update(id, patch);
    set(state => ({
      transactions: state.transactions.map(t => (t.id === id ? updated : t)),
    }));
  },

  addAccount: async input => {
    const created = await accountRepository.create(input);
    set(state => ({ accounts: [...state.accounts, created] }));
  },

  removeAccount: async id => {
    await accountRepository.softDelete(id);
    await get().refresh();
  },

  restoreAccount: async id => {
    await accountRepository.restore(id);
    await get().refresh();
  },
}));

/**
 * `accounts` holds ALL accounts (incl. soft-deleted, for transaction labels).
 * These selectors return new arrays — wrap call sites in `useShallow`.
 */
export const selectActiveAccounts = (state: Pick<TransactionsState, 'accounts'>) =>
  activeAccounts(state.accounts);

export const selectDeletedAccounts = (state: Pick<TransactionsState, 'accounts'>) =>
  deletedAccounts(state.accounts);

export const selectPending = (state: TransactionsState) =>
  state.transactions.filter(t => t.status === 'pending');

export const selectApproved = (state: TransactionsState) =>
  state.transactions.filter(t => t.status === 'approved');
