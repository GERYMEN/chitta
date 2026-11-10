/**
 * R5g T4(a) — every `samples[].expect` in rules.json is a generated jest
 * case (one describe per issuer). The TS engine must give the same result
 * as the reference engine in scripts/rules/validate_v2.js: the sample's own
 * pattern matches first (sort_UID order, preprocessors), the record count
 * (reparse) and every expected field are equal. Samples are synthetic.
 */
import bundled from '../rules.json';
import type { RulesDocument } from '../rules.types';
import { compileRules } from '../rulesLoader';
import { issuerForHeader, normalizeRuleBody, runLayer, runRulesEngine } from '../rulesEngine';

const doc = bundled as unknown as RulesDocument;
const rules = compileRules(doc);
const DATE = Date.parse('2026-11-05T06:00:00.000Z');
const layers = [...rules.issuers, ...rules.financialFallback, ...rules.anySender];

const cases = layers.map(layer => ({
  layer,
  samples: layer.def.patterns.flatMap(p =>
    (p.samples ?? []).map((s, i) => ({ uid: p.pattern_UID, i, sample: s })),
  ),
}));

const GENERATED_SAMPLE_COUNT = cases.reduce((n, c) => n + c.samples.length, 0);

it('every sample is generated (163 samples in rules v4)', () => {
  expect(GENERATED_SAMPLE_COUNT).toBe(
    doc.rules.reduce((n, r) => n + r.patterns.reduce((m, p) => m + (p.samples?.length ?? 0), 0), 0),
  );
  expect(GENERATED_SAMPLE_COUNT).toBeGreaterThanOrEqual(163);
});

describe.each(cases.map(c => [c.layer.name, c] as const))('issuer %s', (_name, { layer, samples }) => {
  it.each(samples.map(s => [`${s.uid} #${s.i + 1}`, s] as const))('%s', (_n, { uid, sample }) => {
    const run = runLayer(layer, normalizeRuleBody(sample.body), DATE, rules.blacklist);
    expect(run.blacklisted).toBe(false);
    expect(run.records.length).toBeGreaterThan(0);
    expect(run.records[0].pattern.def.pattern_UID).toBe(uid);
    const expects = sample.expect_records ?? [sample.expect ?? {}];
    expect(run.records).toHaveLength(expects.length);
    expects.forEach((want, index) => {
      for (const [key, value] of Object.entries(want)) {
        expect([key, run.records[index].fields[key]]).toEqual([key, value]);
      }
    });

    // Through the full engine with this issuer's own header (normal issuers).
    if (!layer.def.scope) {
      const header = layer.def.senders[0];
      expect(issuerForHeader(rules, header)).toBe(layer);
      const full = runRulesEngine(rules, { header, senderKind: 'known', body: sample.body, smsDate: DATE });
      expect(full.records[0]?.pattern.def.pattern_UID).toBe(uid);
    }
  });
});
