import type { TransactionStatus, TransactionType } from '../transactions/transaction.types';
import type { AccountType } from '../accounts/account.types';
import type { TransferPairPrevious } from '../transfers/transfer.rules';
import type { DuplicateRowSnapshot } from '../duplicates/duplicate.rules';
import type { MeaningConversionPrevious } from '../meaning/meaning.rules';
import type { MeaningKind } from '../meaning/meaning.types';
import type { BillKind, BillSource } from '../bills/bill.types';
import type { ChainSuggestionKind } from '../chains/chainSuggestion.types';

/**
 * Every money-changing action writes exactly one audit event (R1).
 * `created` is the manual Add Record counterpart of SMS `detected`.
 */
export type AuditEventType =
  | 'detected'
  | 'created'
  /**
   * R5 (owner, 2026-11-06): a record the user typed (Add Record, or "Add as
   * transaction" from Messages not understood) — saved straight as approved.
   * 'created' remains for transfers and pre-R5 manual rows (pending).
   */
  | 'added'
  | 'auto_approved'
  | 'approved'
  | 'edited'
  | 'rejected'
  | 'deleted'
  | 'account_created'
  | 'account_updated'
  | 'account_removed'
  | 'account_restored'
  | 'settings_changed'
  | 'rule_saved'
  | 'rule_deleted'
  | 'category_created'
  | 'category_updated'
  | 'category_archived'
  /** R5j: an archived category brought back. */
  | 'category_restored'
  /** R3a: an SMS debit + credit confirmed as one transfer / that undone. */
  | 'transfer_paired'
  | 'transfer_unpaired'
  /** R3b: an income linked as a refund of an expense / that undone. */
  | 'refund_linked'
  | 'refund_unlinked'
  /** R3b: a row hidden as a duplicate of another / "Not a duplicate". */
  | 'duplicate_marked'
  | 'duplicate_restored'
  /** R4b: Pending "Approve all" → Undo put an approved item back to pending. */
  | 'approval_undone'
  /** R4e: all data replaced from a backup file (row counts per table only). */
  | 'backup_restored'
  /** R5: "Re-read messages with the new reader" run (counts only). */
  | 'sms_rescan'
  /** R5: a run started by a new SMS arriving (counts only). */
  | 'auto_read'
  /** R5: New Accounts Found → "Link to existing account" / its Undo. */
  | 'account_linked'
  | 'account_unlinked'
  /**
   * R5e: a money meaning confirmed (by the user, or a stored meaning rule)
   * turned an SMS item into an R3a transfer / its Undo; a meaning rule removed.
   */
  | 'transfer_marked'
  | 'transfer_unmarked'
  | 'meaning_rule_removed'
  /**
   * R5b (D-i): a bill created / updated / paid / reopened / dismissed. Ids,
   * enums and amounts only — never SMS text or a sender number.
   */
  | 'bill_created'
  | 'bill_updated'
  | 'bill_paid'
  | 'bill_reopened'
  | 'bill_dismissed'
  /**
   * R5i (G3): a chain suggestion surfaced by the rules engine / accepted /
   * dismissed in Review. Ids + the enum chain kind only — never SMS text, a
   * sender number or an amount.
   */
  | 'chain_suggested'
  | 'chain_accepted'
  | 'chain_dismissed'
  /**
   * R5c (D-g): a budget set / its amount updated / removed. categoryId (null =
   * the overall budget), the amount and, for an update, the changed field —
   * ids / enums / numbers only. Never a category name, SMS text or a sender.
   */
  | 'budget_set'
  | 'budget_updated'
  | 'budget_deleted';

export type AuditActor = 'system' | 'user';

/** Settings keys whose changes are audited. `user_name` is never audited. */
export type AuditedSettingKey =
  | 'approval_mode'
  | 'auto_approve_threshold'
  /** R4b: dates/mode names only — never SMS content. */
  | 'sms_sync_start_mode'
  | 'sms_sync_start_at'
  /** R5: 'on' / 'off' only. */
  | 'sms_auto_read';

/**
 * Small typed payloads only. NEVER SMS text, SMS sender, or
 * sanitizedPreview — only numbers, field names and short enum values.
 * `deleted` carries a minimal snapshot (merchant, amount, type, status) so
 * the feed can still say what was removed once the row is gone.
 */
export type AuditMetadata =
  /**
   * B4 (R4): transaction events record the row's TYPE at event time (an enum
   * name only — never text or amounts), so Activity can describe the row as
   * it was then. Optional: events written before R4 have no type.
   */
  | { kind: 'detected'; confidence: number | null; transactionType?: TransactionType }
  | { kind: 'created'; transactionType: TransactionType }
  | { kind: 'added'; transactionType: TransactionType }
  | { kind: 'approved'; transactionType: TransactionType }
  | { kind: 'rejected'; transactionType: TransactionType }
  | { kind: 'approval_undone'; transactionType: TransactionType }
  | {
      kind: 'auto_approved';
      confidence: number;
      threshold: number;
      transactionType?: TransactionType;
    }
  /**
   * `transactionType` = the type right after the edit; `fromType`/`toType`
   * only when the edit changed the type (e.g. Mark as transfer).
   */
  | {
      kind: 'edited';
      fields: string[];
      transactionType?: TransactionType;
      fromType?: TransactionType;
      toType?: TransactionType;
    }
  | {
      kind: 'deleted';
      merchantName: string;
      amountMinor: number;
      type: TransactionType;
      status: TransactionStatus;
      /** R3a: the "to" account id of a deleted transfer (id only). */
      transferAccountId?: string | null;
    }
  | { kind: 'account_updated'; fields: string[] }
  | { kind: 'settings_changed'; key: AuditedSettingKey; from: string; to: string }
  /** R2: a merchant rule — the category id only (no merchant text). */
  | { kind: 'rule_saved'; categoryId: string }
  | { kind: 'rule_deleted'; categoryId: string }
  /** R2: category management — the id only; the feed looks the name up. */
  | { kind: 'category_created'; categoryId: string }
  | { kind: 'category_updated'; categoryId: string; fields: string[] }
  | { kind: 'category_archived'; categoryId: string }
  | { kind: 'category_restored'; categoryId: string }
  /**
   * R3a: ids + the previous enum/id/timestamp fields of both rows (so Undo
   * restores them exactly). Never merchant text, SMS text or amounts.
   */
  | { kind: 'transfer_paired'; debit_id: string; credit_id: string; previous: TransferPairPrevious }
  | { kind: 'transfer_unpaired'; debit_id: string; credit_id: string }
  /**
   * R3b: ids only (+ the refund's category id before/after linking, so
   * Unlink can put its category back). Never merchant text, SMS text or amounts.
   */
  | {
      kind: 'refund_linked';
      refund_id: string;
      expense_id: string;
      previous_category_id: string | null;
      category_id: string | null;
    }
  | { kind: 'refund_unlinked'; refund_id: string; expense_id: string }
  /** R3b: ids + the hidden row's previous enum/id/timestamp fields (exact restore). */
  | {
      kind: 'duplicate_marked';
      kept_id: string;
      duplicate_id: string;
      previous: DuplicateRowSnapshot;
    }
  | { kind: 'duplicate_restored'; kept_id: string; duplicate_id: string }
  /**
   * R4e: restored from a backup — row counts per table name only. Never
   * the password, the file name, the JSON or any row content.
   */
  | { kind: 'backup_restored'; counts: Record<string, number> }
  /**
   * R5: an SMS reader run — COUNTS ONLY (never SMS text, sender, merchant or
   * amount).
   */
  | { kind: 'sms_rescan' | 'auto_read'; counts: SmsRunCounts }
  /**
   * R5: a detected SMS account key linked to an existing account (or the
   * Undo). Public bank id + kind + item count only — no last-4, no SMS text.
   * The audit row's account_id is the chosen account.
   */
  | {
      kind: 'account_linked' | 'account_unlinked';
      bankCanonical: string;
      accountKind: AccountType;
      items: number;
    }
  /**
   * R5e (R3a shape): ids + the previous enum/id/timestamp fields of the
   * transfer row (and its twin, if the counterpart SMS was hidden) so Undo
   * restores them exactly; the meaning kind; `rule` = converted by a stored
   * meaning rule; the rule this confirm created / re-pointed (Undo removes /
   * re-points it). Never merchant text, SMS text, amounts or last-4.
   */
  | {
      kind: 'transfer_marked';
      transaction_id: string;
      twin_id: string | null;
      meaning: MeaningKind;
      rule: boolean;
      previous: MeaningConversionPrevious;
      rule_id: string | null;
      rule_created: boolean;
      previous_rule_target: string | null;
      /**
       * R5e-FIX K1: a late counterpart SMS was hidden as this existing
       * transfer's twin (the transfer itself did not change). Undo of this
       * mark only brings that row back.
       */
      twin_added?: boolean;
    }
  | {
      kind: 'transfer_unmarked';
      transaction_id: string;
      twin_id: string | null;
      meaning: MeaningKind;
      /** R5e-FIX K1: only the late twin came back (the transfer stays). */
      twin_only?: boolean;
    }
  /** R5e: Settings → Automatic money rules → Remove (enum + public bank id only). */
  | { kind: 'meaning_rule_removed'; meaning: MeaningKind; bankCanonical: string }
  /**
   * R5b (D-i): bill events — ids, the bill kind, the source enum and amounts
   * only. `source` says whether the bill came from an SMS or manual entry;
   * `amountMinor` is the amount due; `paidMinor` the payment just recorded.
   * Never a payee string, SMS text or a sender number.
   */
  | { kind: 'bill_created'; billId: string; billKind: BillKind; source: BillSource; amountMinor: number }
  | { kind: 'bill_updated'; billId: string; fields: string[] }
  | { kind: 'bill_paid'; billId: string; paidMinor: number; linked: boolean }
  | { kind: 'bill_reopened'; billId: string }
  | { kind: 'bill_dismissed'; billId: string }
  /**
   * R5i (G3): chain suggestion events — ids + the enum chain kind only. The
   * audit row's transaction_id is the child. `parentId` is the matched parent
   * (null for 'incomplete'). Never a payee, SMS text or amount.
   */
  | { kind: 'chain_suggested'; childId: string; parentId: string | null; chainKind: ChainSuggestionKind }
  | { kind: 'chain_accepted'; childId: string; parentId: string | null; chainKind: ChainSuggestionKind }
  | { kind: 'chain_dismissed'; childId: string; chainKind: ChainSuggestionKind }
  /**
   * R5c (D-g): budget events — the budgeted category id (null = overall), the
   * amount in paise and, for an update, the changed field name only. Never a
   * category name, SMS text or a sender number.
   */
  | { kind: 'budget_set'; categoryId: string | null; amountMinor: number }
  | { kind: 'budget_updated'; categoryId: string | null; amountMinor: number; fields: string[] }
  | { kind: 'budget_deleted'; categoryId: string | null; amountMinor: number };

/** R5: counts of one reader run. */
export interface SmsRunCounts {
  scanned: number;
  created: number;
  notUnderstood: number;
  autoApproved: number;
  /** R5g: new items from a template / the reader alone / held for disagreement. */
  viaRule?: number;
  viaReader?: number;
  heldForRuleDisagreement?: number;
  /** R5e T5: meaning suggestions added to EXISTING rows by a re-scan. */
  meaningSuggested?: number;
}

export interface AuditEvent {
  id: string;
  /** SQLite rowid — monotonic insertion order, used as the cursor tiebreaker. */
  seq: number;
  transactionId: string | null;
  accountId: string | null;
  eventType: AuditEventType;
  eventAt: string;
  actor: AuditActor;
  metadata: AuditMetadata | null;
}

/** What a store action hands to a repository; ids/time are filled there. */
export interface AuditEventDraft {
  eventType: AuditEventType;
  actor: AuditActor;
  metadata?: AuditMetadata | null;
}

export interface AuditEventInput extends AuditEventDraft {
  transactionId?: string | null;
  accountId?: string | null;
  eventAt?: string;
}

/** Feed row: the event plus the `deleted` snapshot of its transaction, if any. */
export interface AuditFeedEvent extends AuditEvent {
  deletedSnapshot: Extract<AuditMetadata, { kind: 'deleted' }> | null;
}

/** Pagination cursor: strictly older than (eventAt, seq). */
export interface AuditCursor {
  eventAt: string;
  seq: number;
}
