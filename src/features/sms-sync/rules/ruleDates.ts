import type { RuleDateFormat } from './rules.types';

/**
 * R5g item 11 — date formats of the rules document. Pure.
 *
 * Tokens: yyyy yy MMMM MMM MM dd d HH hh mm ss a, 'quoted' literals; any
 * other non-letter run is a literal (a space also matches no space). Dates
 * are read in Asia/Kolkata (UTC+05:30, no DST). A parsed date is used only
 * within [smsDate − 45 days, smsDate + 1 day]; otherwise the SMS time.
 */

export const IST_OFFSET_MS = 330 * 60 * 1000;
export const RULE_DATE_PAST_MS = 45 * 24 * 60 * 60 * 1000;
export const RULE_DATE_FUTURE_MS = 24 * 60 * 60 * 1000;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

type Token = 'yyyy' | 'yy' | 'MMMM' | 'MMM' | 'MM' | 'dd' | 'd' | 'HH' | 'hh' | 'mm' | 'ss' | 'a';

const TOKEN_RE: Record<Token, string> = {
  yyyy: '(\\d{4})',
  yy: '(\\d{2})',
  MMMM: '([a-z]{3,9})',
  MMM: '([a-z]{3,4})',
  MM: '(\\d{1,2})',
  dd: '(\\d{1,2})',
  d: '(\\d{1,2})',
  HH: '(\\d{1,2})',
  hh: '(\\d{1,2})',
  mm: '(\\d{2})',
  ss: '(\\d{2})',
  a: '(am|pm)',
};

interface CompiledFormat {
  re: RegExp;
  tokens: Token[];
}

const cache = new Map<string, CompiledFormat>();

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function compileFormat(format: string): CompiledFormat {
  const hit = cache.get(format);
  if (hit) return hit;
  const parts = format.match(/'[^']*'|yyyy|yy|MMMM|MMM|MM|dd|d|HH|hh|mm|ss|a|[^A-Za-z']+|[A-Za-z]/g) ?? [];
  const tokens: Token[] = [];
  let source = '';
  for (const part of parts) {
    if (part.startsWith("'")) source += escape(part.slice(1, -1));
    else if (part in TOKEN_RE) {
      tokens.push(part as Token);
      source += TOKEN_RE[part as Token];
    } else source += escape(part).replace(/ /g, '\\s?');
  }
  const compiled = { re: new RegExp(`^${source}$`, 'i'), tokens };
  cache.set(format, compiled);
  return compiled;
}

export interface ParsedRuleDate {
  /** Epoch ms (IST wall time converted to UTC). */
  ms: number;
  /** False for a date-only format. */
  hasTime: boolean;
}

/** Parse one date string with one format, or null. `smsDate` supplies a missing year. */
export function parseWithFormat(text: string, format: string, smsDate: number): ParsedRuleDate | null {
  const { re, tokens } = compileFormat(format);
  const m = re.exec(text.trim());
  if (!m) return null;
  const smsIst = new Date(smsDate + IST_OFFSET_MS);
  let year: number | null = null;
  let month: number | null = null;
  let day: number | null = null;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let pm: boolean | null = null;
  let hasTime = false;
  tokens.forEach((token, i) => {
    const value = m[i + 1];
    switch (token) {
      case 'yyyy':
        year = Number(value);
        break;
      case 'yy':
        year = 2000 + Number(value);
        break;
      case 'MMMM':
      case 'MMM': {
        const index = MONTHS.indexOf(value.slice(0, 3).toLowerCase());
        month = index >= 0 ? index + 1 : -1;
        break;
      }
      case 'MM':
        month = Number(value);
        break;
      case 'dd':
      case 'd':
        day = Number(value);
        break;
      case 'HH':
      case 'hh':
        hour = Number(value);
        hasTime = true;
        break;
      case 'mm':
        minute = Number(value);
        hasTime = true;
        break;
      case 'ss':
        second = Number(value);
        break;
      case 'a':
        pm = value.toLowerCase() === 'pm';
        break;
    }
  });
  if (month == null || day == null) return null;
  const mo: number = month;
  const dd: number = day;
  if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return null;
  if (pm != null) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (pm ? 12 : 0);
  }
  if (hour > 23 || minute > 59 || second > 59) return null;
  const build = (y: number) => Date.UTC(y, mo - 1, dd, hour, minute, second) - IST_OFFSET_MS;
  let y: number = year ?? smsIst.getUTCFullYear();
  let ms = build(y);
  // No year in the format: a date "after" the SMS belongs to last year.
  if (year == null && ms > smsDate + RULE_DATE_FUTURE_MS) {
    y -= 1;
    ms = build(y);
  }
  // Reject roll-overs (31-02 → 03-03).
  const check = new Date(ms + IST_OFFSET_MS);
  if (check.getUTCDate() !== dd || check.getUTCMonth() !== mo - 1) return null;
  return { ms, hasTime };
}

function sameIstDay(a: number, b: number): boolean {
  const x = new Date(a + IST_OFFSET_MS);
  const y = new Date(b + IST_OFFSET_MS);
  return (
    x.getUTCFullYear() === y.getUTCFullYear() &&
    x.getUTCMonth() === y.getUTCMonth() &&
    x.getUTCDate() === y.getUTCDate()
  );
}

/**
 * The transaction time for a rule hit. `text` is the captured date (or
 * undefined). Date-only results on the SMS's own IST day keep the SMS time
 * (more precise); other date-only days use 12:00 IST (never shifts a day in
 * any time zone the phone may show). Outside the window → SMS time.
 */
export function resolveRuleDate(
  text: string | undefined,
  formats: ReadonlyArray<RuleDateFormat> | undefined,
  smsDate: number,
  useSmsTime = false,
): number {
  if (useSmsTime || text == null || !formats || formats.length === 0) return smsDate;
  for (const f of formats) {
    if (f.format === 'immediate' || f.use_sms_time) return smsDate;
    const parsed = parseWithFormat(text, f.format, smsDate);
    if (!parsed) continue;
    if (parsed.ms < smsDate - RULE_DATE_PAST_MS || parsed.ms > smsDate + RULE_DATE_FUTURE_MS) return smsDate;
    if (parsed.hasTime) return parsed.ms;
    if (sameIstDay(parsed.ms, smsDate)) return smsDate;
    return parsed.ms + 12 * 60 * 60 * 1000;
  }
  return smsDate;
}
