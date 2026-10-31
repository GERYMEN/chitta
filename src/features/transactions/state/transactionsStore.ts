import { create } from 'zustand';
import { Transaction, TransactionStatus } from '../../../domain/transactions/transaction.types';
import { Account } from '../../../domain/accounts/account.types';
import { Category, MerchantRule } from '../../../domain/categories/category.types';
import {
  CategoryChange,
  invertChanges,
  ruleApplyTargets,
} from '../../../domain/categories/category.rules';
import { normalizeMerchant } from '../../../domain/merchants/normalizeMerchant';
import { canTransition } from '../../../domain/transactions/transaction.rules';
import {
  confirmTransferPair as buildPairConfirmation,
  findTransferTwin,
  MANUAL_TRANSFER_TITLE,
  markAsTransferPatch,
  TransferDismissal,
  undoTransferPair,
} from '../../../domain/transfers/transfer.rules';
import { TRANSFER_CATEGORY_ID } from '../../../domain/categories/category.rules';
import { transferRepository } from '../../../data/repositories/transfer.repository';
import { linkRepository } from '../../../data/repositories/link.repository';
import {
  linkRefundPatch,
  RefundLinkError,
  refundsFor,
  unlinkRefundPatch,
  validateRefundLink,
} from '../../../domain/refunds/refund.rules';
import {
  DuplicateDismissal,
  markDuplicate as buildDuplicateMarking,
  restoreDuplicate as buildDuplicateRestore,
} from '../../../domain/duplicates/duplicate.rules';
import { isLinkedRefund } from '../../../domain/transactions/transaction.rules';
import { linkedEditError } from '../../../domain/links/linkedEdit.rules';
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
import {
  categoryRepository,
  CategoryPatch,
  CreateCategoryInput,
} from '../../../data/repositories/category.repository';
import { merchantRuleRepository } from '../../../data/repositories/merchantRule.repository';
import {
  ImportSuggestionInput,
  ImportSuggestionResult,
  suggestionRepository,
} from '../../../data/repositories/suggestion.repository';
import type { AccountKey } from '../../sms-sync/normalizeAccountKey';
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
import {
  AuditActor,
  AuditEventDraft,
  AuditEventInput,
} from '../../../domain/audit/audit.types';
import {
  changedAccountFields,
  changedTransactionFields,
} from '../../../domain/audit/audit.rules';
import {
  DEFAULT_TRANSACTION_FILTERS,
  TransactionFilters,
} from '../filters/transactionFilters';

/** R3a: Add Record → Transfer / Edit transfer form values (paise, ISO date). */
export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  amountMinor: number;
  occurredAt: string;
  note: string | null;
}

export interface ProfilePatch {
  userName?: string;
  approvalMode?: ApprovalMode;
  autoApproveThreshold?: number;
}

/**
 * Set by `syncSms` when its opt-in auto mode approves a fresh SMS item: the
 * audit row is then `auto_approved` by 'system' with the score + threshold.
 * R2b: the Pending "Auto-approve (N)" button passes actor 'user' (the user
 * tapped it; the rule picked the items).
 */
export interface AutoApproval {
  confidence: number;
  threshold: number;
  /** Default 'system'. */
  actor?: AuditActor;
}

/**
 * Hydration/cache layer over the on-device SQLite repositories. Screens read
 * and write through this store only — no screen imports SQLite directly.
 */
interface TransactionsState {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  /** R2: normalized merchant key → category id ("Always use …"). */
  merchantRules: Record<string, string>;
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
  /** R3b.1: false (no write) when the edit breaks a link (see linkedEditError). */
  updateTransaction: (id: string, patch: TransactionPatch) => Promise<boolean>;
  addAccount: (input: CreateAccountInput) => Promise<void>;
  updateAccount: (id: string, patch: AccountPatch) => Promise<void>;
  /** D10 soft delete — the account's transactions are never touched. */
  removeAccount: (id: string) => Promise<void>;
  restoreAccount: (id: string) => Promise<void>;
  /** R2b: Add/Link a suggested account + insert its waiting SMS as pending. */
  importSuggestion: (input: ImportSuggestionInput) => Promise<ImportSuggestionResult>;
  /** R2b: Ignore a suggested account key (never suggested/imported again). */
  ignoreSuggestion: (key: AccountKey) => Promise<void>;
  /** R2: "Always use <category> for <merchant>" — audited 'rule_saved'. */
  saveMerchantRule: (
    merchantName: string,
    categoryId: string,
    transactionId?: string | null,
  ) => Promise<void>;
  deleteMerchantRule: (merchantKey: string) => Promise<void>;
  /** Other pending/approved items of the same merchant a rule would change. */
  ruleTargets: (merchantName: string, categoryId: string, excludeId: string | null) => CategoryChange[];
  /** Apply a set of category changes in one db.transaction; returns them for Undo. */
  applyCategoryChanges: (changes: ReadonlyArray<CategoryChange>) => Promise<CategoryChange[]>;
  /** Undo: restores each item's exact previous category id. */
  undoCategoryChanges: (applied: ReadonlyArray<CategoryChange>) => Promise<void>;
  addCategory: (input: CreateCategoryInput) => Promise<Category>;
  updateCategory: (id: string, patch: CategoryPatch) => Promise<void>;
  archiveCategory: (id: string) => Promise<void>;
  /** R3a: "Not a transfer" decisions (pairs never suggested again). */
  transferDismissals: TransferDismissal[];
  /** R3a: Add Record → Transfer. Created approved (see addTransfer), audited 'created'. */
  addTransfer: (input: TransferInput) => Promise<Transaction>;
  /** R3a: Edit transfer — audited 'edited' with the changed field names. */
  updateTransfer: (id: string, input: TransferInput) => Promise<void>;
  /** R3a: approved income/expense → transfer (audited 'edited'). False when not allowed. */
  markAsTransfer: (id: string, otherAccountId: string) => Promise<boolean>;
  /** R3a: "It's a transfer" on a suggested pair. False when no longer a valid pair. */
  confirmTransferPair: (debitId: string, creditId: string) => Promise<boolean>;
  /** R3a: "Not a transfer". */
  dismissTransferPair: (debitId: string, creditId: string) => Promise<void>;
  /** R3a: "Undo transfer" on a paired transfer — restores both rows exactly. */
  undoTransfer: (transferId: string) => Promise<boolean>;
  /** R3b: "Not duplicates" decisions (pairs never suggested again). */
  duplicateDismissals: DuplicateDismissal[];
  /** R3b: link an income as a refund of an expense. Null = linked, else why not. */
  linkRefund: (refundId: string, expenseId: string) => Promise<RefundLinkError | 'missing' | null>;
  /** R3b: "Unlink refund" — the income counts as income again. */
  unlinkRefund: (refundId: string) => Promise<boolean>;
  /** R3b: keep `keptId`, hide `duplicateId` (rejected + link_kind duplicate). */
  markDuplicate: (keptId: string, duplicateId: string) => Promise<boolean>;
  /** R3b: "Not a duplicate" on a hidden row — restores it exactly. */
  restoreDuplicate: (duplicateId: string) => Promise<boolean>;
  /** R3b: "Not duplicates" on a suggestion. */
  dismissDuplicatePair: (aId: string, bId: string) => Promise<void>;
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

function rulesToMap(rules: ReadonlyArray<MerchantRule>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const rule of rules) map[rule.merchantKey] = rule.categoryId;
  return map;
}

async function loadAll() {
  const [transactions, accounts, categories, rules, transferDismissals, duplicateDismissals] =
    await Promise.all([
      transactionRepository.listAll(),
      accountRepository.listAllAccounts(),
      categoryRepository.listAll(),
      merchantRuleRepository.listAll(),
      transferRepository.listDismissals(),
      linkRepository.listDuplicateDismissals(),
    ]);
  return {
    transactions,
    accounts,
    categories,
    merchantRules: rulesToMap(rules),
    transferDismissals,
    duplicateDismissals,
  };
}

export const useTransactionsStore = create<TransactionsState>((set, get) => ({
  transactions: [],
  accounts: [],
  categories: [],
  merchantRules: {},
  transferDismissals: [],
  duplicateDismissals: [],
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
          actor: auto.actor ?? 'system',
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
            transferAccountId: current.transferAccountId ?? null,
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
    // R3b.1: the same guard the Edit form shows inline — hidden rows are never
    // edited, refund links never break through an edit.
    if (
      existing &&
      linkedEditError(
        existing,
        {
          type: patch.type ?? existing.type,
          amountMinor: patch.amountMinor ?? existing.amountMinor,
        },
        get().transactions,
      )
    ) {
      return false;
    }
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
    return true;
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

  importSuggestion: async input => {
    const result = await suggestionRepository.importSuggestion(input);
    set(state => ({
      accounts: result.account ? [...state.accounts, result.account] : state.accounts,
      transactions: [...result.transactions, ...state.transactions],
    }));
    return result;
  },

  ignoreSuggestion: async key => {
    await accountRepository.ignoreSuggestion(key);
  },

  saveMerchantRule: async (merchantName, categoryId, transactionId = null) => {
    const key = normalizeMerchant(merchantName);
    if (key === '') return;
    const transaction = transactionId
      ? get().transactions.find(t => t.id === transactionId) ?? null
      : null;
    // Metadata is the category id only; the triggering item (if any) lets
    // Activity name the merchant without storing merchant text in the rule event.
    await merchantRuleRepository.upsert(key, categoryId, [
      {
        eventType: 'rule_saved',
        actor: 'user',
        metadata: { kind: 'rule_saved', categoryId },
        transactionId: transaction?.id ?? null,
        accountId: transaction?.accountId ?? null,
      },
    ]);
    set(state => ({ merchantRules: { ...state.merchantRules, [key]: categoryId } }));
  },

  deleteMerchantRule: async merchantKey => {
    const categoryId = get().merchantRules[merchantKey];
    if (categoryId === undefined) return;
    await merchantRuleRepository.delete(merchantKey, [
      { eventType: 'rule_deleted', actor: 'user', metadata: { kind: 'rule_deleted', categoryId } },
    ]);
    set(state => {
      const next = { ...state.merchantRules };
      delete next[merchantKey];
      return { merchantRules: next };
    });
  },

  ruleTargets: (merchantName, categoryId, excludeId) =>
    ruleApplyTargets(get().transactions, normalizeMerchant(merchantName), categoryId, excludeId),

  applyCategoryChanges: async changes => {
    // Re-read the live categories so Undo restores what was really there.
    const byId = new Map(get().transactions.map(t => [t.id, t]));
    const live: CategoryChange[] = [];
    for (const change of changes) {
      const current = byId.get(change.id);
      if (!current || current.categoryId === change.toCategoryId) continue;
      live.push({ ...change, accountId: current.accountId, fromCategoryId: current.categoryId });
    }
    if (live.length === 0) return [];
    const updatedAt = await transactionRepository.setCategories(
      live.map(c => ({ id: c.id, accountId: c.accountId, categoryId: c.toCategoryId })),
    );
    const target = new Map(live.map(c => [c.id, c.toCategoryId]));
    set(state => ({
      transactions: state.transactions.map(t =>
        target.has(t.id) ? { ...t, categoryId: target.get(t.id) as string, updatedAt } : t,
      ),
    }));
    return live;
  },

  undoCategoryChanges: async applied => {
    await get().applyCategoryChanges(invertChanges(applied));
  },

  addCategory: async input => {
    const created = await categoryRepository.create(input, category => [
      {
        eventType: 'category_created',
        actor: 'user',
        metadata: { kind: 'category_created', categoryId: category.id },
      },
    ]);
    set(state => ({ categories: [...state.categories, created] }));
    return created;
  },

  updateCategory: async (id, patch) => {
    const existing = get().categories.find(c => c.id === id);
    if (!existing) return;
    const fields = (['name', 'icon', 'color'] as const).filter(
      field => patch[field] !== undefined && patch[field] !== existing[field],
    );
    if (fields.length === 0) return;
    const updated = await categoryRepository.update(id, patch, [
      {
        eventType: 'category_updated',
        actor: 'user',
        metadata: { kind: 'category_updated', categoryId: id, fields: [...fields] },
      },
    ]);
    set(state => ({ categories: state.categories.map(c => (c.id === id ? updated : c)) }));
  },

  archiveCategory: async id => {
    const existing = get().categories.find(c => c.id === id);
    if (!existing || existing.archivedAt !== null) return;
    const archived = await categoryRepository.archive(id, [
      {
        eventType: 'category_archived',
        actor: 'user',
        metadata: { kind: 'category_archived', categoryId: id },
      },
    ]);
    set(state => ({ categories: state.categories.map(c => (c.id === id ? archived : c)) }));
  },

  addTransfer: async input => {
    // A transfer is the user moving their own money — not a detection to
    // review — so it is recorded approved (it never counts as income or
    // expense; it only moves balances). Audited 'created' by the user.
    const now = new Date().toISOString();
    const created = await transactionRepository.create(
      {
        type: 'transfer',
        status: 'approved',
        amountMinor: input.amountMinor,
        currency: 'INR',
        merchantName: MANUAL_TRANSFER_TITLE,
        categoryId: TRANSFER_CATEGORY_ID,
        accountId: input.fromAccountId,
        transferAccountId: input.toAccountId,
        paymentMethod: 'bank',
        occurredAt: input.occurredAt,
        detectedAt: now,
        approvedAt: now,
        note: input.note,
        sourceType: 'manual',
        sourceReferenceHash: null,
        sanitizedPreview: null,
        confidenceScore: null,
        parserVersion: null,
      },
      [{ eventType: 'created', actor: 'user' }],
    );
    set(state => ({ transactions: [created, ...state.transactions] }));
    return created;
  },

  updateTransfer: async (id, input) => {
    const existing = get().transactions.find(t => t.id === id);
    if (!existing || existing.type !== 'transfer') return;
    await get().updateTransaction(id, {
      accountId: input.fromAccountId,
      transferAccountId: input.toAccountId,
      amountMinor: input.amountMinor,
      occurredAt: input.occurredAt,
      note: input.note,
    });
  },

  markAsTransfer: async (id, otherAccountId) => {
    const existing = get().transactions.find(t => t.id === id);
    if (!existing) return false;
    const patch = markAsTransferPatch(existing, otherAccountId);
    if (!patch) return false;
    // Audited 'edited' with the field names that really changed
    // (type, transferAccountId, plus categoryId / accountId when they move).
    // R3b.1: an expense with linked refunds cannot become a transfer.
    return get().updateTransaction(id, patch);
  },

  confirmTransferPair: async (debitId, creditId) => {
    const byId = new Map(get().transactions.map(t => [t.id, t]));
    const debit = byId.get(debitId);
    const credit = byId.get(creditId);
    if (!debit || !credit) return false;
    const confirmation = buildPairConfirmation(debit, credit, new Date().toISOString());
    if (!confirmation) return false;
    await transferRepository.confirmPair(
      confirmation.debit,
      confirmation.credit,
      confirmation.previous,
    );
    set(state => ({
      transactions: state.transactions.map(t =>
        t.id === debitId ? confirmation.debit : t.id === creditId ? confirmation.credit : t,
      ),
    }));
    return true;
  },

  dismissTransferPair: async (debitId, creditId) => {
    const dismissal = await transferRepository.dismissPair(debitId, creditId);
    set(state => ({ transferDismissals: [...state.transferDismissals, dismissal] }));
  },

  undoTransfer: async transferId => {
    const transactions = get().transactions;
    const debit = transactions.find(t => t.id === transferId);
    const twin = findTransferTwin(transactions, transferId);
    if (!debit || !twin) return false;
    const pairing = await transferRepository.latestPairing(transferId);
    if (!pairing || pairing.credit_id !== twin.id) return false;
    const restored = undoTransferPair(debit, twin, pairing.previous, new Date().toISOString());
    if (!restored) return false;
    await transferRepository.undoPair(restored.debit, restored.credit);
    set(state => ({
      transactions: state.transactions.map(t =>
        t.id === restored.debit.id ? restored.debit : t.id === restored.credit.id ? restored.credit : t,
      ),
    }));
    return true;
  },

  linkRefund: async (refundId, expenseId) => {
    const transactions = get().transactions;
    const refund = transactions.find(t => t.id === refundId);
    const expense = transactions.find(t => t.id === expenseId);
    if (!refund || !expense) return 'missing';
    const error = validateRefundLink(refund, expense, transactions);
    if (error) return error;
    const linked = linkRefundPatch(refund, expense, new Date().toISOString());
    await linkRepository.linkRefund(linked, expense.id, refund.categoryId);
    set(state => ({
      transactions: state.transactions.map(t => (t.id === linked.id ? linked : t)),
    }));
    return null;
  },

  unlinkRefund: async refundId => {
    const refund = get().transactions.find(t => t.id === refundId);
    if (!refund || !isLinkedRefund(refund)) return false;
    const expenseId = refund.linkedTransactionId as string;
    const link = await linkRepository.latestRefundLink(refundId, expenseId);
    const unlinked = unlinkRefundPatch(
      refund,
      link?.previous_category_id ?? null,
      link?.category_id ?? null,
      new Date().toISOString(),
    );
    if (!unlinked) return false;
    await linkRepository.unlinkRefund(unlinked, expenseId);
    set(state => ({
      transactions: state.transactions.map(t => (t.id === unlinked.id ? unlinked : t)),
    }));
    return true;
  },

  markDuplicate: async (keptId, duplicateId) => {
    const byId = new Map(get().transactions.map(t => [t.id, t]));
    const kept = byId.get(keptId);
    const duplicate = byId.get(duplicateId);
    if (!kept || !duplicate) return false;
    const marking = buildDuplicateMarking(kept, duplicate, new Date().toISOString());
    if (!marking) return false;
    await linkRepository.markDuplicate(marking.duplicate, kept.id, marking.previous);
    set(state => ({
      transactions: state.transactions.map(t =>
        t.id === marking.duplicate.id ? marking.duplicate : t,
      ),
    }));
    return true;
  },

  restoreDuplicate: async duplicateId => {
    const hidden = get().transactions.find(t => t.id === duplicateId);
    if (!hidden || hidden.linkKind !== 'duplicate' || hidden.linkedTransactionId == null) {
      return false;
    }
    const keptId = hidden.linkedTransactionId;
    const mark = await linkRepository.latestDuplicateMark(duplicateId, keptId);
    if (!mark) return false;
    const restored = buildDuplicateRestore(hidden, mark.previous, new Date().toISOString());
    if (!restored) return false;
    await linkRepository.restoreDuplicate(restored, keptId);
    set(state => ({
      transactions: state.transactions.map(t => (t.id === restored.id ? restored : t)),
    }));
    return true;
  },

  dismissDuplicatePair: async (aId, bId) => {
    const dismissal = await linkRepository.dismissDuplicatePair(aId, bId);
    set(state => ({ duplicateDismissals: [...state.duplicateDismissals, dismissal] }));
  },
}));

/** R3b: live refunds linked to an expense (used by Detail + the delete guard). */
export function linkedRefundsOf(
  state: Pick<TransactionsState, 'transactions'>,
  expenseId: string,
): Transaction[] {
  return refundsFor(state.transactions, expenseId);
}

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
