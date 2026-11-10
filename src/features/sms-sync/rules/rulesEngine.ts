import type { SenderKind } from '../parser/senders';
import type { RuleDataFields, RuleTxnTypeRuleEntry, RulePosTypeRuleEntry } from './rules.types';
import type { CompiledIssuer, CompiledPattern, CompiledPreprocessor, CompiledRules } from './rulesLoader';

/**
 * R5g T2 — the template rules engine (pure, in memory).
 *
 * Same behaviour as the reference engine in scripts/rules/validate_v2.js:
 * sender lookup (exact header, then sender_regexes), blacklist, sort order,
 * preprocessors (issuer then pattern, on a COPY of the body), reparse (max 3
 * records), field extraction and type / pos rules. Layers: the sender's
 * issuer → financial_fallback → any_sender (first layer with a hit wins).
 *
 * Privacy: the body and captured groups live only in this call's memory.
 * Nothing here logs; the raw `fields` stay in memory and are turned into
 * derived values by ruleRead.ts.
 */

export const MAX_RECORDS_PER_SMS = 3;

const RULE_OBJECT_FIELDS = new Set(['pos_type_rules', 'transaction_type_rule', 'chaining_rule']);

/** Raw extraction (identical to validate_v2.js `extract`). */
export type RuleFields = Record<string, string | boolean>;

export interface RuleRecord {
  pattern: CompiledPattern;
  /** The layer the pattern belongs to (issuer or generic layer). */
  layer: CompiledIssuer;
  fields: RuleFields;
  /** transaction_type_rule hit (acc_type_override / set_no_pos), if any. */
  typeRule: RuleTxnTypeRuleEntry | null;
  /** pos_type_rules hit (income_flag_override), if any. */
  posRule: RulePosTypeRuleEntry | null;
  /** The matched span (in memory only — ref type rule). */
  matched: string;
}

export interface RuleEngineInput {
  /** Parsed DLT header (parseSender), or null. */
  header: string | null;
  senderKind: SenderKind;
  body: string;
  /** SMS time (epoch ms) — obsolete_after. */
  smsDate: number;
}

export interface RuleEngineResult {
  /** The blacklist matched: label 'otp', no pattern was tried. */
  blacklisted: boolean;
  /** The issuer the sender resolves to (exact / sender_regexes), if any. */
  issuer: CompiledIssuer | null;
  records: RuleRecord[];
}

/** Whitespace fold (the reader's normalize, without its footer cut). */
export function normalizeRuleBody(body: string): string {
  return body.replace(/\s+/g, ' ').trim();
}

export function applyPreprocessors(text: string, steps: ReadonlyArray<CompiledPreprocessor>): string {
  return steps.reduce((acc, step) => {
    step.re.lastIndex = 0;
    return acc.replace(step.re, step.replace);
  }, text);
}

/** Items 1–2: exact header first, then sender_regexes (first issuer wins). */
export function issuerForHeader(rules: CompiledRules, header: string | null): CompiledIssuer | null {
  if (!header) return null;
  const upper = header.toUpperCase();
  const exact = rules.bySender.get(upper);
  if (exact) return exact;
  for (const issuer of rules.issuers) {
    if (issuer.senderRegexes.some(re => re.test(upper))) return issuer;
  }
  return null;
}

function groupIds(value: number | number[]): number[] {
  return Array.isArray(value) ? value : [value];
}

/** First non-empty group (trimmed). */
export function groupValue(m: RegExpExecArray, ids: number | number[] | undefined): string | undefined {
  if (ids == null) return undefined;
  for (const i of groupIds(ids)) {
    const v = m[i];
    if (v != null && v !== '') return v.trim();
  }
  return undefined;
}

function extract(
  data: RuleDataFields,
  m: RegExpExecArray,
): { fields: RuleFields; typeRule: RuleTxnTypeRuleEntry | null; posRule: RulePosTypeRuleEntry | null } {
  const out: RuleFields = {};
  for (const [key, raw] of Object.entries(data) as Array<[string, unknown]>) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && !RULE_OBJECT_FIELDS.has(key)) {
      const ref = raw as { group_id?: number | number[]; value?: string; aliases?: Record<string, string> };
      if (ref.group_id != null) {
        const v = groupValue(m, ref.group_id);
        if (v !== undefined) {
          out[key] = key === 'currency' ? ref.aliases?.[v.toUpperCase()] ?? v.toUpperCase() : v;
        }
      } else if ('value' in ref && ref.value !== undefined) out[key] = ref.value;
    } else if (typeof raw === 'string' || typeof raw === 'boolean') out[key] = raw;
  }
  if (data.recurring_hint === true) out.recurring = true;
  let posRule: RulePosTypeRuleEntry | null = null;
  if (data.pos_type_rules) {
    const text = groupValue(m, data.pos_type_rules.group_id) ?? '';
    posRule = data.pos_type_rules.rules.find(r => new RegExp(r.value, 'i').test(text)) ?? null;
    if (posRule) out.category = posRule.category;
  }
  let typeRule: RuleTxnTypeRuleEntry | null = null;
  if (data.transaction_type_rule) {
    const text = groupValue(m, data.transaction_type_rule.group_id) ?? '';
    typeRule = data.transaction_type_rule.rules.find(r => new RegExp(`^(?:${r.value})$`, 'i').test(text)) ?? null;
    if (typeRule) {
      if (typeRule.txn_type) out.txn_type = typeRule.txn_type;
      if (typeRule.money_kind_override) out.money_kind = typeRule.money_kind_override;
      if (typeRule.pos_override) out.pos = typeRule.pos_override;
    }
  }
  return { fields: out, typeRule, posRule };
}

/** Item 5: an obsolete pattern still parses old SMS, but not ones dated after obsolete_after. */
function usable(pattern: CompiledPattern, smsDate: number): boolean {
  const { obsolete, obsolete_after: after } = pattern.def;
  return !(obsolete && after != null && smsDate > after);
}

/** One layer: issuer preprocessor, sorted patterns, reparse (validate_v2.js `run`). */
export function runLayer(
  layer: CompiledIssuer,
  body: string,
  smsDate: number,
  blacklist: RegExp | null,
): { blacklisted: boolean; records: RuleRecord[] } {
  let text = applyPreprocessors(body, layer.pre);
  if (blacklist && blacklist.test(text)) return { blacklisted: true, records: [] };
  const records: RuleRecord[] = [];
  for (let i = 0; i < MAX_RECORDS_PER_SMS; i++) {
    let hit: CompiledPattern | null = null;
    let match: RegExpExecArray | null = null;
    for (const pattern of layer.patterns) {
      if (!usable(pattern, smsDate)) continue;
      pattern.re.lastIndex = 0;
      match = pattern.re.exec(applyPreprocessors(text, pattern.pre));
      if (match) {
        hit = pattern;
        break;
      }
    }
    if (!hit || !match) break;
    const { fields, typeRule, posRule } = extract(hit.def.data_fields, match);
    records.push({ pattern: hit, layer, fields, typeRule, posRule, matched: match[0] });
    if (!hit.def.reparse) break;
    text = text.replace(match[0], ' ').trim();
  }
  return { blacklisted: false, records };
}

const FINANCIAL_SENDERS: ReadonlySet<SenderKind> = new Set(['known', 'unknown_dlt']);
const ANY_SENDERS: ReadonlySet<SenderKind> = new Set(['known', 'unknown_dlt', 'other']);

/**
 * Item 25 order: the sender's issuer → financial_fallback (known issuer or
 * unknown DLT header) → any_sender (any non-personal, non-promo sender).
 * Promotional and personal senders never reach the engine.
 */
export function runRulesEngine(rules: CompiledRules, input: RuleEngineInput): RuleEngineResult {
  const issuer = issuerForHeader(rules, input.header);
  const none: RuleEngineResult = { blacklisted: false, issuer, records: [] };
  if (!ANY_SENDERS.has(input.senderKind)) return none;
  const body = normalizeRuleBody(input.body);
  if (body === '') return none;
  // Item 3: the global blacklist on the normalized body, before any pattern.
  if (rules.blacklist && rules.blacklist.test(body)) return { blacklisted: true, issuer, records: [] };
  const layers: CompiledIssuer[] = [];
  if (issuer) layers.push(issuer);
  if (issuer || FINANCIAL_SENDERS.has(input.senderKind)) layers.push(...rules.financialFallback);
  layers.push(...rules.anySender);
  for (const layer of layers) {
    const run = runLayer(layer, body, input.smsDate, rules.blacklist);
    if (run.blacklisted) return { blacklisted: true, issuer, records: [] };
    if (run.records.length > 0) return { blacklisted: false, issuer, records: run.records };
  }
  return none;
}
