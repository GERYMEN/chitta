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
  AccountPatch,
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
import { AuditEventDraft, AuditEventInput } from '../../../domain/audit/audit.types';
import {
  changedAccountFields,
  changedTransactionFields,
} from '../../../domain/audit/audit.rules';
import {
  DEFAULT_TRANSACTION_FILTERS,
  TransactionFilters,
} from '../filters/transactionFilters';

export interface ProfilePatch {
  userName?: string;
  approvalMode?: ApprovalMode;
  autoApproveThreshold?: number;
}

/**
 * Set by `syncSms` when its opt-in auto mode approves a fresh SMS item: the
 * audit row is then `auto_approved` by 'system' with the score + threshold.
 */
export interface AutoApproval {
  confidence: number;
  threshold: number;
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
  /** Transactions-list filters (R1); kept here so they survive tab switches. */
  transactionFilters: TransactionFilters;
  setTransactionFilters: (patch: Partial<TransactionFilters>) => void;
  resetTransactionFilters: () => void;
  approve: (id: string, auto?: AutoApproval) => Promise<void>;
  reject: (id: string) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  addTransaction: (input: CreateTransactionInput) => Promise<Transaction>;
  updateTransaction: (id: string, patch: TransactionPatch) => Promise<void>;
  addAccount: (input: CreateAccountInput) => Promise<void>;
  updateAccount: (id: string, patch: AccountPatch) => Promise<void>;
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
  transactionFilters: DEFAULT_TRANSACTION_FILTERS,

  setTransactionFilters: patch =>
    set(state => ({ transactionFilters: { ...state.transactionFilters, ...patch } })),

  resetTransactionFilters: () => set({ transactionFilters: DEFAULT_TRANSACTION_FILTERS }),

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
    const current = get();
    const next: Partial<Pick<TransactionsState, 'userName' | 'approvalMode' | 'autoApproveThreshold'>> = {};
    const entries: Array<readonly [string, string]> = [];
    const audit: AuditEventInput[] = [];

    if (patch.userName !== undefined) {
      // Saved but never audited — the name is not money-relevant.
      next.userName = patch.userName.trim();
      entries.push([SETTINGS_KEYS.userName, next.userName]);
    }
    if (patch.approvalMode !== undefined) {
      next.approvalMode = parseApprovalMode(patch.approvalMode);
      entries.push([SETTINGS_KEYS.approvalMode, next.approvalMode]);
      if (next.approvalMode !== current.approvalMode) {
        audit.push({
          eventType: 'settings_changed',
          actor: 'user',
          metadata: {
            kind: 'settings_changed',
            key: 'approval_mode',
            from: current.approvalMode,
            to: next.approvalMode,
          },
        });
      }
    }
    if (patch.autoApproveThreshold !== undefined) {
      next.autoApproveThreshold = clampThreshold(patch.autoApproveThreshold);
      entries.push([SETTINGS_KEYS.autoApproveThreshold, String(next.autoApproveThreshold)]);
      if (next.autoApproveThreshold !== current.autoApproveThreshold) {
        audit.push({
          eventType: 'settings_changed',
          actor: 'user',
          metadata: {
            kind: 'settings_changed',
            key: 'auto_approve_threshold',
            from: String(current.autoApproveThreshold),
            to: String(next.autoApproveThreshold),
          },
        });
      }
    }

    await settingsRepository.setMany(entries, audit);
    set(next);
  },

  refresh: async () => {
    const data = await loadAll();
    set(data);
  },

  approve: async (id, auto) => {
    const now = new Date().toISOString();
    const current = get().transactions.find(t => t.id === id);
    if (!current || !canTransition(current.status, 'approved')) return;

    // Home fast-approve, Pending and Detail all land here as 'approved';
    // only syncSms's opt-in auto mode passes `auto`.
    const audit: AuditEventDraft = auto
      ? {
          eventType: 'auto_approved',
          actor: 'system',
          metadata: {
            kind: 'auto_approved',
            confidence: auto.confidence,
            threshold: auto.threshold,
          },
        }
      : { eventType: 'approved', actor: 'user' };

    set(state => ({
      transactions: state.transactions.map(t =>
        t.id === id ? transitionLocal(t, 'approved', now) : t,
      ),
    }));

    await transactionRepository
      .update(id, { status: 'approved', approvedAt: now }, [audit])
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
      .update(id, { status: 'rejected' }, [{ eventType: 'rejected', actor: 'user' }])
      .catch(() => get().refresh());
  },

  deleteTransaction: async id => {
    const current =
      get().transactions.find(t => t.id === id) ?? (await transactionRepository.getById(id));
    if (!current) return;
    await transactionRepository.delete(
      id,
      [
        {
          eventType: 'deleted',
          actor: 'user',
          metadata: {
            kind: 'deleted',
            merchantName: current.merchantName,
            amountMinor: current.amountMinor,
            type: current.type,
            status: current.status,
          },
        },
      ],
      current.accountId,
    );
    await get().refresh();
  },

  addTransaction: async input => {
    // SMS rows are 'detected' by the system; Add Record rows are 'created' by the user.
    const audit: AuditEventDraft =
      input.sourceType === 'manual'
        ? { eventType: 'created', actor: 'user' }
        : {
            eventType: 'detected',
            actor: 'system',
            metadata: { kind: 'detected', confidence: input.confidenceScore },
          };
    const created = await transactionRepository.create(input, [audit]);
    set(state => ({ transactions: [created, ...state.transactions] }));
    return created;
  },

  updateTransaction: async (id, patch) => {
    const existing =
      get().transactions.find(t => t.id === id) ?? (await transactionRepository.getById(id));
    const fields = existing ? changedTransactionFields(existing, patch) : [];
    // A save that changes nothing is not a money change: no audit row.
    const audit: AuditEventDraft[] =
      fields.length > 0
        ? [{ eventType: 'edited', actor: 'user', metadata: { kind: 'edited', fields } }]
        : [];
    const updated = await transactionRepository.update(id, patch, audit);
    set(state => ({
      transactions: state.transactions.map(t => (t.id === id ? updated : t)),
    }));
  },

  addAccount: async input => {
    const created = await accountRepository.create(input, [
      { eventType: 'account_created', actor: 'user' },
    ]);
    set(state => ({ accounts: [...state.accounts, created] }));
  },

  updateAccount: async (id, patch) => {
    const existing =
      get().accounts.find(a => a.id === id) ?? (await accountRepository.getById(id));
    const fields = existing ? changedAccountFields(existing, patch) : [];
    const audit: AuditEventDraft[] =
      fields.length > 0
        ? [
            {
              eventType: 'account_updated',
              actor: 'user',
              metadata: { kind: 'account_updated', fields },
            },
          ]
        : [];
    const updated = await accountRepository.update(id, patch, audit);
    set(state => ({ accounts: state.accounts.map(a => (a.id === id ? updated : a)) }));
  },

  removeAccount: async id => {
    await accountRepository.softDelete(id, [{ eventType: 'account_removed', actor: 'user' }]);
    await get().refresh();
  },

  restoreAccount: async id => {
    await accountRepository.restore(id, [{ eventType: 'account_restored', actor: 'user' }]);
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
