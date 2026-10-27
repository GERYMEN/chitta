import {
  clampThreshold,
  parseApprovalMode,
  parseThreshold,
  shouldAutoApprove,
  shouldShowThresholdNote,
  SMS_PARSER_MAX_CONFIDENCE,
  AUTO_APPROVE_THRESHOLD_MAX,
} from '../approval.rules';
import { CONFIDENCE_HIGH } from '../../transactions/transaction.rules';

describe('shouldAutoApprove', () => {
  it('never approves in manual mode', () => {
    expect(shouldAutoApprove('manual', 90, 100)).toBe(false);
    expect(shouldAutoApprove('manual', 70, 95)).toBe(false);
  });

  it('approves in auto mode when score is at or above the threshold', () => {
    expect(shouldAutoApprove('auto', 90, 90)).toBe(true);
    expect(shouldAutoApprove('auto', 90, 99)).toBe(true);
    expect(shouldAutoApprove('auto', 95, 100)).toBe(true);
  });

  it('does not approve below the threshold', () => {
    expect(shouldAutoApprove('auto', 90, 89)).toBe(false);
    expect(shouldAutoApprove('auto', 95, 90)).toBe(false);
  });

  it('does not approve a null score', () => {
    expect(shouldAutoApprove('auto', 70, null)).toBe(false);
  });

  it('clamps the threshold so it never drops below 70 or above 100', () => {
    expect(shouldAutoApprove('auto', 10, 60)).toBe(false);
    expect(shouldAutoApprove('auto', 10, 70)).toBe(true);
    expect(shouldAutoApprove('auto', 150, 100)).toBe(true);
    expect(shouldAutoApprove('auto', Number.NaN, 89)).toBe(false);
    expect(shouldAutoApprove('auto', Number.NaN, 90)).toBe(true);
  });
});

describe('settings parsing', () => {
  it('clampThreshold rounds and clamps', () => {
    expect(clampThreshold(95.4)).toBe(95);
    expect(clampThreshold(0)).toBe(70);
    expect(clampThreshold(1000)).toBe(100);
    expect(clampThreshold(Number.POSITIVE_INFINITY)).toBe(90);
  });

  it('parseApprovalMode defaults to manual', () => {
    expect(parseApprovalMode('auto')).toBe('auto');
    expect(parseApprovalMode('manual')).toBe('manual');
    expect(parseApprovalMode(null)).toBe('manual');
    expect(parseApprovalMode('AUTO')).toBe('manual');
  });

  it('parseThreshold defaults to 90 and clamps stored values', () => {
    expect(parseThreshold(null)).toBe(90);
    expect(parseThreshold('')).toBe(90);
    expect(parseThreshold('abc')).toBe(90);
    expect(parseThreshold('95')).toBe(95);
    expect(parseThreshold('50')).toBe(70);
    expect(parseThreshold('120')).toBe(100);
  });
});

describe('shouldShowThresholdNote', () => {
  it('uses the parser max confidence (CONFIDENCE_HIGH = 90)', () => {
    expect(SMS_PARSER_MAX_CONFIDENCE).toBe(CONFIDENCE_HIGH);
    expect(SMS_PARSER_MAX_CONFIDENCE).toBe(90);
    // The slider range is intentionally still 70–100.
    expect(AUTO_APPROVE_THRESHOLD_MAX).toBe(100);
  });

  it('shows only in auto mode with a threshold above the parser max', () => {
    expect(shouldShowThresholdNote('auto', 91)).toBe(true);
    expect(shouldShowThresholdNote('auto', 100)).toBe(true);
    expect(shouldShowThresholdNote('auto', 90)).toBe(false);
    expect(shouldShowThresholdNote('auto', 70)).toBe(false);
  });

  it('never shows in manual mode', () => {
    expect(shouldShowThresholdNote('manual', 95)).toBe(false);
    expect(shouldShowThresholdNote('manual', 100)).toBe(false);
  });

  it('uses the clamped threshold', () => {
    expect(shouldShowThresholdNote('auto', 90.4)).toBe(false);
    expect(shouldShowThresholdNote('auto', 150)).toBe(true);
    expect(shouldShowThresholdNote('auto', Number.NaN)).toBe(false);
  });
});
