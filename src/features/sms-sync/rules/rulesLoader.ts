import bundledRules from './rules.json';
import type { RuleIssuer, RulePattern, RulePreprocessor, RulesDocument } from './rules.types';
import { validateRulesDocument } from './rulesValidator';

/**
 * R5g T1 — document picker + precompiled RegExp cache. Pure (no I/O).
 *
 * The engine accepts a rules document from any source: the bundled asset
 * (rules.json, imported as JSON) now, a stored downloaded copy later (remote
 * update is out of scope until the owner decides on INTERNET use). The
 * picker takes the highest `version` whose `min_app_version` ≤ the app
 * version; an invalid document is skipped (never thrown at runtime).
 */

export interface CompiledPreprocessor {
  re: RegExp;
  replace: string;
}

export interface CompiledPattern {
  def: RulePattern;
  re: RegExp;
  pre: CompiledPreprocessor[];
}

export interface CompiledIssuer {
  def: RuleIssuer;
  name: string;
  /** sort_UID ascending; ties keep array order. */
  patterns: CompiledPattern[];
  pre: CompiledPreprocessor[];
  senderRegexes: RegExp[];
}

export interface CompiledRules {
  version: number;
  minAppVersion: string;
  source: RulesSource;
  blacklist: RegExp | null;
  /** Normal issuers (no scope), document order. */
  issuers: CompiledIssuer[];
  bySender: ReadonlyMap<string, CompiledIssuer>;
  financialFallback: CompiledIssuer[];
  anySender: CompiledIssuer[];
  /** Runtime validator warnings (unknown keys of a newer document). */
  warnings: string[];
}

export type RulesSource = 'bundled' | 'stored' | 'test';

function compilePre(list: ReadonlyArray<RulePreprocessor> | undefined): CompiledPreprocessor[] {
  return (list ?? []).map(step => ({ re: new RegExp(step.find, step.flags ?? 'gi'), replace: step.replace }));
}

/** Compile a document (validated first; throws on an invalid one). */
export function compileRules(input: unknown, source: RulesSource = 'test'): CompiledRules {
  const validation = validateRulesDocument(input);
  if (!validation.ok) throw new Error(`invalid rules document: ${validation.errors.length} error(s)`);
  const doc = input as RulesDocument;
  const compileIssuer = (def: RuleIssuer): CompiledIssuer => ({
    def,
    name: def.name,
    pre: compilePre(def.preprocessor),
    senderRegexes: (def.sender_regexes ?? []).map(pattern => new RegExp(pattern, 'i')),
    patterns: def.patterns
      .map((p, index) => ({ p, index }))
      .sort((a, b) => a.p.sort_UID - b.p.sort_UID || a.index - b.index)
      .map(({ p }) => ({ def: p, re: new RegExp(p.regex, p.flags), pre: compilePre(p.preprocessor) })),
  });
  const issuers: CompiledIssuer[] = [];
  const financialFallback: CompiledIssuer[] = [];
  const anySender: CompiledIssuer[] = [];
  const bySender = new Map<string, CompiledIssuer>();
  for (const def of doc.rules) {
    const issuer = compileIssuer(def);
    if (def.scope === 'financial_fallback') financialFallback.push(issuer);
    else if (def.scope === 'any_sender') anySender.push(issuer);
    else {
      issuers.push(issuer);
      for (const header of def.senders) if (!bySender.has(header.toUpperCase())) bySender.set(header.toUpperCase(), issuer);
    }
  }
  return {
    version: doc.version,
    minAppVersion: doc.min_app_version,
    source,
    blacklist: doc.blacklist_regex ? new RegExp(doc.blacklist_regex, 'i') : null,
    issuers,
    bySender,
    financialFallback,
    anySender,
    warnings: validation.warnings,
  };
}

/** "0.9.0-beta" → [0, 9, 0]; compares numerically, missing parts = 0. */
export function compareAppVersions(a: string, b: string): number {
  const parts = (v: string) => (v.match(/^\d+(?:\.\d+)*/)?.[0] ?? '0').split('.').map(Number);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface RulesCandidate {
  source: RulesSource;
  doc: unknown;
}

/**
 * Item 24: the highest valid `version` whose `min_app_version` ≤ appVersion.
 * Ties keep the earlier candidate (bundled first). Null when none qualifies.
 */
export function pickRulesDocument(
  candidates: ReadonlyArray<RulesCandidate>,
  appVersion: string,
): RulesCandidate | null {
  let best: RulesCandidate | null = null;
  for (const candidate of candidates) {
    if (!validateRulesDocument(candidate.doc).ok) continue;
    const doc = candidate.doc as RulesDocument;
    if (compareAppVersions(doc.min_app_version, appVersion) > 0) continue;
    if (!best || doc.version > (best.doc as RulesDocument).version) best = candidate;
  }
  return best;
}

/** The app version used by the picker when the native value is unavailable. */
export const FALLBACK_APP_VERSION = '0.9.0';

let stored: unknown = null;
let appVersion = FALLBACK_APP_VERSION;
let active: CompiledRules | null | undefined;

/** A stored (downloaded) document — future use; picked only if newer. */
export function setStoredRulesDocument(doc: unknown): void {
  stored = doc;
  active = undefined;
}

export function setRulesAppVersion(version: string): void {
  appVersion = version || FALLBACK_APP_VERSION;
  active = undefined;
}

/** The compiled document the reader uses (lazy, cached). Null = no valid document. */
export function activeRules(): CompiledRules | null {
  if (active !== undefined) return active;
  const picked = pickRulesDocument(
    [
      { source: 'bundled', doc: bundledRules },
      ...(stored != null ? [{ source: 'stored' as const, doc: stored }] : []),
    ],
    appVersion,
  );
  active = picked ? compileRules(picked.doc, picked.source) : null;
  return active;
}

export interface RulesInfo {
  version: number;
  /** Normal issuers (generic layers excluded). */
  issuerCount: number;
}

/** T5: "SMS rules v<n> · <issuer count> banks". */
export function rulesInfo(rules: CompiledRules | null = activeRules()): RulesInfo | null {
  return rules ? { version: rules.version, issuerCount: rules.issuers.length } : null;
}

export function rulesAboutLabel(info: RulesInfo | null = rulesInfo()): string {
  return info ? `SMS rules v${info.version} · ${info.issuerCount} banks` : 'SMS rules not loaded';
}
