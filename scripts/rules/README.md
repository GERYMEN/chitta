# scripts/rules — SMS rules tooling

- `build_rules.js <out.json>` — generates `src/features/sms-sync/rules/rules.json` from compact templates
  (placeholders such as `{AMT}`, `{PAN}`, `{DATE:dd-MM-yy}` become capture groups; group ids are assigned automatically).
  Edit templates here, never the generated JSON.
- `validate_v2.js <rules.json>` — strict schema check + reference engine: regex compile, group ids, unique ids,
  every sample matched first by its own pattern (sort order, preprocessor, reparse), negatives (OTP, promo, collect).
- `gen_coverage.js <rules.json> <chitta-ref-app-rules.json> <compiled readSms.js> <out RULES.md>` — per-issuer comparison
  (chitta-ref-app COUNTS only) + how reader v2 does on our samples. Needs a local copy of chitta-ref-app's file and a compiled reader;
  neither is in the repo.

All patterns and samples are original and synthetic. Never paste third-party rules into the generator.

```sh
node scripts/rules/build_rules.js src/features/sms-sync/rules/rules.json
node scripts/rules/validate_v2.js src/features/sms-sync/rules/rules.json
```
