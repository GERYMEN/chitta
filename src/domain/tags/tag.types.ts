/**
 * R11: custom tags are user content (stored: tags + transaction_tags). AUTO tags
 * (#UPI/#Card/#Cash/#Bank) are derived from paymentMethod and never stored.
 */
export interface Tag {
  id: string;
  /** Display name, the user's casing, no leading '#'. */
  name: string;
  /** Normalized lower-case key (unique). */
  nameKey: string;
  createdAt: string;
}

export const MAX_TAG_LENGTH = 30;
