import { Transaction, TransactionType } from '../transactions/transaction.types';
import { Account } from '../accounts/account.types';
import { AuditMetadata } from './audit.types';
import { TransferRowSnapshot } from '../transfers/transfer.rules';

/**
 * Rebuild a metadata payload from whitelisted fields only, so an object
 * that happens to carry extra properties (e.g. a whole Transaction with its
 * sanitizedPreview) can never leak them into `metadata_json`.
 */
export function sanitizeAuditMetadata(
  metadata: AuditMetadata | null | undefined,
): AuditMetadata | null {
  if (!metadata) return null;
  switch (metadata.kind) {
    case 'detected':
      return {
        kind: 'detected',
        confidence: finiteOrNull(metadata.confidence),
        ...typeField('transactionType', metadata.transactionType),
      };
    case 'created':
    case 'approved':
    case 'rejected': {
      const type = typeOrNull(metadata.transactionType);
      return type ? { kind: metadata.kind, transactionType: type } : null;
    }
    case 'auto_approved':
      return {
        kind: 'auto_approved',
        confidence: Number(metadata.confidence),
        threshold: Number(metadata.threshold),
        ...typeField('transactionType', metadata.transactionType),
      };
    case 'edited':
      return {
        kind: 'edited',
        fields: metadata.fields.map(String),
        ...typeField('transactionType', metadata.transactionType),
        ...typeField('fromType', metadata.fromType),
        ...typeField('toType', metadata.toType),
      };
    case 'account_updated':
      return { kind: 'account_updated', fields: metadata.fields.map(String) };
    case 'deleted':
      return {
        kind: 'deleted',
        merchantName: String(metadata.merchantName),
        amountMinor: Number(metadata.amountMinor),
        type: metadata.type,
        status: metadata.status,
        ...(metadata.transferAccountId != null
          ? { transferAccountId: String(metadata.transferAccountId) }
          : {}),
      };
    case 'settings_changed':
      return {
        kind: 'settings_changed',
        key: metadata.key,
        from: String(metadata.from),
        to: String(metadata.to),
      };
    case 'rule_saved':
    case 'rule_deleted':
    case 'category_created':
    case 'category_archived':
      return { kind: metadata.kind, categoryId: String(metadata.categoryId) };
    case 'category_updated':
      return {
        kind: 'category_updated',
        categoryId: String(metadata.categoryId),
        fields: metadata.fields.map(String),
      };
    case 'transfer_paired':
      return {
        kind: 'transfer_paired',
        debit_id: String(metadata.debit_id),
        credit_id: String(metadata.credit_id),
        previous: {
          debit: sanitizeRowSnapshot(metadata.previous.debit),
          credit: sanitizeRowSnapshot(metadata.previous.credit),
        },
      };
    case 'transfer_unpaired':
      return {
        kind: 'transfer_unpaired',
        debit_id: String(metadata.debit_id),
        credit_id: String(metadata.credit_id),
      };
    case 'refund_linked':
      return {
        kind: 'refund_linked',
        refund_id: String(metadata.refund_id),
        expense_id: String(metadata.expense_id),
        previous_category_id: idOrNull(metadata.previous_category_id),
        category_id: idOrNull(metadata.category_id),
      };
    case 'refund_unlinked':
      return {
        kind: 'refund_unlinked',
        refund_id: String(metadata.refund_id),
        expense_id: String(metadata.expense_id),
      };
    case 'duplicate_marked':
      return {
        kind: 'duplicate_marked',
        kept_id: String(metadata.kept_id),
        duplicate_id: String(metadata.duplicate_id),
        previous: sanitizeRowSnapshot(metadata.previous),
      };
    case 'duplicate_restored':
      return {
        kind: 'duplicate_restored',
        kept_id: String(metadata.kept_id),
        duplicate_id: String(metadata.duplicate_id),
      };
    default:
      return null;
  }
}

/** Whitelist the enum/id/timestamp fields of a transfer row snapshot. */
function sanitizeRowSnapshot(snapshot: TransferRowSnapshot): TransferRowSnapshot {
  return {
    type: snapshot.type,
    status: snapshot.status,
    categoryId: String(snapshot.categoryId),
    approvedAt: snapshot.approvedAt == null ? null : String(snapshot.approvedAt),
    transferAccountId: snapshot.transferAccountId == null ? null : String(snapshot.transferAccountId),
    linkedTransactionId:
      snapshot.linkedTransactionId == null ? null : String(snapshot.linkedTransactionId),
    linkKind: snapshot.linkKind ?? null,
  };
}

const TRANSACTION_TYPES: ReadonlySet<string> = new Set(['income', 'expense', 'transfer']);

/** B4: only a known type enum value survives; anything else is dropped. */
function typeOrNull(value: unknown): TransactionType | null {
  return typeof value === 'string' && TRANSACTION_TYPES.has(value) ? (value as TransactionType) : null;
}

function typeField<K extends string>(key: K, value: unknown): Partial<Record<K, TransactionType>> {
  const type = typeOrNull(value);
  return type ? ({ [key]: type } as Record<K, TransactionType>) : {};
}

/**
 * B4: audit payload of an `edited` event — changed field names, the type
 * right after the edit, and from/to when the type itself changed.
 */
export function editedMetadata(
  before: Pick<Transaction, 'type'>,
  patch: Partial<Pick<Transaction, 'type'>>,
  fields: string[],
): Extract<AuditMetadata, { kind: 'edited' }> {
  const after = patch.type ?? before.type;
  return {
    kind: 'edited',
    fields,
    transactionType: after,
    ...(after !== before.type ? { fromType: before.type, toType: after } : {}),
  };
}

function idOrNull(value: string | null | undefined): string | null {
  return value == null ? null : String(value);
}

function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

/** Fields a user can change on a transaction through Edit. */
const EDITABLE_TRANSACTION_FIELDS = [
  'type',
  'amountMinor',
  'merchantName',
  'categoryId',
  'accountId',
  'paymentMethod',
  'occurredAt',
  'note',
  'transferAccountId',
] as const;

/** Names (never values) of the editable fields a patch actually changes. */
export function changedTransactionFields(
  before: Pick<Transaction, (typeof EDITABLE_TRANSACTION_FIELDS)[number]>,
  patch: Partial<Transaction>,
): string[] {
  return EDITABLE_TRANSACTION_FIELDS.filter(
    field =>
      field in patch && patch[field] !== undefined && patch[field] !== (before[field] ?? null),
  );
}

const EDITABLE_ACCOUNT_FIELDS = [
  'name',
  'type',
  'lastFour',
  'openingBalanceMinor',
  'balanceAnchorMinor',
  'balanceAnchorAt',
] as const;

export function changedAccountFields(
  before: Pick<Account, (typeof EDITABLE_ACCOUNT_FIELDS)[number]>,
  patch: Partial<Account>,
): string[] {
  return EDITABLE_ACCOUNT_FIELDS.filter(
    field => field in patch && patch[field] !== undefined && patch[field] !== before[field],
  );
}
