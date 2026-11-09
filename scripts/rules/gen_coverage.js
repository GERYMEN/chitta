// Builds RULES.md: field reference + per-issuer comparison with chitta-ref-app (COUNTS ONLY from chitta-ref-app's file,
// no regex/sample text is copied) + how Tracker's reader v2 does on our samples.
const fs = require('fs');
const path = require('path');
const [ours, refAppPath, readerPath, outPath] = process.argv.slice(2);
const doc = JSON.parse(fs.readFileSync(ours, 'utf8'));
const refApp = JSON.parse(fs.readFileSync(refAppPath, 'utf8')).rules;
const { readSmsMessage } = require(readerPath);

const W_NAME = {
  hdfc: 'HDFC', icici: 'ICICI', sbi: 'SBI', axis: 'Axis', kotak: 'Kotak', paytm: 'PAYTM', amazonpay: 'Amazon Pay',
  indusind: 'Indus', idfc: 'IDFC', yes: 'YesBank', federal: 'Federal Bk', union: 'Union Bank', rbl: 'RBLBANK',
  airtel: 'Airtel Money', bob: 'BOB', canara: 'Canara', pnb: 'PNB', dbs: 'DBS', au: 'AU Bank', indian: 'Indian Bnk',
  boi: 'BOI', bandhan: 'Bandhan', sib: 'South Indian', central: 'CNTRLBK', iob: 'IOB', csb: 'CSB', kgb: null,
  amex: 'AmEx', onecard: null,
  bom: 'BOM', idbi: 'IDBI', kvb: 'KVB', cub: 'CUB', tmb: 'TMB', jkb: 'J&K Bank', kbl: 'Karnataka Bank', saraswat: 'Saraswat Bank',
  equitas: 'Equitas', svc: 'SVC Bank', fino: 'Fino', psb: 'PSB', nkgsb: 'NKGSB', ujjivan: 'Ujjivan', uco: 'UCO', hsbc: 'HSBC',
  stanc: 'StanC', ippb: 'India Post', jio: 'JioMoney', bajaj: 'Bajaj Finserv',
};
const findW = (canon, full) => {
  const n = W_NAME[canon];
  return refApp.find(r => r.name === n) ||
    refApp.find(r => r.full_name && full && r.full_name.toLowerCase().includes(full.toLowerCase().split(' ')[0]) && r.full_name.toLowerCase().includes(full.toLowerCase().split(' ').slice(-1)[0]));
};

// Family classification by keywords (counts only).
const FAM = [
  ['UPI', /upi|vpa/i], ['NEFT/IMPS/RTGS', /neft|imps|rtgs/i], ['ATM/cash', /atm|withdr|cash/i],
  ['card spend', /card|pos\b/i], ['EMI/loan', /emi|loan/i], ['refund/reversal', /refund|revers/i],
  ['cheque', /chq|cheque|cts/i], ['salary/interest', /sal|interest/i],
];
function famOf(re, f) {
  const hits = FAM.filter(([, rx]) => rx.test(re)).map(([n]) => n);
  return hits.length ? hits : ['other'];
}
function refAppStats(w) {
  const act = w.patterns.filter(p => !p.obsolete);
  const c = (fn) => act.filter(fn).length;
  const fam = {};
  for (const p of act.filter(p => p.sms_type === 'transaction')) for (const f of famOf(p.regex)) fam[f] = (fam[f] || 0) + 1;
  const acct = {};
  for (const p of act) acct[p.account_type] = (acct[p.account_type] || 0) + 1;
  return {
    active: act.length, obsolete: w.patterns.length - act.length, senders: w.senders.length,
    txn: c(p => p.sms_type === 'transaction'), stmt: c(p => p.sms_type === 'statement'), event: c(p => p.sms_type === 'event'),
    balance: c(p => p.data_fields && 'account_balance' in p.data_fields), chaining: c(p => p.data_fields?.enable_chaining),
    ref: c(p => p.data_fields && 'network_reference_id' in p.data_fields),
    acct, fam,
  };
}
function oursStats(r) {
  const fam = {};
  const kinds = {};
  for (const p of r.patterns) {
    if (p.sms_type === 'transaction') {
      const k = p.data_fields.money_kind; kinds[k] = (kinds[k] || 0) + 1;
      const lbl = { spend: p.account_type === 'credit_card' ? 'card spend' : 'debit', income: 'credit', refund: 'refund/reversal', transfer: 'own transfer', card_payment: 'card payment', atm: 'ATM/cash', wallet_load: 'wallet top-up', emi: 'EMI/loan', interest: 'salary/interest' }[k] || k;
      fam[lbl] = (fam[lbl] || 0) + 1;
    } else fam[p.sms_type] = (fam[p.sms_type] || 0) + 1;
  }
  return { n: r.patterns.length, fam, logic: [
    r.patterns.some(p => p.data_fields.enable_chaining) && 'chaining',
    r.patterns.some(p => p.reparse) && 'reparse',
    (r.preprocessor || r.patterns.some(p => p.preprocessor)) && 'preprocessor',
    r.sender_regexes && 'sender_regexes',
    r.patterns.some(p => p.obsolete) && 'obsolete',
    r.patterns.some(p => p.data_fields.transaction_type_rule) && 'type rules',
    r.patterns.some(p => p.data_fields.pos_type_rules) && 'merchant rules',
    r.patterns.some(p => p.data_fields.currency) && 'currency',
    r.set_account_as_expense && 'account-as-expense',
  ].filter(Boolean) };
}
// Reader v2 on our samples: does it already get amount + last4 + direction right?
function readerCheck(r) {
  let ok = 0, tot = 0;
  const misses = [];
  for (const p of r.patterns) {
    if (p.sms_type !== 'transaction') continue;
    for (const s of p.samples) {
      const exp = (s.expect_records || [s.expect])[0];
      if (!exp.amount) continue;
      tot++;
      const res = readSmsMessage({ id: '1', address: r.senders[0] ? `VM-${r.senders[0]}-S` : 'VM-QABANK-S', body: s.body, date: Date.parse('2026-11-05T10:00:00+05:30') });
      const t = res.transaction;
      const wantDir = p.data_fields.transaction_type === 'credit' ? 'income' : 'expense';
      const wantAmt = Math.round(parseFloat(exp.amount.replace(/,/g, '')) * 100);
      const pan = exp.pan && /^\d{4}$/.test(exp.pan) ? exp.pan : null;
      const good = t && t.amountMinor === wantAmt && t.type === wantDir && (!pan || t.lastFour === pan);
      const meaning = ['card_payment', 'atm', 'wallet_load', 'transfer', 'emi', 'refund'].includes(p.data_fields.money_kind);
      if (good && !meaning) ok++;
      else misses.push(`${p.pattern_UID}: ${!t ? res.label : !good ? `${t.type} ${t.amountMinor / 100} last4=${t.lastFour ?? '-'}` : `parsed, but meaning '${p.data_fields.money_kind}' needs the rule`}`);
    }
  }
  return { ok, tot, misses };
}
const fmt = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || '—';

let md = `# SMS rules (rules.json) — reference and chitta-ref-app comparison

Generated ${new Date().toISOString().slice(0, 10)} by \`scripts/rules/gen_coverage.js\`. Do not edit by hand.

## What this is

- **Overlay, not replacement.** The R5g engine tries these templates first; no match falls back to reader v2 (\`parser/readSms.ts\`).
- **Original content.** The format mirrors the chitta-ref-app rule *anatomy* (issuer → senders → patterns → data_fields with
  capture-group ids). Every regex, id and sample is written from scratch against synthetic bodies (QA names, XX1234).
  chitta-ref-app numbers below are **counts only**, taken to explain coverage; no chitta-ref-app regex, sample or id is in this repo.
- **Formats are unverified** (\`format_status: synthetic-unverified\`): best-effort public shapes. Each pattern must be
  confirmed or corrected from tester "Share pattern" reports before it is trusted for auto-approve.

## chitta-ref-app logic → this schema (implemented by R5g)

| chitta-ref-app concept | Here | What it does |
|---|---|---|
| sender list per issuer | \`senders\` | DLT header IDs (after stripping \`AX-\`/\`-S\`) select the issuer |
| sender regexes | \`sender_regexes\` | new header variants without a code change (demo: Canara) |
| OTP blacklist | \`blacklist_regex\` | OTP / PIN / CVV texts never parse |
| pattern order | \`sort_UID\` | first match wins; specific forms (reversal, card payment, EMI) sort before generic debits |
| obsolete | \`obsolete\` (+ \`obsolete_after\`) | retired wording still parses old SMS in a re-scan (demo: HDFC) |
| preProcessor | \`preprocessor\` | fix glued text before matching (demo: BOB \`AvlBal:Rs5,650\`) |
| reparse | \`reparse\` | one SMS → several records (demo: ICICI ATM + fee) |
| sms_type | transaction / statement / notice / balance / event / ignore | bills, mandates, balance-only and failed SMS never become spending |
| account_type | bank / credit_card / debit_card / wallet / … | debit_card resolves to the bank a/c via R5d aliases |
| data_fields + group_id | amount, pan, pos, note, date, account_balance, available_limit, min_due_amount, currency, network_reference_id, counterparty_pan | capture group → field |
| date formats / use_sms_time | \`date.formats\` | body date when plausible, else SMS time |
| transaction_type_rule | \`transaction_type_rule\` (+ pos_override, set_no_pos, money_kind_override) | e.g. rail "Mob Bk" → net banking; "ATM" → cash; P2A → person |
| pos_type_rules | \`pos_type_rules\` (+ income_flag_override) | e.g. "SALARY" → salary category; "refund" → not income |
| network reference type | \`network_reference_id.type_rule\` | UPI / IMPS / NEFT / RTGS ref kind for refund + duplicate rankers |
| chaining (incomplete / deleted, parent/child override) | \`chaining_rule\` | duplicate alerts, reversal → original, card payment bank ↔ card — **suggestions only** in Tracker |
| account name override / set_account_as_expense | same names | display name in New accounts found; wallets: loads are transfers, spends are expenses |
| misc_information.get_balance | same | "Check balance" numbers (shown only when \`verified\`) |
| version / min_app_version | same | newest compatible document wins (bundled now, downloaded later) |
| *(Tracker only)* money_kind | spend · income · refund · transfer · card_payment · atm · wallet_load · emi · interest | the money **meaning** chitta-ref-app spreads over categories and account types |

## Totals

`;
const rows = [];
let wTot = 0, oTot = 0, rOk = 0, rTot = 0;
const per = [];
for (const r of doc.rules) {
  const w = findW(r.name, r.full_name);
  const ws = w ? refAppStats(w) : null;
  const os = oursStats(r);
  const rc = readerCheck(r);
  wTot += ws?.active || 0; oTot += os.n; rOk += rc.ok; rTot += rc.tot;
  rows.push(`| ${r.full_name} | ${ws ? ws.active : '—'} | ${ws ? `${ws.txn}/${ws.stmt}/${ws.event}` : '—'} | ${os.n} | ${rc.ok}/${rc.tot} |`);
  per.push({ r, w, ws, os, rc });
}
md += `- Issuers: **${doc.rules.filter(r => !r.scope).length}** (${doc.rules.filter(r => !r.scope && !r.sender_status).length} from \`parser/senders.ts\` + ${doc.rules.filter(r => r.sender_status).length} live banks added 2026-11-09 — add their headers/aliases to senders.ts in R5g) + **${doc.rules.filter(r => r.scope).length}** generic layers (any bank, any biller). Patterns: **${oTot}** here vs **${wTot}** active in chitta-ref-app for the same issuers.
- Reader v2 alone on our transaction samples: **${rOk}/${rTot}** fully right (amount + direction + last-4 **and** plain spend/income meaning).
  The rest is what the rules add (money meaning, 3-digit/long masks, wallet direction, reversal, currency).

| Issuer | chitta-ref-app active | chitta-ref-app txn/stmt/event | Ours | Reader v2 alone |
|---|--:|--:|--:|--:|
${rows.join('\n')}

## Per issuer — what chitta-ref-app has, what we have, why the gap

chitta-ref-app's large counts are mostly **variants of the same families**: banks reword alerts every year and chitta-ref-app keeps one
pattern per wording (plus obsolete ones). We keep **one template per family** and rely on reader v2 for variants;
new wordings arrive through tester "Share pattern" reports and become new templates (one PR, one sample each).

`;
for (const { r, w, ws, os, rc } of per) {
  md += `### ${r.full_name} (\`${r.name}\`)\n\n`;
  md += `- **Senders here${r.sender_status ? ` (${r.sender_status})` : ''}:** ${r.senders.join(', ') || (r.scope === 'any_sender' ? 'any sender' : 'any financial sender (known issuers after their own patterns; unknown DLT bank headers)')}${r.sender_regexes ? ` + regexes ${r.sender_regexes.join(', ')}` : ''}\n`;
  if (ws) {
    md += `- **chitta-ref-app:** ${ws.active} active (+${ws.obsolete} obsolete) · ${ws.senders} sender IDs · transaction ${ws.txn}, statement ${ws.stmt}, event ${ws.event} · captures balance in ${ws.balance}, reference in ${ws.ref}, chaining in ${ws.chaining}\n`;
    md += `  - account types: ${fmt(ws.acct)}\n  - transaction families: ${fmt(ws.fam)}\n`;
  } else md += r.scope ? `- **Layer** (scope \`${r.scope}\`): no chitta-ref-app equivalent — chitta-ref-app repeats these families per bank; we write each once for all banks.\n` : `- **chitta-ref-app:** no issuer of this name in chitta-ref-app's file (newer institution) — ours is first coverage.\n`;
  md += `- **Ours:** ${os.n} patterns · ${fmt(os.fam)}${os.logic.length ? ` · logic: ${os.logic.join(', ')}` : ''}\n`;
  md += `- **Reader v2 alone on these samples:** ${rc.ok}/${rc.tot}${rc.misses.length ? ' — rules needed for: ' + rc.misses.map(m => `\`${m}\``).join('; ') : ''}\n`;
  const gaps = [];
  if (ws) {
    if ((ws.fam['card spend'] || 0) > 0 && !Object.keys(os.fam).some(k => k.includes('card'))) gaps.push('card alerts');
    if ((ws.fam['NEFT/IMPS/RTGS'] || 0) > 2 && !r.patterns.some(p => /neft|imps|rtgs/i.test(p.regex))) gaps.push('NEFT/IMPS/RTGS wording');
    if ((ws.fam['ATM/cash'] || 0) > 0 && !r.patterns.some(p => p.data_fields.money_kind === 'atm')) gaps.push('ATM withdrawal');
    if ((ws.fam['EMI/loan'] || 0) > 0 && !r.patterns.some(p => p.data_fields.money_kind === 'emi')) gaps.push('EMI / loan debit');
    if ((ws.fam['refund/reversal'] || 0) > 0 && !r.patterns.some(p => p.data_fields.money_kind === 'refund')) gaps.push('reversal / refund');
    if ((ws.fam['cheque'] || 0) > 0) gaps.push('cheque');
    if (ws.stmt > 0 && !r.patterns.some(p => p.sms_type === 'statement')) gaps.push('bill / statement');
    if (ws.event > 0) gaps.push('travel / ticket events (deliberately skipped)');
  }
  const GENERIC = new Set(['card alerts', 'NEFT/IMPS/RTGS wording', 'ATM withdrawal', 'EMI / loan debit', 'reversal / refund', 'cheque', 'bill / statement']);
  const closed = r.scope ? [] : gaps.filter(g => GENERIC.has(g));
  const open = r.scope ? [] : gaps.filter(g => !GENERIC.has(g));
  if (!r.scope) {
    md += `- **chitta-ref-app families missing from this issuer's own templates:** ${gaps.length ? gaps.join(', ') : 'none'}\n`;
    md += `- **Closed by the generic bank layer:** ${closed.length ? closed.join(', ') : '—'}\n`;
    md += `- **Still pending:** ${open.length ? open.join(', ') : 'none — confirm wording via tester shares'}\n\n`;
  } else md += '\n';
}

const covered = new Set(per.filter(x => x.w).map(x => x.w.name));
const DEFUNCT = /allahab|andhra|corp bank|syndicate|obc|oriental|united bank|vijaya|dena|lakshmi vilas|pmc|rbs|aircel|rcom|docomo|citibank|mobomoney|imoney|ola ?money|freecharge|zestmoney|capital float|bullet|sezzle/i;
const LAYER = {
  bank: 'generic bank layer (unknown DLT sender → generic families → reader v2)',
  credit_card: 'generic bank layer card templates (spend, payment received, statement)',
  loan: 'generic bank layer EMI templates + biller notices',
  electricity: 'biller layer (utility bills)', gas: 'biller layer (utility bills)', phone: 'biller layer (bills, recharge expiry)',
  prepaid_dth: 'biller layer (recharge expiry)', insurance: 'biller layer (premium due)', pay_later: 'biller layer (dues) — spends not yet',
  prepaid: 'NOT covered by templates — reader v2 only (wallet spends)', generic: 'skipped — travel / ticket events', sip: 'NOT covered — SIP debits read as bank debits by reader v2',
};
const groups = {};
for (const w of refApp) {
  const act = w.patterns.filter(p => !p.obsolete);
  if (!act.length || covered.has(w.name)) continue;
  const t = Object.entries(act.reduce((a, p) => ((a[p.account_type] = (a[p.account_type] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1])[0][0];
  (groups[t] = groups[t] || []).push({ name: w.name, n: act.length, defunct: DEFUNCT.test(w.name + ' ' + (w.full_name || '')) });
}
md += `## Pending vs chitta-ref-app — issuers Tracker has no entry for\n\nCounts from chitta-ref-app's file; names are public institution names. Covered **by shape** through the generic layers, not by copying.\n\n| Type | Issuers | chitta-ref-app patterns | Merged / closed | Covered by |\n|---|--:|--:|--:|---|\n`;
for (const [t, list] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
  md += `| ${t} | ${list.length} | ${list.reduce((n, x) => n + x.n, 0)} | ${list.filter(x => x.defunct).length} | ${LAYER[t] || 'reader v2 only'} |\n`;
}
md += `\n**Live issuers worth their own entry next** (most chitta-ref-app patterns, not merged/closed): ` +
  Object.values(groups).flat().filter(x => !x.defunct).sort((a, b) => b.n - a.n).slice(0, 20).map(x => `${x.name} (${x.n})`).join(', ') +
  `.\nAdd each with its own DLT headers (from real tester SMS) and at least one template per family it sends.\n`;
fs.writeFileSync(outPath, md);
console.log(`wrote ${outPath}: reader v2 alone ${rOk}/${rTot}; chitta-ref-app active ${wTot}; ours ${oTot}`);
