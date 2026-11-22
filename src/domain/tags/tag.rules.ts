import type { PaymentMethod } from '../transactions/transaction.types';
import { MAX_TAG_LENGTH } from './tag.types';

const AUTO_TAG: Partial<Record<PaymentMethod, string>> = {
  upi: '#UPI',
  card: '#Card',
  cash: '#Cash',
  bank: '#Bank',
};

/** Pure: virtual tags from the payment method ('other' -> none). */
export function autoTagsFor(transaction: { paymentMethod: PaymentMethod }): string[] {
  const tag = AUTO_TAG[transaction.paymentMethod];
  return tag ? [tag] : [];
}

export const ALL_AUTO_TAGS: ReadonlyArray<string> = ['#UPI', '#Card', '#Cash', '#Bank'];

export function isAutoTag(value: string): boolean {
  return ALL_AUTO_TAGS.includes(value);
}

/** Trim, drop leading '#', collapse inner whitespace. */
export function normalizeTagName(raw: string): string {
  return raw.trim().replace(/^#+/, '').trim().replace(/\s+/g, ' ');
}

export function tagKey(raw: string): string {
  return normalizeTagName(raw).toLowerCase();
}

/** The normalized display name, or null when empty / too long. */
export function validateTagName(raw: string): string | null {
  const name = normalizeTagName(raw);
  if (name.length === 0 || name.length > MAX_TAG_LENGTH) return null;
  return name;
}

/**
 * Filter predicate for a selected tag: an auto tag ('#UPI' …) matches on the
 * derived value; otherwise the selection is a custom tag key.
 */
export function tagsMatchingFilter(
  transaction: { paymentMethod: PaymentMethod },
  customTagKeys: ReadonlyArray<string>,
  selected: string,
): boolean {
  if (isAutoTag(selected)) return autoTagsFor(transaction).includes(selected);
  return customTagKeys.includes(selected);
}
