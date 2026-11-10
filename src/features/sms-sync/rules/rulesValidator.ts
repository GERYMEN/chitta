import type { RulesDocument } from './rules.types';

/**
 * R5g T1 — strict validator for a rules document (schema v2). Pure.
 *
 * Mirrors scripts/rules/validate_v2.js (structure only — samples are run by
 * the generated jest cases). Unknown keys are ERRORS in strict mode (tests,
 * CI) and WARNINGS at runtime (a newer document may carry fields this app
 * does not know yet). Messages name ids and keys only — never a sample body.
 */

const TOP = new Set([
  '_doc', 'schema_version', 'version', 'min_app_version', 'format_status', 'blacklist_regex', 'rules',
]);
const ISSUER = new Set([
  'sender_status', 'scope', 'institution_from_body', 'name', 'full_name', 'institution_kind', 'senders',
  'sender_regexes', 'preprocessor', 'misc_information', 'set_account_as_expense', 'account_name_override',
  'format_verified', '_doc', 'patterns',
]);
const PATTERN = new Set([
  'pattern_UID', 'sort_UID', 'sms_type', 'account_type', 'regex', 'flags', 'data_fields', 'samples',
  'reparse', 'obsolete', 'obsolete_after', 'preprocessor', 'account_name_override',
  'set_account_as_expense', 'create_txn', 'show_notification', '_doc',
]);
const FIELDS = new Set([
  'transaction_type', 'money_kind', 'statement_type', 'notice_type', 'ignore_reason', 'amount', 'pan',
  'counterparty_pan', 'counterparty_name', 'pos', 'note', 'date', 'account_balance',
  'outstanding_balance', 'available_limit', 'min_due_amount', 'currency', 'network_reference_id',
  'transaction_type_rule', 'pos_type_rules', 'recurring_hint', 'category_hint', 'enable_chaining',
  'chaining_rule', 'incomplete', 'deleted', 'event_type', 'pnr', 'event_location', 'event_info',
  'event_reminder_span', 'name',
]);
const SMS_TYPES = new Set(['transaction', 'statement', 'notice', 'balance', 'event', 'ignore']);
const ACCOUNT_TYPES = new Set([
  'bank', 'credit_card', 'debit_card', 'wallet', 'prepaid', 'loan', 'pay_later', 'utility', 'insurance',
]);
const MONEY_KINDS = new Set([
  'spend', 'income', 'refund', 'transfer', 'card_payment', 'atm', 'wallet_load', 'emi', 'interest',
]);
const MATCH_TYPES = new Set(['exact', 'delta', 'value', 'none', 'same_or_alias', 'exact_if_present']);
const SCOPES = new Set(['financial_fallback', 'any_sender']);
const REF_TYPES = new Set(['upi', 'imps', 'neft', 'rtgs']);
const CONTACT_TYPES = new Set(['missed_call', 'sms', 'call']);
/** Object-valued data fields that are not `{group_id}` / `{value}` refs. */
const RULE_FIELDS = new Set(['transaction_type_rule', 'pos_type_rules', 'chaining_rule']);

export interface RulesValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function groupIds(value: unknown): number[] {
  return Array.isArray(value) ? (value as number[]) : [value as number];
}

/** Number of capture groups of a compiled regex. */
export function regexGroupCount(re: RegExp): number {
  return (new RegExp(`${re.source}|`, re.flags.replace(/[gy]/g, '')).exec('')?.length ?? 1) - 1;
}

function tryRegex(source: unknown, flags: string | undefined): RegExp | string {
  if (typeof source !== 'string') return 'not a string';
  try {
    return new RegExp(source, flags);
  } catch (error) {
    return error instanceof Error ? error.message : 'invalid';
  }
}

export function validateRulesDocument(
  input: unknown,
  options: { strict?: boolean } = {},
): RulesValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const unknownKey = (where: string, key: string) =>
    (options.strict ? errors : warnings).push(`${where}: unknown key ${key}`);

  if (!isObject(input)) return { ok: false, errors: ['document is not an object'], warnings };
  const doc = input;
  for (const key of Object.keys(doc)) if (!TOP.has(key)) unknownKey('top', key);
  if (doc.schema_version !== 2) errors.push('schema_version must be 2');
  if (typeof doc.version !== 'number' || !Number.isInteger(doc.version) || doc.version < 1) {
    errors.push('version must be a positive integer');
  }
  if (typeof doc.min_app_version !== 'string' || !/^\d+(\.\d+)*/.test(doc.min_app_version)) {
    errors.push('min_app_version must be a version string');
  }
  if (doc.blacklist_regex !== undefined) {
    const re = tryRegex(doc.blacklist_regex, 'i');
    if (typeof re === 'string') errors.push(`blacklist_regex: bad regex ${re}`);
  }
  if (!Array.isArray(doc.rules)) {
    errors.push('rules must be an array');
    return { ok: false, errors, warnings };
  }

  const uids = new Set<string>();
  const names = new Set<string>();
  for (const rawIssuer of doc.rules as unknown[]) {
    if (!isObject(rawIssuer)) {
      errors.push('issuer is not an object');
      continue;
    }
    const issuer = rawIssuer;
    const name = typeof issuer.name === 'string' ? issuer.name : '?';
    if (name === '?') errors.push('issuer without name');
    if (names.has(name)) errors.push(`${name}: duplicate issuer name`);
    names.add(name);
    for (const key of Object.keys(issuer)) if (!ISSUER.has(key)) unknownKey(name, key);
    if (!Array.isArray(issuer.senders)) errors.push(`${name}: senders must be an array`);
    else if (issuer.senders.length === 0 && !issuer.scope) errors.push(`${name}: no senders`);
    if (issuer.scope !== undefined && !SCOPES.has(issuer.scope as string)) errors.push(`${name}: bad scope`);
    if (issuer.format_verified !== undefined && typeof issuer.format_verified !== 'boolean') {
      errors.push(`${name}: format_verified must be boolean`);
    }
    for (const source of (issuer.sender_regexes as unknown[] | undefined) ?? []) {
      const re = tryRegex(source, 'i');
      if (typeof re === 'string') errors.push(`${name}: bad sender_regex ${re}`);
    }
    validatePreprocessors(issuer.preprocessor, name, errors);
    validateMisc(issuer.misc_information, name, errors);
    if (!Array.isArray(issuer.patterns)) {
      errors.push(`${name}: patterns must be an array`);
      continue;
    }
    const sorts = new Set<number>();
    for (const rawPattern of issuer.patterns as unknown[]) {
      if (!isObject(rawPattern)) {
        errors.push(`${name}: pattern is not an object`);
        continue;
      }
      const p = rawPattern;
      const id = typeof p.pattern_UID === 'string' ? p.pattern_UID : '?';
      if (id === '?') errors.push(`${name}: pattern without pattern_UID`);
      for (const key of Object.keys(p)) if (!PATTERN.has(key)) unknownKey(id, key);
      if (uids.has(id)) errors.push(`duplicate pattern_UID ${id}`);
      uids.add(id);
      if (typeof p.sort_UID !== 'number') errors.push(`${id}: sort_UID must be a number`);
      else if (sorts.has(p.sort_UID)) errors.push(`${id}: duplicate sort_UID ${p.sort_UID} in ${name}`);
      else sorts.add(p.sort_UID);
      if (!SMS_TYPES.has(p.sms_type as string)) errors.push(`${id}: bad sms_type`);
      if (!ACCOUNT_TYPES.has(p.account_type as string)) errors.push(`${id}: bad account_type`);
      if (issuer.scope === 'any_sender' && p.sms_type === 'transaction') {
        errors.push(`${id}: an any_sender layer may not yield a transaction`);
      }
      if (p.obsolete_after !== undefined && typeof p.obsolete_after !== 'number') {
        errors.push(`${id}: obsolete_after must be epoch ms`);
      }
      validatePreprocessors(p.preprocessor, id, errors);
      const fields = isObject(p.data_fields) ? p.data_fields : null;
      if (!fields) {
        errors.push(`${id}: data_fields must be an object`);
        continue;
      }
      for (const key of Object.keys(fields)) if (!FIELDS.has(key)) unknownKey(`${id} data_fields`, key);
      if (fields.money_kind !== undefined && !MONEY_KINDS.has(fields.money_kind as string)) {
        errors.push(`${id}: bad money_kind`);
      }
      if (p.sms_type === 'transaction') {
        if (fields.transaction_type !== 'debit' && fields.transaction_type !== 'credit') {
          errors.push(`${id}: transaction without transaction_type`);
        }
        if (!fields.amount) errors.push(`${id}: transaction without amount`);
      }
      const re = tryRegex(p.regex, typeof p.flags === 'string' ? p.flags : undefined);
      if (typeof re === 'string') {
        errors.push(`${id}: bad regex ${re}`);
        continue;
      }
      const groups = regexGroupCount(re);
      const checkGroups = (key: string, value: unknown) => {
        for (const g of groupIds(value)) {
          if (!Number.isInteger(g) || g < 1 || g > groups) errors.push(`${id}: ${key}.group_id ${String(g)} > groups ${groups}`);
        }
      };
      for (const [key, value] of Object.entries(fields)) {
        if (!isObject(value)) continue;
        if (value.group_id != null) checkGroups(key, value.group_id);
        if (key === 'date' && value.formats !== undefined) {
          if (!Array.isArray(value.formats) || value.formats.some(f => !isObject(f) || typeof f.format !== 'string')) {
            errors.push(`${id}: bad date formats`);
          }
        }
        if (key === 'network_reference_id' && value.type_rule !== undefined) {
          const rules = isObject(value.type_rule) ? value.type_rule.rules : null;
          if (!Array.isArray(rules)) errors.push(`${id}: bad type_rule`);
          else {
            for (const rule of rules as Array<Record<string, unknown>>) {
              if (!REF_TYPES.has(rule.ref_type as string)) errors.push(`${id}: bad ref_type`);
              if (typeof tryRegex(rule.value, 'i') === 'string') errors.push(`${id}: bad type_rule regex`);
            }
          }
        }
        if (RULE_FIELDS.has(key) && key !== 'chaining_rule') {
          if (!Array.isArray(value.rules)) errors.push(`${id}: ${key}.rules must be an array`);
          else {
            for (const rule of value.rules as Array<Record<string, unknown>>) {
              if (typeof tryRegex(rule.value, 'i') === 'string') errors.push(`${id}: ${key} bad regex`);
              if (rule.acc_type_override !== undefined && !ACCOUNT_TYPES.has(rule.acc_type_override as string)) {
                errors.push(`${id}: bad acc_type_override`);
              }
              if (rule.money_kind_override !== undefined && !MONEY_KINDS.has(rule.money_kind_override as string)) {
                errors.push(`${id}: bad money_kind_override`);
              }
            }
          }
        }
      }
      const chaining = fields.chaining_rule;
      if (chaining !== undefined) {
        const selection = isObject(chaining) ? chaining.parent_selection : null;
        if (!Array.isArray(selection)) errors.push(`${id}: chaining_rule.parent_selection must be an array`);
        else {
          for (const sel of selection as Array<Record<string, unknown>>) {
            if (!MATCH_TYPES.has(sel.match_type as string)) errors.push(`${id}: bad match_type ${String(sel.match_type)}`);
            if (typeof sel.parent_field !== 'string') errors.push(`${id}: selector without parent_field`);
          }
        }
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

function validatePreprocessors(value: unknown, where: string, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${where}: preprocessor must be an array`);
    return;
  }
  for (const step of value as unknown[]) {
    if (!isObject(step) || typeof step.find !== 'string' || typeof step.replace !== 'string') {
      errors.push(`${where}: bad preprocessor step`);
      continue;
    }
    if (typeof tryRegex(step.find, (step.flags as string | undefined) ?? 'gi') === 'string') {
      errors.push(`${where}: bad preprocessor regex`);
    }
  }
}

function validateMisc(value: unknown, where: string, errors: string[]): void {
  if (value === undefined) return;
  if (!isObject(value)) {
    errors.push(`${where}: misc_information must be an object`);
    return;
  }
  const entries = value.get_balance;
  if (entries === undefined) return;
  if (!Array.isArray(entries)) {
    errors.push(`${where}: get_balance must be an array`);
    return;
  }
  for (const entry of entries as Array<Record<string, unknown>>) {
    if (!ACCOUNT_TYPES.has(entry.account_type as string)) errors.push(`${where}: get_balance bad account_type`);
    if (!Array.isArray(entry.contact_info)) {
      errors.push(`${where}: get_balance contact_info must be an array`);
      continue;
    }
    for (const contact of entry.contact_info as Array<Record<string, unknown>>) {
      if (!CONTACT_TYPES.has(contact.type as string)) errors.push(`${where}: get_balance bad contact type`);
      if (!Array.isArray(contact.numbers)) errors.push(`${where}: get_balance numbers must be an array`);
      if (typeof contact.verified !== 'boolean') errors.push(`${where}: get_balance verified must be boolean`);
    }
  }
}

/** Narrowing helper: a validated document. */
export function asRulesDocument(input: unknown): RulesDocument | null {
  return validateRulesDocument(input).ok ? (input as RulesDocument) : null;
}
