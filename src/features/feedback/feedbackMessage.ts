import {
  FEEDBACK_NOTE_MAX,
  FEEDBACK_WHATSAPP_NUMBER,
  WHATSAPP_BUSINESS_PACKAGE,
  WHATSAPP_PACKAGE,
} from './feedback.constants';

/**
 * R4c pure helpers for the Share Feedback sheet + WhatsApp message.
 * The message carries DEVICE INFO ONLY plus what the tester typed — never
 * transactions, amounts, merchants, SMS, the user's name or account details
 * (the builder has no parameter that could carry them).
 */
export type FeedbackCategory = 'bug' | 'idea' | 'review';

export const FEEDBACK_CATEGORIES: ReadonlyArray<{
  id: FeedbackCategory;
  label: string;
  pill: string;
}> = [
  { id: 'bug', label: 'Bug', pill: 'Bug 🪲' },
  { id: 'idea', label: 'Idea', pill: 'Idea 💡' },
  { id: 'review', label: 'Review', pill: 'Review 💬' },
];

export const DEFAULT_FEEDBACK_CATEGORY: FeedbackCategory = 'bug';

export function categoryLabel(category: FeedbackCategory): string {
  return FEEDBACK_CATEGORIES.find(c => c.id === category)?.label ?? 'Bug';
}

export interface FeedbackMessageInput {
  category: FeedbackCategory;
  note: string;
  versionName: string;
  versionCode: number;
  androidRelease: string;
  brand: string;
  model: string;
  /** Navigator route name (a fixed app identifier, e.g. "Home"). */
  routeName: string | null;
  now: Date;
}

/** "Brand Model", without repeating the brand when the model already starts with it. */
export function deviceLabel(brand: string, model: string): string {
  const b = brand.trim();
  const m = model.trim();
  if (!b) return m || 'Unknown device';
  if (!m) return b;
  return m.toLowerCase().startsWith(b.toLowerCase()) ? m : `${b} ${m}`;
}

/** Route names are fixed identifiers; anything else is dropped. */
export function safeRouteName(routeName: string | null): string {
  return routeName && /^[A-Za-z][A-Za-z0-9]*$/.test(routeName) ? routeName : 'Unknown';
}

export function versionBadge(versionName: string, versionCode: number): string {
  return `v${versionName} (${versionCode})`;
}

/**
 * "Tracker feedback — Bug\n<note>\n\n— App v1.0 (1) · Android 14 · Brand Model ·
 * Screen: Home · <ISO time>". An empty note drops its line.
 */
export function buildFeedbackMessage(input: FeedbackMessageInput): string {
  const note = clampNote(input.note).trim();
  const head = `Tracker feedback — ${categoryLabel(input.category)}`;
  const footer = [
    `— App ${versionBadge(input.versionName, input.versionCode)}`,
    `Android ${input.androidRelease || '?'}`,
    deviceLabel(input.brand, input.model),
    `Screen: ${safeRouteName(input.routeName)}`,
    input.now.toISOString(),
  ].join(' · ');
  return note ? `${head}\n${note}\n\n${footer}` : `${head}\n\n${footer}`;
}

/** wa.me fallback link (text-only, no screenshot). */
export function waMeUrl(text: string): string {
  return `https://wa.me/${FEEDBACK_WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

// ---- sheet validation -------------------------------------------------------

export function clampNote(note: string): string {
  return note.length > FEEDBACK_NOTE_MAX ? note.slice(0, FEEDBACK_NOTE_MAX) : note;
}

export function noteCounter(note: string): string {
  return `${clampNote(note).length}/${FEEDBACK_NOTE_MAX}`;
}

/**
 * Send is enabled when a note OR a category is set. The category defaults to
 * Bug, so it is always set: an empty note is allowed (the screenshot + device
 * line can be the whole report).
 */
export function canSendFeedback(input: {
  category: FeedbackCategory | null;
  note: string;
}): boolean {
  return input.category !== null || input.note.trim().length > 0;
}

// ---- share fallback chain ---------------------------------------------------

export type ShareStep =
  | { kind: 'package'; packageName: string }
  | { kind: 'waMe' }
  | { kind: 'chooser' };

/**
 * Order tried: WhatsApp → WhatsApp Business → (no screenshot) wa.me link /
 * (with screenshot) the system share chooser — wa.me cannot carry an image.
 */
export function shareFallbackChain(hasScreenshot: boolean): ShareStep[] {
  return [
    { kind: 'package', packageName: WHATSAPP_PACKAGE },
    { kind: 'package', packageName: WHATSAPP_BUSINESS_PACKAGE },
    hasScreenshot ? { kind: 'chooser' } : { kind: 'waMe' },
  ];
}

export const FEEDBACK_THANKS = 'Thanks — feedback ready in WhatsApp';
export const SCREENSHOT_CAPTION = '✓ Screenshot (auto-captured, amounts hidden)';
export const NOTE_PLACEHOLDER =
  'What happened, or what would make Tracker better? Steps to reproduce help a lot.';
