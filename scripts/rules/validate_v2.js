// Strict validator + reference engine for Tracker rules.json schema v2.
// Checks: allowed keys, regex compile, group ids within group count, unique ids, samples
// (first-match by sort_UID, preprocessors, reparse records), negatives, sender regexes.
const fs = require('fs');
const doc = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const errors = [];
const warn = [];

const TOP = new Set(['_doc', 'schema_version', 'version', 'min_app_version', 'format_status', 'blacklist_regex', 'rules']);
const ISSUER = new Set(['sender_status', 'scope', 'institution_from_body', 'name', 'full_name', 'institution_kind', 'senders', 'sender_regexes', 'preprocessor', 'misc_information', 'set_account_as_expense', 'account_name_override', '_doc', 'patterns']);
const PATTERN = new Set(['pattern_UID', 'sort_UID', 'sms_type', 'account_type', 'regex', 'flags', 'data_fields', 'samples', 'reparse', 'obsolete', 'obsolete_after', 'preprocessor', 'account_name_override', 'set_account_as_expense', 'create_txn', 'show_notification', '_doc']);
const FIELDS = new Set(['transaction_type', 'money_kind', 'statement_type', 'notice_type', 'ignore_reason', 'amount', 'pan', 'counterparty_pan', 'counterparty_name', 'pos', 'note', 'date', 'account_balance', 'outstanding_balance', 'available_limit', 'min_due_amount', 'currency', 'network_reference_id', 'transaction_type_rule', 'pos_type_rules', 'recurring_hint', 'category_hint', 'enable_chaining', 'chaining_rule', 'incomplete', 'deleted', 'event_type', 'pnr', 'event_location', 'event_info', 'event_reminder_span', 'name']);
const SMS_TYPES = new Set(['transaction', 'statement', 'notice', 'balance', 'event', 'ignore']);
const ACCT = new Set(['bank', 'credit_card', 'debit_card', 'wallet', 'prepaid', 'loan', 'pay_later', 'utility', 'insurance']);
const KINDS = new Set(['spend', 'income', 'refund', 'transfer', 'card_payment', 'atm', 'wallet_load', 'emi', 'interest']);
const MATCH = new Set(['exact', 'delta', 'value', 'none', 'same_or_alias', 'exact_if_present']);

for (const k of Object.keys(doc)) if (!TOP.has(k)) errors.push(`top: unknown key ${k}`);
if (doc.schema_version !== 2) errors.push('schema_version must be 2');
const blacklist = new RegExp(doc.blacklist_regex, 'i');
const norm = b => b.replace(/\s+/g, ' ').trim();
const pre = (body, list = []) => list.reduce((b, p) => b.replace(new RegExp(p.find, p.flags || 'gi'), p.replace), body);
const groupCount = re => new RegExp(re.source + '|').exec('').length - 1;
const ids = v => (Array.isArray(v) ? v : [v]);
const grp = (m, g) => { for (const i of ids(g)) if (m[i] != null && m[i] !== '') return m[i].trim(); return undefined; };

function extract(p, m) {
  const f = p.data_fields || {};
  const out = {};
  for (const [k, v] of Object.entries(f)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && !['pos_type_rules', 'transaction_type_rule', 'chaining_rule'].includes(k)) {
      if (v.group_id != null) {
        const val = grp(m, v.group_id);
        if (val !== undefined) out[k] = k === 'currency' ? (v.aliases?.[val.toUpperCase()] ?? val.toUpperCase()) : val;
      } else if ('value' in v) out[k] = v.value;
    } else if (typeof v === 'string' || typeof v === 'boolean') out[k] = v;
  }
  if (f.recurring_hint === true) out.recurring = true;
  if (f.pos_type_rules) {
    const txt = grp(m, f.pos_type_rules.group_id) ?? '';
    const hit = f.pos_type_rules.rules.find(r => new RegExp(r.value, 'i').test(txt));
    if (hit) out.category = hit.category;
  }
  if (f.transaction_type_rule) {
    const txt = grp(m, f.transaction_type_rule.group_id) ?? '';
    const hit = f.transaction_type_rule.rules.find(r => new RegExp(`^(?:${r.value})$`, 'i').test(txt));
    if (hit) {
      out.txn_type = hit.txn_type;
      if (hit.money_kind_override) out.money_kind = hit.money_kind_override;
      if (hit.pos_override) out.pos = hit.pos_override;
    }
  }
  return out;
}

function issuerFor(sender) {
  return doc.rules.find(r => r.senders.includes(sender)) ||
    doc.rules.find(r => (r.sender_regexes || []).some(x => new RegExp(x, 'i').test(sender)));
}

// Reference engine: returns records for one SMS (max 3 with reparse).
function run(issuer, body) {
  const ordered = issuer.patterns.filter(p => p._re).sort((a, b) => a.sort_UID - b.sort_UID);
  let text = pre(norm(body), issuer.preprocessor);
  if (blacklist.test(text)) return [{ blacklisted: true }];
  const records = [];
  for (let i = 0; i < 3; i++) {
    let hit = null, m = null;
    for (const p of ordered) {
      m = p._re.exec(pre(text, p.preprocessor));
      if (m) { hit = p; break; }
    }
    if (!hit) break;
    records.push({ p: hit, fields: extract(hit, m) });
    if (!hit.reparse) break;
    text = text.replace(m[0], ' ').trim();
  }
  return records;
}

const uids = new Set();
let patterns = 0, samples = 0;
for (const issuer of doc.rules) {
  for (const k of Object.keys(issuer)) if (!ISSUER.has(k)) errors.push(`${issuer.name}: unknown key ${k}`);
  if (!issuer.senders?.length && !issuer.scope) errors.push(`${issuer.name}: no senders`);
  if (issuer.scope && !['financial_fallback', 'any_sender'].includes(issuer.scope)) errors.push(`${issuer.name}: bad scope`);
  const sorts = new Set();
  for (const p of issuer.patterns) {
    patterns++;
    const id = p.pattern_UID;
    for (const k of Object.keys(p)) if (!PATTERN.has(k)) errors.push(`${id}: unknown key ${k}`);
    for (const k of Object.keys(p.data_fields || {})) if (!FIELDS.has(k)) errors.push(`${id}: unknown data_field ${k}`);
    if (uids.has(id)) errors.push(`duplicate pattern_UID ${id}`); uids.add(id);
    if (sorts.has(p.sort_UID)) errors.push(`${id}: duplicate sort_UID ${p.sort_UID} in ${issuer.name}`); sorts.add(p.sort_UID);
    if (!SMS_TYPES.has(p.sms_type)) errors.push(`${id}: bad sms_type`);
    if (!ACCT.has(p.account_type)) errors.push(`${id}: bad account_type ${p.account_type}`);
    const f = p.data_fields || {};
    if (f.money_kind && !KINDS.has(f.money_kind)) errors.push(`${id}: bad money_kind`);
    if (p.sms_type === 'transaction' && !f.transaction_type) errors.push(`${id}: transaction without transaction_type`);
    if (p.sms_type === 'transaction' && !f.amount) errors.push(`${id}: transaction without amount`);
    for (const sel of f.chaining_rule?.parent_selection || []) if (!MATCH.has(sel.match_type)) errors.push(`${id}: bad match_type ${sel.match_type}`);
    try { p._re = new RegExp(p.regex, p.flags); } catch (e) { errors.push(`${id}: bad regex ${e.message}`); continue; }
    const gc = groupCount(p._re);
    for (const [k, v] of Object.entries(f)) {
      if (v && typeof v === 'object' && v.group_id != null) for (const g of ids(v.group_id)) if (g < 1 || g > gc) errors.push(`${id}: ${k}.group_id ${g} > groups ${gc}`);
    }
    if (!p.samples?.length) errors.push(`${id}: no samples`);
  }
  for (const p of issuer.patterns) {
    for (const s of p.samples || []) {
      samples++;
      const recs = run(issuer, s.body);
      if (recs[0]?.blacklisted) { errors.push(`${p.pattern_UID}: sample blacklisted`); continue; }
      if (!recs.length) { errors.push(`${p.pattern_UID}: sample not matched\n    ${s.body}`); continue; }
      if (recs[0].p !== p) { errors.push(`${p.pattern_UID}: sample taken first by ${recs[0].p.pattern_UID}`); continue; }
      const expects = s.expect_records || [s.expect];
      if (recs.length !== expects.length) errors.push(`${p.pattern_UID}: ${recs.length} records, want ${expects.length}`);
      expects.forEach((exp, i) => {
        const got = recs[i]?.fields || {};
        for (const [k, want] of Object.entries(exp)) if (got[k] !== want) errors.push(`${p.pattern_UID}[${i}]: ${k} want ${JSON.stringify(want)} got ${JSON.stringify(got[k])}`);
      });
    }
  }
}

// Negatives: must be blacklisted or produce no transaction.
const NEG = [
  ['HDFCBK', '123456 is your OTP for txn of INR 2,500.00 at QA STORE on HDFC Bank card ending 9999. Do not share.', 'blacklist'],
  ['AXISBK', 'Congrats! You are eligible for a pre-approved loan of Rs 5,00,000. Apply now.', 'none'],
  ['HDFCBK', 'QA FRIEND has requested money of Rs 500 from you on UPI. On approving, money will be debited from your A/c XX1234.', 'none'],
  ['ICICIB', 'Your ICICI Bank Credit Card XX9999 limit has been increased to Rs 2,00,000.', 'none'],
  ['SBIUPI', 'Dear Customer, never share your UPI PIN or OTP with anyone. -SBI', 'blacklist'],
  ['HDFCBK', 'Pay your electricity bill on QA app and get 10% cashback up to Rs 100. T&C apply.', 'none'],
  ['AXISBK', 'Rs.500 will be debited from your A/c XX1234 on 10-11-26 towards your AutoPay for QA MUSIC.', 'none'],
  ['ICICIB', 'Dear Customer, your cheque book request has been processed and will reach you in 7 days.', 'none'],
];
for (const [sender, body, want] of NEG) {
  const layers = [issuerFor(sender), ...doc.rules.filter(r => r.scope)];
  const recs = layers.flatMap(l => { const x = run(l, body); return x.length ? [x] : []; })[0] || [];
  if (want === 'blacklist' && !recs[0]?.blacklisted) errors.push(`negative not blacklisted: ${body.slice(0, 50)}`);
  if (want === 'none' && recs.some(r => r.p && r.p.sms_type === 'transaction')) errors.push(`negative produced txn via ${recs[0].p.pattern_UID}: ${body.slice(0, 50)}`);
}
// sender_regexes check
if (!issuerFor('CNRBXY')) errors.push('sender_regexes: CNRBXY not resolved');
for (const [h, want] of [['MAHABK','bom'],['IDBIBK','idbi'],['KVBANK','kvb'],['NKGSBB','nkgsb'],['NKGSBX','nkgsb'],['SCBANK','stanc'],['BFLSMS','bajaj']]) { const i = issuerFor(h); if (i?.name !== want) errors.push(`sender ${h} → ${i?.name} want ${want}`); }
// sender_regexes must not steal headers that belong to another issuer's exact list
for (const r of doc.rules) for (const h of r.senders) { const i = issuerFor(h); if (i !== r) errors.push(`header ${h} resolves to ${i?.name}, listed under ${r.name}`); }

console.log(`issuers ${doc.rules.length}, patterns ${patterns}, samples ${samples}, negatives ${NEG.length}`);
if (warn.length) console.log('WARN:\n- ' + warn.join('\n- '));
if (errors.length) { console.log(`FAIL ${errors.length}:\n- ` + errors.join('\n- ')); process.exit(1); }
console.log('ALL OK');
