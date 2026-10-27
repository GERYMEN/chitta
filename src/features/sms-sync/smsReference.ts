export interface SmsReference {
  smsId: string;
  dateMs: number;
}

const SMS_REFERENCE_PATTERN = /^sms-(\d+)-(\d+)$/;

/**
 * Parses the `sourceReferenceHash` the SMS parser writes
 * (`sms-${smsId}-${dateMs}`) back into its parts. Returns null for manual
 * transactions (null hash) or anything not in that exact format.
 */
export function parseSmsReference(hash: string | null | undefined): SmsReference | null {
  if (!hash) return null;
  const match = SMS_REFERENCE_PATTERN.exec(hash);
  if (!match) return null;
  const dateMs = Number(match[2]);
  if (!Number.isSafeInteger(dateMs)) return null;
  return { smsId: match[1], dateMs };
}
