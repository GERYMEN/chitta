import { Transaction } from '../../domain/transactions/transaction.types';
import {
  asNumber,
  asNullableNumber,
  asNullableString,
  asString,
  SqlRow,
  SqlWriteRow,
} from './coerce';

export function rowToTransaction(row: SqlRow): Transaction {
  return {
    id: asString(row.id),
    type: row.type as Transaction['type'],
    status: row.status as Transaction['status'],
    amountMinor: asNumber(row.amount_minor),
    currency: 'INR',
    merchantName: asString(row.merchant_name),
    categoryId: asString(row.category_id),
    accountId: asString(row.account_id),
    paymentMethod: row.payment_method as Transaction['paymentMethod'],
    occurredAt: asString(row.occurred_at),
    detectedAt: asString(row.detected_at),
    approvedAt: asNullableString(row.approved_at),
    note: asNullableString(row.note),
    sourceType: row.source_type as Transaction['sourceType'],
    sourceReferenceHash: asNullableString(row.source_reference_hash),
    sanitizedPreview: asNullableString(row.sanitized_preview),
    confidenceScore: asNullableNumber(row.confidence_score),
    parserVersion: asNullableString(row.parser_version),
    bulkBatchId: asNullableString(row.bulk_batch_id),
    transferAccountId: asNullableString(row.transfer_account_id),
    linkedTransactionId: asNullableString(row.linked_transaction_id),
    linkKind: asNullableString(row.link_kind) as Transaction['linkKind'],
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

export function transactionToRow(transaction: Transaction): SqlWriteRow {
  return {
    id: transaction.id,
    type: transaction.type,
    status: transaction.status,
    amount_minor: transaction.amountMinor,
    currency: transaction.currency,
    merchant_name: transaction.merchantName,
    category_id: transaction.categoryId,
    account_id: transaction.accountId,
    payment_method: transaction.paymentMethod,
    occurred_at: transaction.occurredAt,
    detected_at: transaction.detectedAt,
    approved_at: transaction.approvedAt,
    note: transaction.note,
    source_type: transaction.sourceType,
    source_reference_hash: transaction.sourceReferenceHash,
    sanitized_preview: transaction.sanitizedPreview,
    confidence_score: transaction.confidenceScore,
    parser_version: transaction.parserVersion,
    bulk_batch_id: transaction.bulkBatchId ?? null,
    transfer_account_id: transaction.transferAccountId ?? null,
    linked_transaction_id: transaction.linkedTransactionId ?? null,
    link_kind: transaction.linkKind ?? null,
    created_at: transaction.createdAt,
    updated_at: transaction.updatedAt,
  };
}
