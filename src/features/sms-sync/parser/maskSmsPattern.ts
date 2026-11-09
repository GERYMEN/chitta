import { parseSender } from './senders';

/**
 * R5 "Share pattern": ALLOWLIST masking of an SMS the reader did not
 * understand, so the owner can see its SHAPE without any personal data.
 *
 * Only words from a fixed banking vocabulary survive. Everything else:
 *   every other word / script run → <W> (consecutive runs collapse to one)
 *   amounts (Rs/INR/₹ + number, or decimals) → <AMT>
 *   masked account / card tails (XX1234, *1234, ending 1234) → <ACCT>
 *   digit runs of 9+ (refs, UTRs, phone numbers) → <REF>
 *   other digit runs → <N>
 *   dates → <DATE>, times → <TIME>
 *   VPAs → <VPA>, URLs → <URL>, e-mail addresses → <EMAIL>
 * The output never contains a digit (digit counts are NOT kept: a count
 * would need digits, and <ACCT> / <REF> / <N> already carry the shape).
 *
 * Sender: only the public DLT header ID (institution code) is kept, or
 * <NUMBER> for phone numbers / short codes, or <SENDER> for anything else.
 */

export const MASK_VOCABULARY: ReadonlySet<string> = new Set([
  // money movement
  'debited', 'debit', 'credited', 'credit', 'dr', 'cr', 'sent', 'received', 'paid', 'spent',
  'withdrawn', 'withdrawal', 'deposited', 'transfer', 'transferred', 'trf', 'trfd', 'deducted',
  'charged', 'purchase', 'used', 'using', 'added', 'refund', 'refunded', 'reversed', 'reversal',
  'failed', 'declined', 'successful', 'successfully', 'payment', 'pay', 'payable', 'done',
  'executed', 'scheduled', 'will', 'be', 'been', 'has', 'have', 'is', 'was', 'are', 'its',
  // accounts, cards, rails
  'a/c', 'ac', 'acct', 'account', 'card', 'cards', 'ending', 'ended', 'no', 'number', 'upi',
  'imps', 'neft', 'rtgs', 'nach', 'ecs', 'mandate', 'emandate', 'autopay', 'si', 'vpa',
  'linked', 'mobile', 'mob', 'bk', 'net', 'netbanking', 'banking', 'bank', 'wallet', 'atm',
  'pos', 'savings', 'sb', 'current', 'debitcard', 'creditcard', 'visa', 'mastercard', 'rupay',
  'p2a', 'p2m', 'p2p', 'info', 'cheque', 'chq', 'clearing', 'standing', 'instruction',
  // references, balances, dues
  'ref', 'refno', 'reference', 'utr', 'rrn', 'txn', 'trxn', 'transaction', 'id', 'avl',
  'avail', 'available', 'avlbal', 'avlbl', 'bal', 'balance', 'updated', 'limit', 'lmt',
  'amt', 'amount', 'due', 'min', 'minimum', 'total', 'outstanding', 'statement', 'bill',
  'emi', 'loan', 'charges', 'charge', 'fee', 'gst', 'tax', 'interest', 'salary', 'sal',
  'payroll', 'cash', 'otp', 'code', 'authorization', 'valid', 'mins',
  // currency
  'rs', 'inr', '₹',
  // glue words
  'on', 'to', 'from', 'by', 'via', 'with', 'for', 'of', 'in', 'at', 'the', 'an', 'and',
  'or', 'your', 'ur', 'you', 'thru', 'through', 'towards', 'as', 'after', 'into', 'if',
  'not', 'call', 'sms', 'block', 'dear', 'customer', 'user', 'please', 'pls', 'kindly',
  'thank', 'thanks', 'update', 'alert', 'date', 'time', 'value', 'now', 'here', 'click',
  'request', 'requested', 'collect', 'approving', 'approval', 'dispute', 'helpline',
  'never', 'share', 'do', 'anyone', 'it', 'this', 'that', 'we', 'our', 'ist', 'am', 'pm',
  // R5-fix C12: NO institution / brand names, NO month names, NO single
  // letters — they double as payee / merchant / person names. The institution
  // survives only as the public DLT header on the Sender line; month names
  // become <DATE>.
]);

// Sentinels (private-use code points) protect placeholders while tokenizing.
const S = '';
const E = '';
const ph = (name: string) => `${S}${name}${E}`;

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
const NUM = String.raw`\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?`;

const REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:https?:\/\/|www\.)\S+/gi, ph('URL')],
  [/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi, ph('EMAIL')],
  [/[a-z0-9._-]+@[a-z][a-z0-9]*/gi, ph('VPA')],
  [/\b[a-z0-9-]+\.(?:com|in|co|ly|me|io|net|org|example)(?:\/\S*)?/gi, ph('URL')],
  // dates: 03-11-2026, 03/11/26, 2026-11-03, 2026:11:03, 03Nov26, 03-Nov-2026, 03 November 2026
  [/\b\d{4}[-/:.]\d{1,2}[-/:.]\d{1,2}\b/g, ph('DATE')],
  [/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, ph('DATE')],
  [new RegExp(String.raw`\b\d{1,2}[-\s]?` + MONTH + String.raw`[-\s,]?\d{2,4}\b`, 'gi'), ph('DATE')],
  [/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ph('TIME')],
  // R5-fix C12: a stray month name ("Nov", "MAY") is a date part, never kept as a word.
  [/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/gi, ph('DATE')],
  // amounts
  [new RegExp(String.raw`(\brs(?![a-z])|\binr(?![a-z])|₹)\.?\s*[:.]?\s*(?:` + NUM + ')', 'gi'), `$1 ${ph('AMT')}`],
  [/\b\d+\.\d{1,2}\b/g, ph('AMT')],
  // masked account / card tails
  [/[x*]{1,8}\s*\d{3,5}\b/gi, ph('ACCT')],
  [/\.{2,}\d{4}\b/g, ph('ACCT')],
  [/\b(ending\s*(?:with\s*)?)\d{4,5}\b/gi, `$1${ph('ACCT')}`],
  // long digit runs, then the rest
  [/\d{9,}/g, ph('REF')],
  [/\d+/g, ph('N')],
];

const TOKEN = new RegExp(
  `${S}[A-Z]+${E}|[aA]\\/[cC]|[A-Za-z]+|[^\\sA-Za-z${S}${E}]`,
  'g',
);

const PUNCTUATION = new Set(Array.from('.,:;!?()-/\'"&+*#%=_[]'));
const MASK_CHARS = /^[xX*]+$/;

/**
 * R5-fix C12: the payee span. After "to / at / by / from / towards / trf" every
 * word is masked — banking words included ("to BAL <W> KOTAK" leaked before)
 * — until a rail / account / reference / glue word, a placeholder or a
 * sentence break. A span that starts with an own-account word ("to your A/c",
 * "to VPA <VPA>") is not a payee.
 */
const SPAN_START: ReadonlySet<string> = new Set(['to', 'at', 'by', 'from', 'towards', 'trf']);
const SPAN_NOT_PAYEE: ReadonlySet<string> = new Set([
  'your', 'ur', 'you', 'the', 'a/c', 'ac', 'acct', 'account', 'card', 'wallet', 'upi', 'vpa',
  'linked', 'beneficiary', 'self', 'rs', 'inr', 'sb', 'savings',
]);
/** Words that end a payee span (never 'bal' / 'cash' / 'bill' — they are also names). */
const SPAN_STOP: ReadonlySet<string> = new Set([
  'on', 'via', 'upi', 'imps', 'neft', 'rtgs', 'ref', 'refno', 'utr', 'rrn', 'a/c', 'ac', 'acct',
  'account', 'avl', 'avail', 'available', 'info', 'txn', 'transaction', 'if', 'not', 'is', 'has',
  'was', 'for', 'with', 'from', 'to', 'by', 'at', 'dated', 'card', 'using', 'thru', 'through',
  'towards', 'in', 'and', 'vpa', 'wallet',
]);
/** Punctuation that stays inside a name ("QA-SHOP", "QA & CO", "D'SOUZA"). */
const SPAN_JOINERS = new Set(['-', '&', "'", '/']);

function maskBody(body: string): string {
  let text = body;
  for (const [re, replacement] of REPLACEMENTS) text = text.replace(re, replacement);

  const out: string[] = [];
  let lastWasW = false;
  let span: 'none' | 'pending' | 'active' = 'none';
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
    const token = m[0];
    const lower = token.toLowerCase();
    const spaced = m.index > 0 && /\s/.test(text[m.index - 1]);
    const isWord = /^[A-Za-z]/.test(token) || lower === 'a/c';
    let piece: string;
    if (isWord && span !== 'none') {
      const ends = span === 'pending' ? SPAN_NOT_PAYEE.has(lower) || SPAN_STOP.has(lower) : SPAN_STOP.has(lower);
      if (!ends) {
        span = 'active';
        if (!lastWasW) out.push(out.length > 0 && spaced ? ' <W>' : '<W>');
        lastWasW = true;
        continue;
      }
      span = 'none';
    } else if (span !== 'none' && token === `${S}DATE${E}`) {
      // a month name inside a name ("MAY JUNE …") — masked, span goes on
    } else if (span !== 'none' && !(span === 'active' && SPAN_JOINERS.has(token))) {
      span = 'none';
    }
    if (span === 'active' && !token.startsWith(S)) continue; // a joiner inside a masked name
    if (token.startsWith(S)) {
      piece = `<${token.slice(1, -1)}>`;
    } else if (isWord) {
      piece = MASK_VOCABULARY.has(lower) || MASK_CHARS.test(token) ? token : '<W>';
      if (SPAN_START.has(lower)) span = 'pending';
    } else if (token === '₹') {
      piece = token;
    } else if (PUNCTUATION.has(token)) {
      piece = token;
    } else {
      // any other script / symbol run (non-Latin words, emoji) carries text
      piece = '<W>';
    }
    if (piece === '<W>' && lastWasW) continue;
    lastWasW = piece === '<W>';
    out.push(out.length > 0 && spaced ? ` ${piece}` : piece);
  }
  return out.join('').replace(/\s+/g, ' ').trim();
}

/** Sender as shown in a shared pattern: the public header ID only. */
export function maskSender(address: string | null | undefined): string {
  const sender = parseSender(address);
  if (sender.kind === 'personal') return '<NUMBER>';
  if (sender.header && /^[A-Z]{3,9}$/.test(sender.header)) return sender.header;
  if (/\d/.test(address ?? '')) return '<NUMBER>';
  return '<SENDER>';
}

export interface MaskedPattern {
  sender: string;
  text: string;
}

export function maskSmsPattern(body: string, senderAddress: string | null | undefined): MaskedPattern {
  return { sender: maskSender(senderAddress), text: maskBody(body ?? '') };
}

/** The WhatsApp message for "Share pattern" (shown to the user before sending). */
export function sharePatternMessage(input: {
  pattern: MaskedPattern;
  reasonLabel: string;
  appVersion: string;
  parserVersion: number;
}): string {
  return [
    `Tracker SMS pattern — ${input.reasonLabel} · App v${input.appVersion} · Parser v${input.parserVersion}`,
    `Sender: ${input.pattern.sender}`,
    input.pattern.text,
  ].join('\n');
}
