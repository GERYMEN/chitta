import { settingsRepository } from '../../../data/repositories/settings.repository';
import { DEFAULT_PERIOD, PERIODS } from '../../../domain/periods/period.rules';
import { Period } from '../../../domain/periods/period.types';
import { isAutoTag } from '../../../domain/tags/tag.rules';
import { DEFAULT_TRANSACTION_FILTERS, TransactionFilters, TypeFilter } from './transactionFilters';

/**
 * R5j (G7, owner-optional): the last-applied Transactions filters survive a
 * restart. Stored in `app_settings` (no new table, no dependency) as ids + enums
 * only: type, account id, category id, period, and (R11) the tag key + label. The search text and the
 * merchant chip are transient and never saved. "Reset" writes the defaults.
 * To drop the feature: delete the calls in transactionsStore.ts (setters +
 * reloadFromDatabase) — nothing else depends on it.
 */
export const FILTERS_SETTING_KEY = 'transactions_filters';

const TYPES: ReadonlyArray<TypeFilter> = ['all', 'expense', 'income', 'transfer'];

export interface PersistedFilters {
  filters: TransactionFilters;
  period: Period;
}

/** The persisted subset only — never the query or the merchant chip. */
export function serializeFilters(filters: TransactionFilters, period: Period): string {
  return JSON.stringify({
    v: 1,
    type: filters.type,
    accountId: filters.accountId,
    categoryId: filters.categoryId,
    tagKey: filters.tagKey,
    tagLabel: filters.tagLabel,
    period,
  });
}

/**
 * Validate a stored value against what exists now. null = nothing usable
 * (start empty). An id that no longer exists is dropped to "all".
 */
export function parsePersistedFilters(
  raw: string | null,
  known: {
    accountIds: ReadonlyArray<string>;
    categoryIds: ReadonlyArray<string>;
    /** R11: normalized keys of the custom tags that exist now. */
    tagKeys?: ReadonlyArray<string>;
  },
): PersistedFilters | null {
  if (!raw) return null;
  let value: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    value = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const type = TYPES.includes(value.type as TypeFilter) ? (value.type as TypeFilter) : 'all';
  const accountId =
    typeof value.accountId === 'string' && known.accountIds.includes(value.accountId)
      ? value.accountId
      : null;
  const categoryId =
    typeof value.categoryId === 'string' && known.categoryIds.includes(value.categoryId)
      ? value.categoryId
      : null;
  // R11: an auto tag is always valid; a custom tag only while it still exists.
  const rawTag = typeof value.tagKey === 'string' ? value.tagKey : null;
  const tagKey =
    rawTag !== null && (isAutoTag(rawTag) || (known.tagKeys ?? []).includes(rawTag)) ? rawTag : null;
  const tagLabel =
    tagKey !== null && typeof value.tagLabel === 'string' ? value.tagLabel : tagKey;
  const period = PERIODS.includes(value.period as Period) ? (value.period as Period) : DEFAULT_PERIOD;
  return { filters: { ...DEFAULT_TRANSACTION_FILTERS, type, accountId, categoryId, tagKey, tagLabel }, period };
}

let lastWritten: string | null = null;
let pending: Promise<void> = Promise.resolve();

/** Save the filters (skips when the persisted subset did not change). Never throws. */
export function persistFilters(filters: TransactionFilters, period: Period): void {
  const raw = serializeFilters(filters, period);
  // Nothing stored yet == the defaults: an unchanged default writes nothing.
  if (raw === (lastWritten ?? serializeFilters(DEFAULT_TRANSACTION_FILTERS, DEFAULT_PERIOD))) return;
  lastWritten = raw;
  pending = pending
    .then(() => settingsRepository.setValue(FILTERS_SETTING_KEY, raw))
    .catch(() => {
      lastWritten = null;
    });
}

/** Tell the writer what the database holds now (after a load). */
export function noteLoadedFilters(raw: string | null): void {
  lastWritten = raw;
}

export function readPersistedFilters(): Promise<string | null> {
  return settingsRepository.getValue(FILTERS_SETTING_KEY);
}

/** Await queued writes (tests, and before a backup if ever needed). */
export function flushFilterPersistence(): Promise<void> {
  return pending;
}
