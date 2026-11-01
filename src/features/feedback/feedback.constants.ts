/**
 * R4c: the ONE place the feedback WhatsApp number lives (digits only, with
 * country code). Change it here and the jid + wa.me link follow.
 */
export const FEEDBACK_WHATSAPP_NUMBER = '919656921869';
export const FEEDBACK_WHATSAPP_JID = `${FEEDBACK_WHATSAPP_NUMBER}@s.whatsapp.net`;

export const WHATSAPP_PACKAGE = 'com.whatsapp';
export const WHATSAPP_BUSINESS_PACKAGE = 'com.whatsapp.w4b';

/** Max note length in the Share Feedback sheet. */
export const FEEDBACK_NOTE_MAX = 500;

/** Settings key (app_settings, not audited): docked side + Y of the button. */
export const FEEDBACK_POSITION_KEY = 'feedback_button_position';
