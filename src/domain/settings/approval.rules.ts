import {
  CONFIDENCE_HIGH,
  CONFIDENCE_NEEDS_REVIEW,
} from '../transactions/transaction.rules';

/**
 * Opt-in auto-approval policy for SMS-detected transactions.
 * Default is 'manual' — every SMS transaction waits in Pending for the user.
 * In 'auto' mode, a NEWLY synced SMS transaction whose confidence is at or
 * above the user's threshold is approved through the normal approve path.
 */
export type ApprovalMode = 'manual' | 'auto';

export const DEFAULT_APPROVAL_MODE: ApprovalMode = 'manual';
/** Never allow auto-approval below the "needs review" tier. */
export const AUTO_APPROVE_THRESHOLD_MIN = CONFIDENCE_NEEDS_REVIEW;
export const AUTO_APPROVE_THRESHOLD_MAX = 100;
export const DEFAULT_AUTO_APPROVE_THRESHOLD = 90;

export const USER_NAME_MAX_LENGTH = 30;

export const SETTINGS_KEYS = {
  userName: 'user_name',
  approvalMode: 'approval_mode',
  autoApproveThreshold: 'auto_approve_threshold',
} as const;

/** Integer threshold clamped to [70, 100]; non-finite → default (90). */
export function clampThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AUTO_APPROVE_THRESHOLD;
  return Math.min(
    AUTO_APPROVE_THRESHOLD_MAX,
    Math.max(AUTO_APPROVE_THRESHOLD_MIN, Math.round(value)),
  );
}

export function parseApprovalMode(raw: string | null | undefined): ApprovalMode {
  return raw === 'auto' ? 'auto' : DEFAULT_APPROVAL_MODE;
}

export function parseThreshold(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === '') return DEFAULT_AUTO_APPROVE_THRESHOLD;
  return clampThreshold(Number(raw));
}

/**
 * Pure auto-approve decision. Manual mode never approves; a null score never
 * approves; the threshold is clamped so it can never drop below 70.
 */
export function shouldAutoApprove(
  mode: ApprovalMode,
  threshold: number,
  confidenceScore: number | null,
): boolean {
  if (mode !== 'auto') return false;
  if (confidenceScore === null || !Number.isFinite(confidenceScore)) return false;
  return confidenceScore >= clampThreshold(threshold);
}

/**
 * Highest confidence the SMS parser currently assigns (`smsParser.ts` scores
 * a clean match at CONFIDENCE_HIGH, everything else lower). Thresholds above
 * this can never auto-approve anything until the parser scores higher.
 */
export const SMS_PARSER_MAX_CONFIDENCE = CONFIDENCE_HIGH;

/**
 * Whether the settings UI should warn that the chosen threshold is above
 * anything the parser currently produces. Only relevant in auto mode.
 */
export function shouldShowThresholdNote(
  mode: ApprovalMode,
  threshold: number,
): boolean {
  return mode === 'auto' && clampThreshold(threshold) > SMS_PARSER_MAX_CONFIDENCE;
}

/** The settings note copy, shared with the Pending Auto-approve hint (R2b). */
export function thresholdNoteText(): string {
  return `SMS matches currently score up to ${SMS_PARSER_MAX_CONFIDENCE}%, so thresholds above ${SMS_PARSER_MAX_CONFIDENCE}% won't auto-approve anything yet.`;
}
