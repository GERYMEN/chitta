import {
  buildFeedbackMessage,
  canSendFeedback,
  clampNote,
  deviceLabel,
  FeedbackMessageInput,
  noteCounter,
  safeRouteName,
  shareFallbackChain,
  versionBadge,
  waMeUrl,
} from '../feedbackMessage';
import {
  FEEDBACK_NOTE_MAX,
  FEEDBACK_WHATSAPP_JID,
  FEEDBACK_WHATSAPP_NUMBER,
} from '../feedback.constants';

const NOW = new Date('2026-11-01T10:20:30.000Z');

function input(overrides: Partial<FeedbackMessageInput> = {}): FeedbackMessageInput {
  return {
    category: 'bug',
    note: 'QA note: the chart overlaps',
    versionName: '1.0',
    versionCode: 1,
    androidRelease: '14',
    brand: 'QaBrand',
    model: 'QA Phone 1',
    routeName: 'Home',
    now: NOW,
    ...overrides,
  };
}

describe('feedback message builder (R4c)', () => {
  it('formats header, note and the device-only footer', () => {
    expect(buildFeedbackMessage(input())).toBe(
      'Tracker feedback — Bug\nQA note: the chart overlaps\n\n' +
        '— App v1.0 (1) · Android 14 · QaBrand QA Phone 1 · Screen: Home · 2026-11-01T10:20:30.000Z',
    );
    expect(buildFeedbackMessage(input({ category: 'idea' }))).toMatch(/^Tracker feedback — Idea\n/);
    expect(buildFeedbackMessage(input({ category: 'review' }))).toMatch(/^Tracker feedback — Review\n/);
  });

  it('an empty note drops its line; the note is trimmed and capped at 500', () => {
    expect(buildFeedbackMessage(input({ note: '   ' }))).toBe(
      'Tracker feedback — Bug\n\n— App v1.0 (1) · Android 14 · QaBrand QA Phone 1 · Screen: Home · 2026-11-01T10:20:30.000Z',
    );
    const long = 'x'.repeat(FEEDBACK_NOTE_MAX + 50);
    const message = buildFeedbackMessage(input({ note: long }));
    expect(message).toContain('x'.repeat(FEEDBACK_NOTE_MAX));
    expect(message).not.toContain('x'.repeat(FEEDBACK_NOTE_MAX + 1));
  });

  it('carries device info only — the input has no field for user data', () => {
    expect(Object.keys(input()).sort()).toEqual(
      ['androidRelease', 'brand', 'category', 'model', 'note', 'now', 'routeName', 'versionCode', 'versionName'].sort(),
    );
    const message = buildFeedbackMessage(input({ note: '' }));
    expect(message).not.toMatch(/₹/);
  });

  it('route names are fixed identifiers; anything else becomes Unknown', () => {
    expect(safeRouteName('TransactionDetail')).toBe('TransactionDetail');
    expect(safeRouteName(null)).toBe('Unknown');
    expect(safeRouteName('Home?x=1')).toBe('Unknown');
    expect(buildFeedbackMessage(input({ routeName: 'a b' }))).toContain('Screen: Unknown');
  });

  it('device label does not repeat the brand; version badge', () => {
    expect(deviceLabel('QaBrand', 'QaBrand Q1')).toBe('QaBrand Q1');
    expect(deviceLabel('QaBrand', 'Q1')).toBe('QaBrand Q1');
    expect(deviceLabel('', '')).toBe('Unknown device');
    expect(versionBadge('1.0', 1)).toBe('v1.0 (1)');
  });

  it('wa.me link url-encodes the whole text', () => {
    const text = buildFeedbackMessage(input({ note: 'a&b=c #1 ?' }));
    const url = waMeUrl(text);
    expect(url.startsWith(`https://wa.me/${FEEDBACK_WHATSAPP_NUMBER}?text=`)).toBe(true);
    const encoded = url.split('?text=')[1];
    expect(encoded).not.toMatch(/[ \n&#?]/);
    expect(decodeURIComponent(encoded)).toBe(text);
  });

  it('one phone number constant feeds the jid', () => {
    expect(FEEDBACK_WHATSAPP_JID).toBe(`${FEEDBACK_WHATSAPP_NUMBER}@s.whatsapp.net`);
  });
});

describe('feedback sheet validation (R4c)', () => {
  it('counter + clamp', () => {
    expect(noteCounter('')).toBe('0/500');
    expect(noteCounter('hello')).toBe('5/500');
    expect(noteCounter('y'.repeat(600))).toBe('500/500');
    expect(clampNote('y'.repeat(600))).toHaveLength(500);
  });

  it('send needs a note or a category (the default category counts)', () => {
    expect(canSendFeedback({ category: 'bug', note: '' })).toBe(true);
    expect(canSendFeedback({ category: null, note: 'something' })).toBe(true);
    expect(canSendFeedback({ category: null, note: '   ' })).toBe(false);
  });
});

describe('WhatsApp fallback chain (R4c)', () => {
  it('WhatsApp → Business → chooser when a screenshot is attached', () => {
    expect(shareFallbackChain(true)).toEqual([
      { kind: 'package', packageName: 'com.whatsapp' },
      { kind: 'package', packageName: 'com.whatsapp.w4b' },
      { kind: 'chooser' },
    ]);
  });

  it('WhatsApp → Business → wa.me text link without a screenshot', () => {
    expect(shareFallbackChain(false)).toEqual([
      { kind: 'package', packageName: 'com.whatsapp' },
      { kind: 'package', packageName: 'com.whatsapp.w4b' },
      { kind: 'waMe' },
    ]);
  });
});
