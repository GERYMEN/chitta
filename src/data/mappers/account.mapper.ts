import { Account } from '../../domain/accounts/account.types';
import {
  asBoolean,
  asNullableDateIso,
  asNullableNumber,
  asNullableString,
  asNumber,
  asString,
  dateIsoToEpochMs,
  SqlRow,
  SqlWriteRow,
} from './coerce';

export function rowToAccount(row: SqlRow): Account {
  return {
    id: asString(row.id),
    name: asString(row.name),
    type: row.type as Account['type'],
    lastFour: asNullableString(row.last_four),
    openingBalanceMinor: asNumber(row.opening_balance_minor),
    currency: 'INR',
    isActive: asBoolean(row.is_active),
    balanceAnchorMinor: asNullableNumber(row.balance_anchor_minor),
    balanceAnchorAt: asNullableDateIso(row.balance_anchor_at),
    deletedAt: asNullableDateIso(row.deleted_at),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

export function accountToRow(account: Account): SqlWriteRow {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    last_four: account.lastFour,
    opening_balance_minor: account.openingBalanceMinor,
    currency: account.currency,
    is_active: account.isActive ? 1 : 0,
    balance_anchor_minor: account.balanceAnchorMinor,
    balance_anchor_at: dateIsoToEpochMs(account.balanceAnchorAt),
    deleted_at: dateIsoToEpochMs(account.deletedAt),
    created_at: account.createdAt,
    updated_at: account.updatedAt,
  };
}
