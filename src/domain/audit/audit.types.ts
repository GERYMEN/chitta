import type { TransactionStatus, TransactionType } from '../transactions/transaction.types';

/**
 * Every money-changing action writes exactly one audit event (R1).
 * `created` is the manual Add Record counterpart of SMS `detected`.
 */
export type AuditEventType =
  | 'detected'
  | 'created'
  | 'auto_approved'
  | 'approved'
  | 'edited'
  | 'rejected'
  | 'deleted'
  | 'account_created'
  | 'account_updated'
  | 'account_removed'
  | 'account_restored'
  | 'settings_changed';

export type AuditActor = 'system' | 'user';

/** Settings keys whose changes are audited. `user_name` is never audited. */
export type AuditedSettingKey = 'approval_mode' | 'auto_approve_threshold';

/**
 * Small typed payloads only. NEVER SMS text, SMS sender, or
 * sanitizedPreview — only numbers, field names and short enum values.
 * `deleted` carries a minimal snapshot (merchant, amount, type, status) so
 * the feed can still say what was removed once the row is gone.
 */
export type AuditMetadata =
  | { kind: 'detected'; confidence: number | null }
  | { kind: 'auto_approved'; confidence: number; threshold: number }
  | { kind: 'edited'; fields: string[] }
  | {
      kind: 'deleted';
      merchantName: string;
      amountMinor: number;
      type: TransactionType;
      status: TransactionStatus;
    }
  | { kind: 'account_updated'; fields: string[] }
  | { kind: 'settings_changed'; key: AuditedSettingKey; from: string; to: string };

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
