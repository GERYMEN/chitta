/**
 * R5 parser v2 — extraction helpers (pure, no state, no logging).
 *
 * Everything here works on an in-memory SMS body and returns derived values
 * only (amounts in paise, a direction, a payee label, a hashed reference).
 * Nothing here keeps or returns the body itself.
 */

export type Direction = 'debit' | 'credit';

export interface Span {
  start: number;
  end: number;
}

// ---- amounts -----------------------------------------------------------------

/** Indian grouping (1,00,000.00), western grouping, or plain digits; decimals optional. */
const NUM = String.raw`(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`;

/** Rs / Rs. / INR / INR. / ₹, then the number ("INR50,000.00", "Rs.250", "₹ 1,200"). */
const PREFIXED_AMOUNT = new RegExp(
  String.raw`(?:\brs(?![a-z])|\binr(?![a-z])|₹)\.?\s*[:.]?\s*` + NUM + String.raw`(?![\d,])`,
  'gi',
);

/**
 * A number with no currency prefix, bound directly to a transaction verb:
 * "debited by 100.0", "credited with 500", "paid 250 to". Not followed by a
 * date/ref continuation ("03-11", "12/10") or a letter / percent sign.
 */
const VERB_BOUND_AMOUNT = new RegExp(
  String.raw`\b(?:debited|credited|deducted|withdrawn|sent|paid|received|spent|transferred|deposited|charged)\s+(?:(?:by|with|for|of)\s+)?` +
    NUM +
    String.raw`(?![\d,]|[a-z]|\s*[\/-]\s*\d|\s*%|\s*(?:reward|bonus|loyalty)?\s*(?:points?|pts|miles|coins|credits|units|sms|minutes|mins|days|months|gb|mb)\b)`,
  'gi',
);

export type AmountRole = 'txn' | 'balance' | 'limit' | 'due' | 'min_due';

export interface AmountHit extends Span {
  minor: number;
  prefixed: boolean;
  role: AmountRole;
}

/** Keywords that make the NEXT amount in the same clause a non-transaction figure. */
const NON_TXN_KEYWORD =
  /\b(?:avl|avlbal|avlbl|avail(?:able)?|bal(?:ance)?|limit|lmt|due|outstanding|o\/s|closing|opening)\b/gi;

/** Any transaction verb (used to stop a balance keyword from swallowing a txn amount). */
const ANY_VERB =
  /\b(?:debited|credited|debit|credit|deducted|withdrawn|spent|sent|paid|received|deposited|transferred|purchase[ds]?|charged|used)\b/i;

export function toMinor(raw: string): number | null {
  const value = Math.round(parseFloat(raw.replace(/,/g, '')) * 100);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** The clause right before `index` (cut at a sentence/field break), max 48 chars. */
function clauseBefore(body: string, index: number): string {
  const window = body.slice(Math.max(0, index - 48), index);
  const breaks = [window.lastIndexOf('; '), window.lastIndexOf('! '), window.lastIndexOf('|')];
  const cut = Math.max(...breaks);
  return cut >= 0 ? window.slice(cut + 1) : window;
}

function roleFor(body: string, index: number): AmountRole {
  const clause = clauseBefore(body, index);
  let last: RegExpExecArray | null = null;
  NON_TXN_KEYWORD.lastIndex = 0;
  for (let m = NON_TXN_KEYWORD.exec(clause); m; m = NON_TXN_KEYWORD.exec(clause)) last = m;
  if (!last) return 'txn';
  // "Available credit Rs 10,000" / "avl credit limit" — 'credit' is part of the keyword.
  const after = clause.slice(last.index + last[0].length).replace(/^\W*credit\b/i, ' ');
  // "balance Rs 1000 after debit of Rs 500" — a verb after the keyword frees the amount;
  // so does another figure in between (the keyword belonged to that one).
  if (ANY_VERB.test(after) || /(?:\brs(?![a-z])|\binr(?![a-z])|₹)/i.test(after)) return 'txn';
  const keyword = last[0].toLowerCase();
  if (keyword === 'limit' || keyword === 'lmt') return 'limit';
  if (keyword === 'due' || keyword === 'outstanding' || keyword === 'o/s') {
    const lead = clause.slice(0, last.index).split(/[,;]|\d/).pop() ?? '';
    return /\bmin(?:imum)?\b/i.test(lead) ? 'min_due' : 'due';
  }
  return 'balance';
}

/** Every amount in the body with its role, in order of appearance. */
export function findAmounts(body: string): AmountHit[] {
  const hits: AmountHit[] = [];
  PREFIXED_AMOUNT.lastIndex = 0;
  for (let m = PREFIXED_AMOUNT.exec(body); m; m = PREFIXED_AMOUNT.exec(body)) {
    const minor = toMinor(m[1]);
    if (minor == null) continue;
    hits.push({ start: m.index, end: m.index + m[0].length, minor, prefixed: true, role: roleFor(body, m.index) });
  }
  VERB_BOUND_AMOUNT.lastIndex = 0;
  for (let m = VERB_BOUND_AMOUNT.exec(body); m; m = VERB_BOUND_AMOUNT.exec(body)) {
    const minor = toMinor(m[1]);
    if (minor == null) continue;
    const start = m.index + m[0].length - m[1].length;
    const end = m.index + m[0].length;
    if (hits.some(h => start < h.end && end > h.start)) continue; // already a prefixed hit
    hits.push({ start, end, minor, prefixed: false, role: 'txn' });
  }
  return hits.sort((a, b) => a.start - b.start);
}

// ---- verbs -------------------------------------------------------------------

export interface VerbHit extends Span {
  direction: Direction;
  /** Weak verbs ("Dr", "Cr", "received") lose ties to strong ones. */
  weak: boolean;
}

interface VerbRule {
  re: RegExp;
  direction: Direction | ((body: string, end: number) => Direction);
  weak?: boolean;
}

/** "transferred to your a/c" is money in; any other transfer is money out. */
function transferDirection(body: string, end: number): Direction {
  return /^\s*(?:to|into|in)\s+(?:your|ur)\b/i.test(body.slice(end, end + 16)) ? 'credit' : 'debit';
}

const VERB_RULES: ReadonlyArray<VerbRule> = [
  { re: /\bdebited\b/gi, direction: 'debit' },
  { re: /\bdebit(?!\s*card)(?:ed)?\b/gi, direction: 'debit' },
  { re: /\bdeducted\b/gi, direction: 'debit' },
  { re: /\bwithdrawn\b|\bwithdrawal\b|\bwithdrew\b/gi, direction: 'debit' },
  { re: /\bspent\b/gi, direction: 'debit' },
  { re: /\bpurchase[ds]?\b/gi, direction: 'debit' },
  { re: /\bcharged\b/gi, direction: 'debit' },
  { re: /\bsent\b/gi, direction: 'debit' },
  // "paid by QA PAYEE" names the payer of a credit — not a debit verb.
  { re: /\bpaid\b(?!\s+by\b)/gi, direction: 'debit' },
  { re: /\bused\s+(?:for|at)\b/gi, direction: 'debit' },
  // "Thank you for using your … Card ending 1234 for Rs 500 at …"
  { re: /\busing\b(?=[^.]{0,40}\bcard\b)/gi, direction: 'debit', weak: true },
  // "Txn of Rs 500 on your card …" (no other verb)
  { re: /\b(?:txn|transaction)\s+(?:of|for)\b/gi, direction: 'debit', weak: true },
  // "Txn Rs.500.00 On HDFC Bank Card 1234 At …" (HDFC card format)
  { re: /\btxn\b(?=\s*(?:rs\b|rs\.|inr\b|₹))/gi, direction: 'debit', weak: true },
  { re: /\btransferred\b|\btrfd?\b/gi, direction: transferDirection },
  { re: /\bdr\b/gi, direction: 'debit', weak: true },
  { re: /\bcredited\b/gi, direction: 'credit' },
  { re: /\bcredit(?!\s*(?:card|limit|lmt|score))\b/gi, direction: 'credit' },
  { re: /\bdeposited\b/gi, direction: 'credit' },
  { re: /\breversed\b|\brefunded\b/gi, direction: 'credit' },
  { re: /\breceived\b/gi, direction: 'credit', weak: true },
  { re: /\badded\s+to\b/gi, direction: 'credit' },
  { re: /\bcr\b/gi, direction: 'credit', weak: true },
];

const AVAILABLE_BEFORE = /\b(?:avl|avail(?:able)?|unused|remaining)\.?\s*$/i;

export function findVerbs(body: string): VerbHit[] {
  const hits: VerbHit[] = [];
  for (const rule of VERB_RULES) {
    rule.re.lastIndex = 0;
    for (let m = rule.re.exec(body); m; m = rule.re.exec(body)) {
      const end = m.index + m[0].length;
      const direction = typeof rule.direction === 'function' ? rule.direction(body, end) : rule.direction;
      if (hits.some(h => h.start === m!.index)) continue; // "debited" matched by two rules
      // U4: "available credit" / "avl credit limit" is a figure, not a credit.
      if (direction === 'credit' && /^credit$/i.test(m[0]) && AVAILABLE_BEFORE.test(body.slice(Math.max(0, m.index - 12), m.index))) {
        continue;
      }
      hits.push({ start: m.index, end, direction, weak: rule.weak ?? false });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

export function spanDistance(a: Span, b: Span): number {
  if (a.end <= b.start) return b.start - a.end;
  if (b.end <= a.start) return a.start - b.end;
  return 0;
}

const WEAK_PENALTY = 15;

/** Distance from a verb to an amount, with weak verbs pushed back. */
function verbScore(verb: VerbHit, amount: Span): number {
  return spanDistance(verb, amount) + (verb.weak ? WEAK_PENALTY : 0);
}

export interface BoundTxn {
  amount: AmountHit;
  verb: VerbHit;
  /** Characters between verb and amount (0 = adjacent). */
  distance: number;
}

/**
 * The transaction amount = the txn-role amount closest to a verb; its
 * direction = the verb nearest to THAT amount (not any verb anywhere).
 */
export function bindTransaction(amounts: AmountHit[], verbs: VerbHit[]): BoundTxn | null {
  let best: BoundTxn | null = null;
  let bestScore = Infinity;
  for (const amount of amounts) {
    if (amount.role !== 'txn') continue;
    for (const verb of verbs) {
      const score = verbScore(verb, amount);
      if (score < bestScore) {
        bestScore = score;
        best = { amount, verb, distance: spanDistance(verb, amount) };
      }
    }
  }
  return best;
}

// ---- payee -------------------------------------------------------------------

const VPA = String.raw`([a-z0-9][a-z0-9.\-_]{1,60}@[a-z][a-z0-9]{1,30})`;
const VPA_RE = new RegExp(VPA, 'i');

/** Words that end a captured payee phrase. */
const PAYEE_STOP =
  /\s+(?:on|ref|refno|ref\.|upi|imps|neft|rtgs|avl|avail|available|bal|balance|if|not|call|via|using|info|date|dated|txn|transaction|for|with|thru|through|a\/c|ac|acct|account|at|from|to|by|is|has|was|and|in|value|sms|card|towards|clear|total)(?=\W|$)|\s+-/i;

/** First words that mean the capture is not a payee. */
const PAYEE_NOISE = new Set([
  'your', 'ur', 'a', 'an', 'the', 'my', 'a/c', 'ac', 'acct', 'account', 'vpa', 'upi',
  'bank', 'card', 'rs', 'inr', 'mobile', 'beneficiary', 'linked', 'self', 'you', 'this',
  'available', 'avl', 'balance', 'bal', 'on', 'in', 'with', 'atm', 'imps', 'neft', 'rtgs',
  'net', 'netbanking', 'branch', 'cash', 'wallet', 'pos', 'ecs', 'nach', 'si', 'mob',
  // U7: fallbacks that captured a verb / date / reference word, never a payee.
  'be', 'is', 'are', 'was', 'will', 'been', 'being', 'has', 'have', 'date', 'dated', 'dt',
  'ref', 'refno', 'ref.', 'reference', 'txn', 'transaction', 'utr', 'rrn', 'info', 'value',
  'debited', 'credited', 'debit', 'credit', 'and', 'for', 'to', 'from', 'by', 'at',
]);

const MONTH_START = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:\s*\d|$)/i;

const INFO_TOKENS = new Set([
  'UPI', 'IMPS', 'NEFT', 'RTGS', 'P2A', 'P2M', 'P2P', 'DR', 'CR', 'MB', 'BIL', 'ONL',
  'POS', 'ATM', 'ECS', 'NACH', 'MMT', 'INB', 'BBPS', 'SAL', 'SALARY', 'PAYMENT', 'NA',
]);

function letterCount(text: string): number {
  return (text.match(/[A-Za-z]/g) ?? []).length;
}

/** Trim, cut at stop words, drop long digit runs (phone numbers), reject noise. */
export function cleanPayee(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let text = raw.replace(/\s+/g, ' ').trim();
  // A glued next sentence ("QA PAYEE.Avl Bal") or a rail remark ("LTD-SALARY OCT").
  text = text.split(/\.(?=[A-Z][a-z])|-(?=(?:sal|salary|neft|imps|upi|ref)\b)/i)[0];
  text = text.split(PAYEE_STOP)[0];
  text = text.split(/\.\s|\.$|\(|\)|;|,|:|\|/)[0];
  text = text.replace(/\d{5,}/g, ' ').replace(/\s+/g, ' ');
  text = text.replace(/^[\s.\-_/*#]+|[\s.\-_/*#]+$/g, '').trim();
  if (text.length > 40) text = text.slice(0, 40).trim();
  if (letterCount(text) < 2) return null;
  if (/^[x*]+\d*$/i.test(text)) return null;
  const first = text.split(' ')[0].toLowerCase();
  if (PAYEE_NOISE.has(first)) return null;
  // "Nov 01", "01Nov26", "date 01Nov26" — a date, not a payee.
  if (MONTH_START.test(text) || /^\d/.test(text) || /\b\d{1,2}[a-z]{3}\d{2,4}\b/i.test(text)) return null;
  return text;
}

/** A VPA is a usable payee only if its local part is not a phone number. */
export function cleanVpa(vpa: string | null | undefined): string | null {
  if (!vpa) return null;
  const local = vpa.split('@')[0];
  if (/\d{5,}/.test(local) || letterCount(local) < 2) return null;
  return vpa.toLowerCase();
}

function payeeFromSegment(segment: string): string | null {
  if (!segment || INFO_TOKENS.has(segment.toUpperCase())) return null;
  const vpa = VPA_RE.exec(segment);
  if (vpa) return cleanVpa(vpa[1]);
  return cleanPayee(segment);
}

/** "Info: UPI/P2A/000000000001/QA PAYEE" or "Info: UPI-000000000001-QA PAYEE". */
function payeeFromInfo(body: string): string | null {
  const m = /\binfo\s*[:-]?\s*([^\s].{2,90})/i.exec(body);
  if (!m) return null;
  const tail = m[1].split(/\.\s|\s+avl\b|\s+avail|\s+bal\b/i)[0];
  const segments = tail.split(/[/*]|-(?!\w+@)/).map(s => s.trim()).filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    const payee = payeeFromSegment(segments[i]);
    if (payee) return payee;
  }
  return null;
}

/** "UPI/P2A/000000000001/QA PAYEE" anywhere in the body. */
function payeeFromUpiSlashTail(body: string): string | null {
  const m = /\bupi\/(?:p2[amp]\/|[a-z]{2}\/)?\d{6,}\/([^/]{2,60})/i.exec(body);
  return m ? payeeFromSegment(m[1].split(/\.\s/)[0]) : null;
}

/** "NEFT-QAEMP0000000001-QA EMPLOYER PVT LTD-SALARY OCT" → "QA EMPLOYER PVT LTD". */
function payeeFromRailTail(body: string): string | null {
  const m = /\b(?:neft|imps|rtgs)\b(?:\s*(?:cr|dr))?\s*[-:/]\s*([^\s].{2,90})/i.exec(body);
  if (!m) return null;
  const segments = m[1].split(/\s*-\s*|\//).map(s => s.trim());
  for (const segment of segments) {
    if (!segment || INFO_TOKENS.has(segment.toUpperCase())) continue;
    if (/\d{4,}/.test(segment) && !/\s/.test(segment)) continue; // the UTR / ref segment
    const clean = cleanPayee(segment);
    if (clean) return clean;
  }
  return null;
}

function firstPayee(body: string, patterns: ReadonlyArray<RegExp>): string | null {
  for (const re of patterns) {
    const m = re.exec(body);
    if (!m) continue;
    const captured = m[1];
    const vpa = VPA_RE.exec(captured);
    if (vpa && vpa.index === 0) {
      const clean = cleanVpa(vpa[1]);
      if (clean) return clean;
      continue;
    }
    const clean = cleanPayee(captured);
    if (clean) return clean;
  }
  return null;
}

/** A payee phrase starts with a letter (digits = a phone number / account). */
const NAME = String.raw`([A-Za-z][^\n]{1,60})`;
const NOT_OWN = String.raw`(?!your\b|ur\b|a\/?c\b|acct?\b|account\b)`;

const DEBIT_PAYEE: ReadonlyArray<RegExp> = [
  new RegExp(String.raw`\btrf\s+to\s+` + NAME, 'i'),
  new RegExp(String.raw`\b(?:to|towards)\s+vpa\s+` + VPA, 'i'),
  new RegExp(String.raw`\bat\s+` + NAME, 'i'),
  new RegExp(String.raw`\bto\s+` + NOT_OWN + NAME, 'i'),
  // "…debited for Rs 250.00 on 03-Nov-26; QA PAYEE credited."
  /;\s*([A-Za-z][^;.]{1,40}?)\s+credited\b/i,
  // "…spent using … Card XX1234 on 03-Nov-26 on QA STORE."
  new RegExp(String.raw`\bon\s+(?!your\b)` + NAME, 'i'),
];

const CREDIT_PAYEE: ReadonlyArray<RegExp> = [
  new RegExp(String.raw`\bby\s+(?:a\/c\s+linked\s+to\s+)?vpa\s+` + VPA, 'i'),
  new RegExp(String.raw`\bfrom\s+vpa\s+` + VPA, 'i'),
  new RegExp(String.raw`\bfrom\s+` + NOT_OWN + NAME, 'i'),
  new RegExp(String.raw`\bpaid\s+by\s+` + NAME, 'i'),
  new RegExp(String.raw`\bby\s+(?!rs|inr|upi\b|neft\b|imps\b|rtgs\b|a\/c\b|mob\b|net\s*banking)` + NAME, 'i'),
];

/** Best payee/merchant label for a transaction, or null. Never digits-heavy. */
/**
 * U6: a cash withdrawal at an ATM — not "ATM card" / "ATM cum Debit Card"
 * wording on a shop purchase.
 */
export function isAtmCashWithdrawal(body: string): boolean {
  if (!/\batm\b/i.test(body)) return false;
  // "withdrawn … using ATM card at QA0001" — a withdrawal verb settles it.
  if (/\bwithdr[ae]w|\bwithdrawn\b|\bwithdrawal\b|\bcash\b/i.test(body)) return true;
  // Otherwise an ATM machine mention (not "ATM card" / "ATM cum Debit Card")
  // and no purchase / POS wording.
  const atmMachine = /\batm\b(?!\s*(?:card|cum\b|\/\s*debit|-\s*cum\b|pin\b))/i;
  return atmMachine.test(body) && !/\b(?:purchase[ds]?|spent|pos)\b/i.test(body);
}

export function extractPayee(body: string, direction: Direction): string | null {
  if (direction === 'debit' && isAtmCashWithdrawal(body)) return 'ATM Withdrawal';
  const slash = payeeFromUpiSlashTail(body);
  if (slash) return slash;
  if (direction === 'credit') {
    return payeeFromRailTail(body) ?? firstPayee(body, CREDIT_PAYEE) ?? payeeFromInfo(body);
  }
  return payeeFromInfo(body) ?? firstPayee(body, DEBIT_PAYEE) ?? payeeFromRailTail(body);
}

// ---- reference ----------------------------------------------------------------

const REF_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:upi\s*)?(?:ref(?:erence)?|utr|rrn|txn\s*id|transaction\s*id)\s*(?:no|num|number|id|#)?\.?\s*[:\-.]?\s*([a-z0-9]{6,24})\b/i,
  /\bupi\/(?:[a-z0-9]{2,4}\/)?(\d{9,})/i,
  /\b(?:neft|imps|rtgs)\s*[-:/]\s*([a-z0-9]{8,24})\b/i,
];

/** The UPI/IMPS/NEFT reference, if any (in memory only — callers hash it). */
export function extractReference(body: string): string | null {
  for (const re of REF_PATTERNS) {
    const m = re.exec(body);
    if (m && /\d/.test(m[1])) return m[1].toUpperCase();
  }
  return null;
}

/** FNV-1a 32-bit, hex. A one-way digest so the raw reference is never kept. */
export function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    // eslint-disable-next-line no-bitwise -- FNV-1a is defined on bits
    hash ^= text.charCodeAt(i);
    // eslint-disable-next-line no-bitwise -- unsigned 32-bit wrap
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// ---- salary ------------------------------------------------------------------

/**
 * SAL / SALARY / PAYROLL as whole words, not "salary account" (an account
 * name — any money into it would look like salary otherwise).
 */
const SALARY_RE = /\b(?:sal|salary|salaries|payroll)\b(?!\s*(?:a\/?c|account|acct)\b)/i;

export function hasSalaryToken(body: string): boolean {
  // U5: a VPA / e-mail ("qa.sal@okqa") is an address, not a salary remark.
  return SALARY_RE.test(body.replace(/\S+@\S+/g, ' '));
}
