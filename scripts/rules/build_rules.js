// Generates Tracker rules.json (schema v2) from compact templates.
// Placeholders become capture groups; group_id values are assigned automatically.
// All templates and samples are ORIGINAL (synthetic bodies, QA names). Nothing from chitta-ref-app's rules.json.
const fs = require('fs');
const path = require('path');
const out = process.argv[2];

const CUR = String.raw`(?:rs\.?|inr|₹)\s?`;
const NUM = String.raw`([\d,]+(?:\.\d{1,2})?)`;
const PH = {
  AMT: { re: CUR + NUM, field: 'amount' },
  NUM: { re: NUM, field: 'amount' },
  BAL: { re: CUR + NUM, field: 'account_balance' },
  BALN: { re: NUM, field: 'account_balance' },
  LIMIT: { re: CUR + NUM, field: 'available_limit' },
  DUE: { re: CUR + NUM, field: 'amount' },
  MIN: { re: CUR + NUM, field: 'min_due_amount' },
  OUT: { re: CUR + NUM, field: 'outstanding_balance' },
  FEE: { re: CUR + NUM, field: 'amount' },
  PAN: { re: String.raw`[x*]*\s?(\d{4})`, field: 'pan' },
  PANL: { re: String.raw`[x*]+\d*?(\d{4})`, field: 'pan' },
  PAN3: { re: String.raw`[x*]*(\d{3,4})`, field: 'pan', extra: { min_digits: 3 } },
  PAN5: { re: String.raw`[x*]+\s?\d?(\d{4})`, field: 'pan' },
  CPAN: { re: String.raw`[x*]*\s?(\d{4})`, field: 'counterparty_pan' },
  CPANL: { re: String.raw`[x*]+\d*?(\d{4})`, field: 'counterparty_pan' },
  POS: { re: String.raw`(.+?)`, field: 'pos' },
  VPA: { re: String.raw`([a-z0-9][a-z0-9.\-_]{1,60}@[a-z][a-z0-9]{1,30})`, field: 'pos' },
  NOTE: { re: String.raw`(.+?)`, field: 'note' },
  REF: { re: String.raw`(\d{6,})`, field: 'network_reference_id' },
  CUR: { re: String.raw`(inr|usd|eur|gbp|aed|sgd|rs\.?)\s?`, field: 'currency', extra: { default: 'INR', aliases: { RS: 'INR', 'RS.': 'INR' } } },
  RAIL: { re: String.raw`(neft|imps|rtgs|upi|mob bk|net ?banking|pos|atm)`, field: '__rail' },
  CPNAME: { re: String.raw`(.+?)`, field: 'counterparty_name' },
  UPITYPE: { re: String.raw`(p2[amp])`, field: '__upitype' },
  // v2.1 generic layers
  REFA: { re: String.raw`([a-z0-9]{8,24})`, field: 'network_reference_id' },
  ACCT: { re: String.raw`(a\/c|account|card)`, field: '__acct' },
  CARDTYPE: { re: String.raw`(credit|debit|prepaid)`, field: '__cardtype' },
};

function dateRe(fmt) {
  let re = '';
  const tokens = fmt.match(/'[^']*'|yyyy|yy|MMMM|MMM|MM|dd|d|HH|hh|mm|ss|a|[^A-Za-z']+|[A-Za-z]/g);
  for (const t of tokens) {
    if (t.startsWith("'")) re += t.slice(1, -1).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
    else if (t === 'yyyy') re += String.raw`\d{4}`;
    else if (t === 'yy' || t === 'HH' || t === 'hh' || t === 'mm' || t === 'ss') re += String.raw`\d{2}`;
    else if (t === 'MMMM') re += '[a-z]{3,9}';
    else if (t === 'MMM') re += '[a-z]{3}';
    else if (t === 'MM' || t === 'dd' || t === 'd') re += String.raw`\d{1,2}`;
    else if (t === 'a') re += '(?:am|pm)';
    else re += t.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&').replace(/ /g, String.raw`\s?`);
  }
  return re;
}

// Compile a template: "{AMT} debited from a/c {PAN} on {DATE:dd-MM-yy}" -> regex + data_fields.
function compile(tpl) {
  const fields = {};
  let n = 0;
  const re = tpl.replace(/\{([A-Z][A-Z0-9]*)(?::([^}]+))?\}/g, (_, key, arg) => {
    n++;
    if (key === 'DATE') {
      const formats = arg.split('|');
      fields.date = { group_id: n, formats: formats.map(f => ({ format: f })) };
      return '(' + formats.map(dateRe).join('|') + ')';
    }
    const ph = PH[key];
    if (!ph) throw new Error(`unknown placeholder ${key} in ${tpl}`);
    if (fields[ph.field]) {
      const g = fields[ph.field].group_id;
      fields[ph.field].group_id = Array.isArray(g) ? [...g, n] : [g, n];
    } else fields[ph.field] = { group_id: n, ...(ph.extra || {}) };
    return ph.re;
  });
  return { regex: re.replace(/ /g, String.raw`\s`).replace(/\\s\\s\?/g, String.raw`\s?`), fields };
}

let uidSeq = {};
function P(issuer, spec) {
  const { regex, fields } = compile(spec.t);
  const prefix = { transaction: 'T', statement: 'S', notice: 'N', balance: 'B', event: 'E', ignore: 'I' }[spec.type || 'transaction'];
  const key = `${prefix}-${issuer.toUpperCase()}`;
  uidSeq[key] = (uidSeq[key] || 0) + 1;
  const data = {};
  if (spec.dir) data.transaction_type = spec.dir;
  if (spec.kind) data.money_kind = spec.kind;
  if (spec.stmt) data.statement_type = spec.stmt;
  if (spec.notice) data.notice_type = spec.notice;
  if (spec.ignore) data.ignore_reason = spec.ignore;
  for (const [k, v] of Object.entries(fields)) if (!k.startsWith('__')) data[k] = v;
  if (fields.__rail) {
    data.transaction_type_rule = {
      group_id: fields.__rail.group_id,
      rules: [
        { value: 'neft|rtgs|imps', txn_type: 'bank_transfer' },
        { value: 'upi', txn_type: 'upi' },
        { value: 'mob bk|net ?banking', txn_type: 'net_banking', pos_override: 'Net Banking', set_no_pos: true },
        { value: 'pos', txn_type: 'card_pos' },
        { value: 'atm', txn_type: 'atm', money_kind_override: 'atm', pos_override: 'ATM Withdrawal' },
      ],
    };
  }
  if (fields.__acct) {
    data.transaction_type_rule = { group_id: fields.__acct.group_id, rules: [{ value: 'card', txn_type: 'card', acc_type_override: 'credit_card' }, { value: 'a/c|account', txn_type: 'account' }] };
  }
  if (fields.__cardtype) {
    data.transaction_type_rule = { group_id: fields.__cardtype.group_id, rules: [{ value: 'debit', txn_type: 'debit_card', acc_type_override: 'debit_card' }, { value: 'credit', txn_type: 'credit_card', acc_type_override: 'credit_card' }, { value: 'prepaid', txn_type: 'prepaid_card', acc_type_override: 'prepaid' }] };
  }
  if (!data.date) data.date = { use_sms_time: true };
  if (spec.data?.pos_type_rules?.group_id === null) spec.data.pos_type_rules.group_id = fields.note?.group_id;
  if (spec.data?.transaction_type_rule?.group_id === null) spec.data.transaction_type_rule.group_id = fields.__upitype?.group_id;
  if (data.network_reference_id) {
    data.network_reference_id.type_rule = { rules: [{ value: 'upi', ref_type: 'upi' }, { value: 'imps', ref_type: 'imps' }, { value: 'neft', ref_type: 'neft' }, { value: 'rtgs', ref_type: 'rtgs' }] };
  }
  Object.assign(data, spec.data || {});
  const p = {
    pattern_UID: `${key}-${String(uidSeq[key]).padStart(4, '0')}`,
    sort_UID: spec.sort,
    sms_type: spec.type || 'transaction',
    account_type: spec.acct,
    regex: (spec.anchor ? '^' : '') + regex,
    flags: 'i',
    data_fields: data,
  };
  for (const k of ['reparse', 'obsolete', 'obsolete_after', 'preprocessor', 'account_name_override', 'set_account_as_expense', 'create_txn']) {
    if (spec[k] !== undefined) p[k] = spec[k];
  }
  if (spec.doc) p._doc = spec.doc;
  p.samples = spec.s.map(([body, expect]) => (Array.isArray(expect) ? { body, expect_records: expect } : { body, expect }));
  return p;
}

const SPEND = { dir: 'debit', kind: 'spend' };
const IN = { dir: 'credit', kind: 'income' };

// chaining blocks (chitta-ref-app-style parent_match / parent_nomatch, Tracker semantics: suggestions only)
const CHAIN_DUP_LINKED = {
  enable_chaining: true,
  chaining_rule: {
    parent_selection: [
      { parent_field: 'amount', child_field: 'amount', match_type: 'exact' },
      { parent_field: 'account', child_field: 'account', match_type: 'same_or_alias' },
      { parent_field: 'date', child_field: 'date', match_type: 'delta', match_value: 3600000 },
      { parent_field: 'transaction_type', child_field: 'transaction_type', match_type: 'exact' },
    ],
    parent_match: { parent_override: { incomplete: false }, child_override: { deleted: true } },
    parent_nomatch: { child_override: { deleted: false } },
  },
};
const CHAIN_REFUND = {
  enable_chaining: true,
  chaining_rule: {
    parent_selection: [
      { parent_field: 'network_reference_id', child_field: 'network_reference_id', match_type: 'exact' },
      { parent_field: 'amount', child_field: 'amount', match_type: 'exact' },
      { parent_field: 'transaction_type', match_type: 'value', match_value: 'debit' },
    ],
    parent_match: { parent_override: {}, child_override: { link: 'refund' } },
    parent_nomatch: { child_override: {} },
  },
};
const CHAIN_CARD_PAYMENT = {
  enable_chaining: true,
  chaining_rule: {
    parent_selection: [
      { parent_field: 'amount', child_field: 'amount', match_type: 'exact' },
      { parent_field: 'money_kind', match_type: 'value', match_value: 'card_payment' },
      { parent_field: 'counterparty_pan', child_field: 'pan', match_type: 'exact_if_present' },
      { parent_field: 'date', child_field: 'date', match_type: 'delta', match_value: 259200000 },
    ],
    parent_match: { parent_override: {}, child_override: { link: 'transfer_twin' } },
    parent_nomatch: { child_override: {} },
  },
};

const R = []; // issuers
function I(name, full_name, kind, senders, patterns, extra = {}) {
  R.push({ name, full_name, institution_kind: kind, senders, ...extra, patterns: patterns.map(p => P(name, p)) });
}

// ---------------------------------------------------------------- HDFC
I('hdfc', 'HDFC Bank', 'bank', ['HDFCBK', 'HDFCBN', 'HDFCCC'], [
  { sort: 100, acct: 'bank', ...SPEND, anchor: true, t: 'sent {AMT} from hdfc bank a/c {PAN} to {POS} on {DATE:dd/MM/yy} ref {REF}',
    s: [['Sent Rs.250.00 From HDFC Bank A/C *1234 To QA STORE On 05/11/26 Ref 000000000101', { amount: '250.00', pan: '1234', pos: 'QA STORE', date: '05/11/26', network_reference_id: '000000000101' }]] },
  { sort: 101, acct: 'bank', ...IN, t: '{AMT} credited to hdfc bank a/c {PAN} on {DATE:dd-MM-yy} from vpa {VPA} \\(upi {REF}\\)',
    s: [['Rs.500.00 credited to HDFC Bank A/c XX1234 on 05-11-26 from VPA qa.friend@okqa (UPI 000000000201)', { amount: '500.00', pan: '1234', pos: 'qa.friend@okqa', network_reference_id: '000000000201' }]] },
  { sort: 105, acct: 'bank', ...SPEND, obsolete: true, doc: 'Older wording kept as obsolete: still parses old SMS during a re-scan.',
    t: '{AMT} debited from a/c {PAN} on {DATE:dd-MM-yy} to vpa {VPA} \\(upi ref no {REF}\\)',
    s: [['Rs.80.00 debited from a/c **1234 on 01-06-26 to VPA qa.cafe@okqa (UPI Ref No 000000000102).', { amount: '80.00', pan: '1234', pos: 'qa.cafe@okqa' }]] },
  { sort: 110, acct: 'credit_card', ...SPEND, anchor: true, t: 'spent {AMT} on hdfc bank card {PAN} at {POS} on {DATE:yyyy-MM-dd:HH:mm:ss}',
    s: [['Spent Rs.649 On HDFC Bank Card 9999 At QA FOODS On 2026-11-05:12:30:00', { amount: '649', pan: '9999', pos: 'QA FOODS', date: '2026-11-05:12:30:00' }]] },
  { sort: 120, acct: 'debit_card', ...SPEND, anchor: true, data: CHAIN_DUP_LINKED,
    doc: 'Debit-card last-4 is the CARD. Resolved via R5d alias to the bank a/c; chaining suggests a duplicate with the account-side alert.',
    t: '{AMT} spent on your hdfc bank debit card ending {PAN} at {POS} on {DATE:yyyy-MM-dd:HH:mm:ss}\\.? ?avl bal:? {BAL}',
    s: [['Rs.1,250.00 spent on your HDFC Bank Debit Card ending 9999 at QA PETROL on 2026-11-05:09:00:00. Avl bal: Rs.10,000.00', { amount: '1,250.00', pan: '9999', pos: 'QA PETROL', account_balance: '10,000.00' }]] },
  { sort: 130, acct: 'bank', ...IN,
    data: { pos_type_rules: { group_id: null, rules: [{ value: '\\b(?:sal|salary|payroll)\\b', category: 'salary' }, { value: '\\breimb(?:ursement)?\\b', category: 'reimbursement' }, { value: '\\brefund\\b', category: 'refund', income_flag_override: false }] } },
    t: '{AMT} deposited in hdfc bank a/c {PAN} on {DATE:dd-MMM-yy} for (?:neft|imps|rtgs) cr-[^-]+-{POS}-{NOTE}\\. ?avl bal {BAL}',
    s: [['Update! INR 85,000.00 deposited in HDFC Bank A/c XX1234 on 01-NOV-26 for NEFT Cr-QAEMP0000001-QA EMPLOYER PVT LTD-SALARY OCT 2026.Avl bal INR 1,02,000.00', { amount: '85,000.00', pan: '1234', pos: 'QA EMPLOYER PVT LTD', account_balance: '1,02,000.00', category: 'salary' }]] },
  { sort: 90, acct: 'bank', dir: 'debit', kind: 'card_payment', data: { pos: { value: 'Credit card bill payment' } },
    t: '{AMT} debited from a/c {PAN} on {DATE:dd-MM-yy} towards .{0,30}?credit card {CPAN} payment\\.? ?avl bal {BAL}',
    s: [['Rs.40,000.00 debited from A/c XX1234 on 05-11-26 towards HDFC Bank Credit Card XX9999 payment. Avl bal Rs 62,000.00', { amount: '40,000.00', pan: '1234', counterparty_pan: '9999', money_kind: 'card_payment' }]] },
  { sort: 80, acct: 'bank', dir: 'credit', kind: 'refund', data: { pos: { value: 'Reversal' }, ...CHAIN_REFUND },
    t: '{AMT} debited on [\\d-]+ for upi ref {REF} has been reversed to your a/c {PAN} on {DATE:dd-MM-yy}',
    s: [['Rs.250.00 debited on 03-11-26 for UPI Ref 000000000101 has been reversed to your A/c XX1234 on 05-11-26.', { amount: '250.00', pan: '1234', network_reference_id: '000000000101', money_kind: 'refund' }]] },
  { sort: 95, acct: 'bank', dir: 'debit', kind: 'emi', data: { pos: { value: 'Loan EMI' } },
    t: '{AMT} debited from a/c {PAN} on {DATE:dd-MM-yy} towards emi for loan a/c {CPAN}\\.? ?avl bal {BAL}',
    s: [['Rs 12,500.00 debited from A/c XX1234 on 05-11-26 towards EMI for Loan A/c XX0099. Avl bal Rs 49,500.00', { amount: '12,500.00', pan: '1234', counterparty_pan: '0099', money_kind: 'emi' }]] },
  { sort: 50, acct: 'bank', type: 'notice', notice: 'mandate_future', t: '{AMT} will be debited from your a/c {PAN} on {DATE:dd-MM-yy} towards {POS} e-?mandate',
    s: [['Rs.199 will be debited from your A/c XX1234 on 07-11-26 towards QA OTT e-mandate.', { amount: '199', pan: '1234', pos: 'QA OTT', date: '07-11-26' }]] },
  { sort: 60, acct: 'credit_card', type: 'statement', stmt: 'credit_card_bill', t: 'hdfc bank credit card {PAN} statement: total due {DUE}, min due {MIN}, due by {DATE:dd-MM-yyyy}',
    s: [['HDFC Bank Credit Card XX9999 Statement: Total due Rs.12,000.00, Min due Rs.600.00, Due by 20-11-2026', { pan: '9999', amount: '12,000.00', min_due_amount: '600.00', date: '20-11-2026' }]] },
  { sort: 85, acct: 'credit_card', dir: 'credit', kind: 'card_payment', data: { pos: { value: 'Card bill payment received' }, ...CHAIN_CARD_PAYMENT },
    t: 'payment of {AMT} received on your hdfc bank credit card ending {PAN} on {DATE:dd-MM-yyyy}',
    s: [['Payment of Rs.12,000.00 received on your HDFC Bank Credit Card ending 9999 on 05-11-2026', { amount: '12,000.00', pan: '9999', money_kind: 'card_payment' }]] },
], { misc_information: { get_balance: [{ account_type: 'bank', contact_info: [{ type: 'missed_call', numbers: [], verified: false }] }] } });

// ---------------------------------------------------------------- ICICI
I('icici', 'ICICI Bank', 'bank', ['ICICIB', 'ICICIT', 'ICICIO', 'ICICCC'], [
  { sort: 100, acct: 'bank', ...SPEND, anchor: true, doc: 'ICICI masks with 3 digits (XX888): min_digits 3 → R5d suffix match.',
    t: 'icici bank acct {PAN3} debited for {AMT} on {DATE:dd-MMM-yy}; {POS} credited\\. ?upi:{REF}',
    s: [['ICICI Bank Acct XX234 debited for Rs 1,499.00 on 05-Nov-26; QA MART credited. UPI:000000000105.', { amount: '1,499.00', pan: '234', pos: 'QA MART', network_reference_id: '000000000105' }]] },
  { sort: 101, acct: 'bank', ...IN, t: 'acct {PAN3} is credited with {AMT} on {DATE:dd-MMM-yy} from {POS}\\. ?upi:{REF}',
    s: [['Dear Customer, Acct XX234 is credited with Rs 500.00 on 05-Nov-26 from QA FRIEND. UPI:000000000202-ICICI Bank.', { amount: '500.00', pan: '234', pos: 'QA FRIEND', network_reference_id: '000000000202' }]] },
  { sort: 102, acct: 'bank', dir: 'debit', kind: 'atm', data: { pos: { value: 'ATM Withdrawal' } }, reparse: true,
    doc: 'reparse: a fee sentence after the withdrawal becomes a second record.',
    t: 'icici bank acct {PAN3} debited with {AMT} on {DATE:dd-MMM-yy} at atm {NOTE}\\. avl bal {BAL}\\.',
    s: [['ICICI Bank Acct XX234 debited with INR 2,000.00 on 05-Nov-26 at ATM QA0001. Avl Bal INR 8,000.00. Rs 23.60 charged as ATM fee on Acct XX234.', [
      { amount: '2,000.00', pan: '234', money_kind: 'atm', account_balance: '8,000.00' },
      { amount: '23.60', pan: '234', money_kind: 'spend', pos: 'Bank charges' }]]] },
  { sort: 103, acct: 'bank', ...SPEND, data: { pos: { value: 'Bank charges' }, category_hint: 'fees' },
    t: '{FEE} charged as {NOTE} on acct {PAN3}\\.',
    s: [['Rs 23.60 charged as SMS charges on Acct XX234.', { amount: '23.60', pan: '234', pos: 'Bank charges' }]] },
  { sort: 110, acct: 'credit_card', ...SPEND, anchor: true, doc: 'Currency captured: non-INR is never booked as INR. Avl Limit is not the amount.',
    t: '{CUR}{NUM} spent using icici bank card {PAN} on {DATE:dd-MMM-yy} on {POS}\\. ?avl limit:? {LIMIT}',
    s: [['INR 3,200.00 spent using ICICI Bank Card XX9999 on 05-Nov-26 on QA ELECTRONICS. Avl Limit: INR 96,800.00.', { currency: 'INR', amount: '3,200.00', pan: '9999', pos: 'QA ELECTRONICS', available_limit: '96,800.00' }],
        ['USD 12.99 spent using ICICI Bank Card XX9999 on 05-Nov-26 on QA STREAMING. Avl Limit: INR 95,000.00.', { currency: 'USD', amount: '12.99', pan: '9999', pos: 'QA STREAMING' }]] },
  { sort: 90, acct: 'credit_card', dir: 'credit', kind: 'card_payment', data: { pos: { value: 'Card bill payment received' }, ...CHAIN_CARD_PAYMENT },
    t: 'payment of {AMT} has been received towards your icici bank credit card {PAN} on {DATE:dd-MMM-yy}',
    s: [['Dear Customer, Payment of INR 40,000.00 has been received towards your ICICI Bank Credit Card XX9999 on 05-Nov-26. Thank you.', { amount: '40,000.00', pan: '9999', money_kind: 'card_payment' }]] },
  { sort: 50, acct: 'credit_card', type: 'statement', stmt: 'credit_card_bill', t: 'icici bank credit card {PAN} statement: total amt due {DUE}, min amt due {MIN} due by {DATE:dd-MMM-yy}',
    s: [['ICICI Bank Credit Card XX9999 statement: Total Amt Due INR 40,000.00, Min Amt Due INR 2,000.00 due by 20-Nov-26.', { pan: '9999', amount: '40,000.00', min_due_amount: '2,000.00', date: '20-Nov-26' }]] },
]);

// ---------------------------------------------------------------- SBI
I('sbi', 'State Bank of India', 'bank', ['SBIBNK', 'SBIINB', 'SBIUPI', 'CBSSBI', 'ATMSBI', 'SBIPSG', 'SBYONO', 'SBICRD', 'SBICRF'], [
  { sort: 100, acct: 'bank', ...SPEND, t: 'a/c {PAN} debited by {NUM} on date {DATE:ddMMMyy} trf to {POS} refno {REF}',
    s: [['Dear UPI user A/C X1234 debited by 75.0 on date 05Nov26 trf to QA CAFE Refno 000000000103.', { amount: '75.0', pan: '1234', pos: 'QA CAFE', network_reference_id: '000000000103' }]] },
  { sort: 101, acct: 'bank', ...IN, t: 'a/c {PAN}-credited by {AMT} on {DATE:ddMMMyy} transfer from {POS} ref no {REF}',
    s: [['Dear SBI User, your A/c X1234-credited by Rs.500 on 05Nov26 transfer from QA FRIEND Ref No 000000000203 -SBI', { amount: '500', pan: '1234', pos: 'QA FRIEND', network_reference_id: '000000000203' }]] },
  { sort: 110, acct: 'bank', ...SPEND, doc: 'Balance BEFORE amount; long mask XXXXX+6 digits → last 4.',
    t: 'a/c {PANL} has a balance of {BAL} after debit of {AMT} on {DATE:dd/MM/yy} towards {POS}\\.',
    s: [['Your A/C XXXXX991234 has a balance of Rs 5,000.00 after debit of Rs 300.00 on 05/11/26 towards QA SHOP. -SBI', { amount: '300.00', pan: '1234', account_balance: '5,000.00', pos: 'QA SHOP' }]] },
  { sort: 90, acct: 'bank', dir: 'debit', kind: 'atm', data: { pos: { value: 'ATM Withdrawal' } }, t: '{AMT} withdrawn at {NOTE} from a/c {PAN} on {DATE:ddMMMyy}.*?avl bal {BAL}',
    s: [['Dear Customer, Rs.2,000 withdrawn at QA ATM 0001 from A/c XX1234 on 05Nov26 Txn# 0001. Avl Bal Rs 8,000.', { amount: '2,000', pan: '1234', money_kind: 'atm', account_balance: '8,000' }]] },
  { sort: 95, acct: 'bank', dir: 'debit', kind: 'transfer', data: { pos: { value: 'Transfer' } }, t: '{AMT} transferred from a/c {PAN} to a/c {CPAN} on {DATE:ddMMMyy}\\. ?ref {REF}',
    s: [['Rs 5,000.00 transferred from A/c XX1234 to A/c XX9999 on 05Nov26. Ref 000000000104. -SBI', { amount: '5,000.00', pan: '1234', counterparty_pan: '9999', money_kind: 'transfer' }]] },
  { sort: 120, acct: 'bank', dir: 'credit', kind: 'interest', data: { pos: { value: 'Interest' } }, t: 'interest of {AMT} credited to your a/c {PAN} on {DATE:ddMMMyy}',
    s: [['Interest of Rs 312.00 credited to your A/c XX1234 on 01Nov26. -SBI', { amount: '312.00', pan: '1234', money_kind: 'interest' }]] },
  { sort: 130, acct: 'credit_card', ...SPEND, account_name_override: 'SBI Card', t: '{AMT} spent on your sbi credit card ending {PAN} at {POS} on {DATE:dd/MM/yy}',
    s: [['Rs.1,200.00 spent on your SBI Credit Card ending 9999 at QA STORE on 05/11/26. Trxn. not done by you? Report at 0000', { amount: '1,200.00', pan: '9999', pos: 'QA STORE' }]] },
  { sort: 60, acct: 'credit_card', type: 'statement', stmt: 'credit_card_bill', t: 'sbi card ending {PAN} statement: total amount due {DUE}; minimum amount due {MIN}; payment due date {DATE:dd/MM/yyyy}',
    s: [['Your SBI Card ending 9999 statement: Total Amount Due Rs.8,000.00; Minimum Amount Due Rs.400.00; Payment Due Date 22/11/2026', { pan: '9999', amount: '8,000.00', min_due_amount: '400.00' }]] },
  { sort: 10, acct: 'debit_card', type: 'ignore', ignore: 'failed', t: 'txn of (?:rs\\.?|inr|₹)\\s?[\\d,]+(?:\\.\\d{1,2})? on sbi debit card [x*]*\\d{4} at .+? declined',
    s: [['Txn of Rs.500.00 on SBI Debit Card XX9999 at QA STORE on 05Nov26 declined due to insufficient balance.', {}]] },
], { misc_information: { get_balance: [{ account_type: 'bank', contact_info: [{ type: 'missed_call', numbers: [], verified: false }] }] } });

// ---------------------------------------------------------------- AXIS
I('axis', 'Axis Bank', 'bank', ['AXISBK', 'AXISMR', 'AXISCC'], [
  { sort: 100, acct: 'bank', ...IN, anchor: true,
    data: { transaction_type_rule: { group_id: null, rules: [{ value: 'p2a|p2p', txn_type: 'person' }, { value: 'p2m', txn_type: 'merchant' }] } },
    t: '{AMT} credited to a/c no\\. {PAN} on {DATE:dd-MM-yy \'at\' HH:mm:ss} ist\\. info- upi/{UPITYPE}/{REF}/{POS}\\. avl bal- {BAL}',
    s: [['INR 2,000.00 credited to A/c no. XX1234 on 05-11-26 at 10:00:00 IST. Info- UPI/P2A/000000000106/QA FRIEND. Avl Bal- INR 12,345.67 - Axis Bank', { amount: '2,000.00', pan: '1234', pos: 'QA FRIEND', txn_type: 'person', account_balance: '12,345.67' }]] },
  { sort: 101, acct: 'bank', ...SPEND, anchor: true,
    data: { transaction_type_rule: { group_id: null, rules: [{ value: 'p2a|p2p', txn_type: 'person' }, { value: 'p2m', txn_type: 'merchant' }] } },
    t: '{AMT} debited from a/c no\\. {PAN} on {DATE:dd-MM-yy \'at\' HH:mm:ss} ist\\. info- upi/{UPITYPE}/{REF}/{POS}\\. avl bal- {BAL}',
    s: [['INR 300.00 debited from A/c no. XX1234 on 05-11-26 at 10:00:00 IST. Info- UPI/P2M/000000000204/QA SHOP. Avl Bal- INR 9,700.00 - Axis Bank', { amount: '300.00', pan: '1234', pos: 'QA SHOP', txn_type: 'merchant' }]] },
  { sort: 110, acct: 'credit_card', ...SPEND, anchor: true, t: 'spent {AMT} axis bank card no\\. {PAN} {DATE:dd-MM-yy HH:mm:ss} ist {POS} avl limit:? {LIMIT}',
    s: [['Spent INR 499 Axis Bank Card no. XX9999 05-11-26 10:00:00 IST QA OTT Avl Limit: INR 45,000', { amount: '499', pan: '9999', pos: 'QA OTT', available_limit: '45,000' }]] },
  { sort: 90, acct: 'credit_card', dir: 'credit', kind: 'card_payment', data: { pos: { value: 'Card bill payment received' }, ...CHAIN_CARD_PAYMENT },
    t: 'payment of {AMT} has been received on your axis bank credit card no\\. {PAN} on {DATE:dd-MM-yy}',
    s: [['Payment of INR 5,000.00 has been received on your Axis Bank Credit Card no. XX9999 on 05-11-26', { amount: '5,000.00', pan: '9999', money_kind: 'card_payment' }]] },
  { sort: 60, acct: 'bank', type: 'balance', t: 'avl bal in a/c {PAN} is {BAL} as on {DATE:dd-MM-yy HH:mm}',
    s: [['Avl Bal in A/c XX1234 is INR 12,345.67 as on 05-11-26 10:00. Axis Bank', { pan: '1234', account_balance: '12,345.67' }]] },
]);

// ---------------------------------------------------------------- KOTAK
I('kotak', 'Kotak Mahindra Bank', 'bank', ['KOTAKB', 'KOTAKM'], [
  { sort: 100, acct: 'bank', ...SPEND, anchor: true, t: 'sent {AMT} from kotak bank ac {PAN} to {VPA} on {DATE:dd-MM-yy}\\. ?upi ref {REF}',
    s: [['Sent Rs.120.00 from Kotak Bank AC X1234 to qa.store@okqa on 05-11-26.UPI Ref 000000000102.', { amount: '120.00', pan: '1234', pos: 'qa.store@okqa', network_reference_id: '000000000102' }]] },
  { sort: 101, acct: 'bank', ...IN, anchor: true, t: 'received {AMT} in your kotak bank ac {PAN} from {VPA} on {DATE:dd-MM-yy}\\. ?upi ref:? ?{REF}',
    s: [['Received Rs.500.00 in your Kotak Bank AC X1234 from qa.friend@okqa on 05-11-26.UPI Ref:000000000205.', { amount: '500.00', pan: '1234', pos: 'qa.friend@okqa' }]] },
  { sort: 110, acct: 'bank', ...SPEND, data: { recurring_hint: true },
    t: '{AMT} debited from (?:your )?kotak a/c {PAN} towards your e-?mandate for {POS} on {DATE:dd-MM-yy}',
    s: [['Rs 199.00 debited from your Kotak A/c X1234 towards your e-mandate for QA OTT on 05-11-26. UMRN QA0000001', { amount: '199.00', pan: '1234', pos: 'QA OTT', recurring: true }]] },
  { sort: 111, acct: 'bank', ...SPEND, t: '{AMT} debited from (?:your )?kotak a/c {PAN} on {DATE:dd-MM-yy} to {POS} via {RAIL}',
    s: [['Rs.1,23,456.78 debited from Kotak A/c X1234 on 05-11-26 to QA BUILDER via NEFT.', { amount: '1,23,456.78', pan: '1234', pos: 'QA BUILDER', txn_type: 'bank_transfer' }]] },
  { sort: 120, acct: 'credit_card', ...SPEND, anchor: true, t: 'spent {AMT} on kotak credit card {PAN} at {POS} on {DATE:dd/MM/yyyy}\\. ?avl limit {LIMIT}',
    s: [['Spent Rs.700.00 on Kotak Credit Card XX9999 at QA STORE on 05/11/2026. Avl limit Rs.40,000', { amount: '700.00', pan: '9999', pos: 'QA STORE', available_limit: '40,000' }]] },
]);

// ---------------------------------------------------------------- PAYTM (wallet + payments bank)
I('paytm', 'Paytm', 'wallet', ['IPAYTM', 'PAYTMW', 'PAYTMB', 'PYTMBK'], [
  { sort: 100, acct: 'wallet', dir: 'credit', kind: 'wallet_load', data: { pan: { value: 'wallet' }, pos: { value: 'Wallet top-up' } },
    doc: 'Account = wallet; the bank a/c is the SOURCE (counterparty), never credited.',
    t: '{AMT} added to your paytm wallet from {CPNAME} a/c {CPAN}\\. ?updated balance:? {BAL}',
    s: [['Rs.500 added to your Paytm Wallet from HDFC Bank A/c XX1234. Updated Balance: Rs.650', { amount: '500', counterparty_pan: '1234', money_kind: 'wallet_load', account_balance: '650' }]] },
  { sort: 101, acct: 'wallet', ...SPEND, data: { pan: { value: 'wallet' } }, set_account_as_expense: true,
    t: 'paid {AMT} to {POS} from paytm wallet\\. ?updated balance:? {BAL}\\. ?txn id:? ?{REF}',
    s: [['Paid Rs.120 to QA STORE from Paytm Wallet. Updated Balance: Rs.530. Txn ID: 000000000206', { amount: '120', pos: 'QA STORE', account_balance: '530' }]] },
  { sort: 110, acct: 'bank', ...SPEND, account_name_override: 'Paytm Payments Bank', t: '{AMT} sent to {VPA} from paytm payments bank a/c {PAN}\\. ?upi ref:? ?{REF}',
    s: [['Rs.250 sent to qa.store@okqa from Paytm Payments Bank a/c XX1234. UPI Ref: 000000000207', { amount: '250', pan: '1234', pos: 'qa.store@okqa' }]] },
], { set_account_as_expense: true });

// ---------------------------------------------------------------- AMAZON PAY (wallet)
I('amazonpay', 'Amazon Pay', 'wallet', ['AMAZON', 'AMZPAY'], [
  { sort: 100, acct: 'wallet', ...SPEND, data: { pan: { value: 'wallet' } }, t: '{AMT} paid to {POS} using amazon pay balance\\. ?balance:? {BAL}',
    s: [['Rs.299 paid to QA STORE using Amazon Pay balance. Balance: Rs.701', { amount: '299', pos: 'QA STORE', account_balance: '701' }]] },
  { sort: 101, acct: 'wallet', dir: 'credit', kind: 'wallet_load', data: { pan: { value: 'wallet' }, pos: { value: 'Wallet top-up' } },
    t: '{AMT} added to amazon pay balance from {CPNAME} a/c {CPAN}',
    s: [['Rs.500 added to Amazon Pay balance from HDFC Bank A/c XX1234', { amount: '500', counterparty_pan: '1234', money_kind: 'wallet_load' }]] },
], { set_account_as_expense: true });

// ---------------------------------------------------------------- generic-bank families for the rest
function bank2(name, full, senders, debitT, creditT, debitS, creditS, more = [], extra = {}) {
  I(name, full, 'bank', senders, [
    { sort: 100, acct: 'bank', ...SPEND, t: debitT, s: debitS },
    { sort: 101, acct: 'bank', ...IN, t: creditT, s: creditS },
    ...more,
  ], extra);
}

bank2('indusind', 'IndusInd Bank', ['INDUSB', 'INDUSL'],
  '{AMT} debited from your indusind bank a/c {PAN} on {DATE:dd-MMM-yy} towards upi/{REF}/{POS}\\. ?avl bal {BAL}',
  '{AMT} credited to your indusind bank a/c {PAN} on {DATE:dd-MMM-yy} towards upi/{REF}/{POS}\\. ?avl bal {BAL}',
  [['INR 600.00 debited from your IndusInd Bank A/c XX1234 on 05-Nov-26 towards UPI/000000000208/QA STORE. Avl Bal INR 4,400.00', { amount: '600.00', pan: '1234', pos: 'QA STORE', account_balance: '4,400.00' }]],
  [['INR 500.00 credited to your IndusInd Bank A/c XX1234 on 05-Nov-26 towards UPI/000000000231/QA FRIEND. Avl Bal INR 4,900.00', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]],
  [{ sort: 110, acct: 'credit_card', ...SPEND, t: 'indusind bank credit card {PAN} has been used for {AMT} at {POS} on {DATE:dd-MM-yy}\\. ?avl lmt {LIMIT}',
     s: [['Your IndusInd Bank Credit Card XX9999 has been used for INR 1,100.00 at QA STORE on 05-11-26. Avl Lmt INR 30,000.00', { amount: '1,100.00', pan: '9999', pos: 'QA STORE', available_limit: '30,000.00' }]] }]);

bank2('idfc', 'IDFC FIRST Bank', ['IDFCBK', 'IDFCFB'],
  'a/c {PANL} is debited by {AMT} on {DATE:dd/MM/yy HH:mm} to {POS}\\. ?new bal {BAL}\\. ?upi ref {REF}',
  'a/c {PANL} is credited by {AMT} on {DATE:dd/MM/yy HH:mm} from {POS}\\. ?new bal {BAL}\\. ?upi ref {REF}',
  [['Your A/C XXXXXXX1234 is debited by INR 450.00 on 05/11/26 10:00 to QA STORE. New Bal INR 5,550.00. UPI Ref 000000000209', { amount: '450.00', pan: '1234', pos: 'QA STORE', account_balance: '5,550.00' }]],
  [['Your A/C XXXXXXX1234 is credited by INR 500.00 on 05/11/26 10:00 from QA FRIEND. New Bal INR 6,050.00. UPI Ref 000000000232', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]],
  [{ sort: 110, acct: 'credit_card', ...SPEND, t: '{AMT} spent on idfc first bank credit card {PAN} at {POS} on {DATE:dd-MMM-yyyy}\\. ?avl limit:? {LIMIT}',
     s: [['INR 800.00 spent on IDFC FIRST Bank Credit Card XX9999 at QA STORE on 05-NOV-2026. Avl Limit: INR 50,000', { amount: '800.00', pan: '9999', pos: 'QA STORE' }]] }]);

bank2('yes', 'YES Bank', ['YESBNK', 'YESBKC'],
  '{AMT} debited from a/c {PAN} on {DATE:dd-MMM-yy} for upi to {POS} \\(upi ref no {REF}\\)\\. ?avl bal:? {BAL}',
  '{AMT} credited to a/c {PAN} on {DATE:dd-MMM-yy} for upi from {POS} \\(upi ref no {REF}\\)\\. ?avl bal:? {BAL}',
  [['INR 350.00 debited from A/c XX1234 on 05-NOV-26 for UPI to QA STORE (UPI Ref No 000000000210). Avl Bal: INR 2,650.00 -YES BANK', { amount: '350.00', pan: '1234', pos: 'QA STORE', account_balance: '2,650.00' }]],
  [['INR 500.00 credited to A/c XX1234 on 05-NOV-26 for UPI from QA FRIEND (UPI Ref No 000000000233). Avl Bal: INR 3,150.00 -YES BANK', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]],
  [{ sort: 110, acct: 'credit_card', ...SPEND, t: '{AMT} spent on yes bank credit card {PAN} at {POS} on {DATE:dd-MM-yyyy}\\. ?avl (?:bal|limit) {LIMIT}',
     s: [['INR 999.00 spent on YES BANK Credit Card XX9999 at QA OTT on 05-11-2026. Avl Bal INR 20,000', { amount: '999.00', pan: '9999', pos: 'QA OTT', available_limit: '20,000' }]] }]);

bank2('federal', 'Federal Bank', ['FEDBNK', 'FEDFIB', 'FIMONY', 'JUPITR', 'JUPTER'],
  '{AMT} debited from your a/c {PAN} to vpa {VPA} on {DATE:dd-MM-yyyy HH:mm:ss}\\. ?upi ref {REF}\\. ?bal {BAL}',
  '{AMT} credited to your a/c {PAN} from vpa {VPA} on {DATE:dd-MM-yyyy HH:mm:ss}\\. ?upi ref {REF}\\. ?bal {BAL}',
  [['Rs 400.00 debited from your A/c XX1234 to VPA qa.store@okqa on 05-11-2026 10:00:00. UPI Ref 000000000211. Bal Rs 3,600.00 -Federal Bank', { amount: '400.00', pan: '1234', pos: 'qa.store@okqa', account_balance: '3,600.00' }]],
  [['Rs 500.00 credited to your A/c XX1234 from VPA qa.friend@okqa on 05-11-2026 10:00:00. UPI Ref 000000000234. Bal Rs 4,100.00 -Federal Bank', { amount: '500.00', pan: '1234', pos: 'qa.friend@okqa' }]],
  [], { _doc: 'Fi and Jupiter run on Federal Bank accounts; their headers map here (same as senders.ts).' });

bank2('union', 'Union Bank of India', ['UNIONB', 'UBINBK'],
  'a/c {PAN} debited for rs:? ?{NUM} on {DATE:dd-MM-yyyy HH:mm:ss} by {RAIL} ref no {REF} avl bal rs:? ?{BALN}',
  'a/c {PAN} credited for rs:? ?{NUM} on {DATE:dd-MM-yyyy HH:mm:ss} by {RAIL} ref no {REF} avl bal rs:? ?{BALN}',
  [['A/c *1234 Debited for Rs:250.00 on 05-11-2026 10:00:00 by Mob Bk ref no 000000000212 Avl Bal Rs:7,750.00. If not you, Call 0000 -Union Bank of India', { amount: '250.00', pan: '1234', txn_type: 'net_banking', account_balance: '7,750.00' }]],
  [['A/c *1234 Credited for Rs:500.00 on 05-11-2026 10:00:00 by UPI ref no 000000000235 Avl Bal Rs:8,250.00 -Union Bank of India', { amount: '500.00', pan: '1234', txn_type: 'upi' }]]);

bank2('rbl', 'RBL Bank', ['RBLBNK', 'RBLCRD'],
  '{AMT} debited from rbl bank a/c {PAN} on {DATE:dd-MM-yy} to {POS} upi ref {REF}',
  '{AMT} credited to rbl bank a/c {PAN} on {DATE:dd-MM-yy} from {POS} upi ref {REF}',
  [['Rs 300.00 debited from RBL Bank A/c XX1234 on 05-11-26 to QA STORE UPI Ref 000000000213', { amount: '300.00', pan: '1234', pos: 'QA STORE' }]],
  [['Rs 500.00 credited to RBL Bank A/c XX1234 on 05-11-26 from QA FRIEND UPI Ref 000000000236', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]],
  [{ sort: 110, acct: 'credit_card', ...SPEND, anchor: true, t: 'spent {AMT} on rbl bank credit card {PAN} at {POS} on {DATE:dd-MM-yy}\\. ?avl limit {LIMIT}',
     s: [['Spent INR 450.00 on RBL Bank Credit Card XX9999 at QA STORE on 05-11-26. Avl Limit INR 25,000.00', { amount: '450.00', pan: '9999', pos: 'QA STORE' }]] },
   { sort: 60, acct: 'credit_card', type: 'statement', stmt: 'credit_card_bill', t: 'rbl bank credit card {PAN}: total amount due {DUE} minimum amount due {MIN} due date {DATE:dd-MM-yy}',
     s: [['RBL Bank Credit Card XX9999: Total Amount Due INR 9,000.00 Minimum Amount Due INR 450.00 Due Date 21-11-26', { pan: '9999', amount: '9,000.00', min_due_amount: '450.00' }]] }]);

bank2('airtel', 'Airtel Payments Bank', ['AIRBNK', 'AIRTLB'],
  '{AMT} debited from your airtel payments bank a/c {PAN} to {POS}\\. ?txn id {REF}\\. ?bal {BAL}',
  '{AMT} credited to your airtel payments bank a/c {PAN} from {POS}\\. ?txn id {REF}\\. ?bal {BAL}',
  [['Rs.200 debited from your Airtel Payments Bank a/c XX1234 to QA STORE. Txn ID 000000000214. Bal Rs.1,800', { amount: '200', pan: '1234', pos: 'QA STORE', account_balance: '1,800' }]],
  [['Rs.500 credited to your Airtel Payments Bank a/c XX1234 from QA FRIEND. Txn ID 000000000237. Bal Rs.2,300', { amount: '500', pan: '1234', pos: 'QA FRIEND' }]]);

bank2('bob', 'Bank of Baroda', ['BOBTXN', 'BOBSMS', 'BARODA', 'BOBCRD'],
  '{AMT} dr\\. from a/c {PANL} and cr\\. to {POS}\\. ?ref:{REF}\\. ?avl bal:? ?{BAL}',
  '{AMT} cr\\. to a/c {PANL} from {POS}\\. ?ref:{REF}\\. ?avl bal:? ?{BAL}',
  [['Rs.350.00 Dr. from A/C XXXXXX1234 and Cr. to qa.store@okqa. Ref:000000000215. AvlBal:Rs5,650.00(2026:11:05 10:00:00).- Bank of Baroda', { amount: '350.00', pan: '1234', pos: 'qa.store@okqa', account_balance: '5,650.00' }]],
  [['Rs.500.00 Cr. to A/C XXXXXX1234 from qa.friend@okqa. Ref:000000000238. AvlBal:Rs6,150.00(2026:11:05 10:00:00).- Bank of Baroda', { amount: '500.00', pan: '1234', pos: 'qa.friend@okqa' }]],
  [{ sort: 110, acct: 'credit_card', ...SPEND, account_name_override: 'BOBCARD', t: '{AMT} spent on your bobcard ending {PAN} at {POS} on {DATE:dd-MM-yyyy}',
     s: [['Rs.1,000 spent on your BOBCARD ending 9999 at QA STORE on 05-11-2026', { amount: '1,000', pan: '9999', pos: 'QA STORE' }]] }],
  { preprocessor: [{ find: 'AvlBal:\\s*Rs', replace: 'Avl Bal: Rs ', flags: 'gi' }], _doc: 'preprocessor demo: BOB glues "AvlBal:Rs5,650" — normalized before matching.' });

bank2('canara', 'Canara Bank', ['CANBNK', 'CNRBNK'],
  '{AMT} paid thru a/c {PAN} on {DATE:dd-MM-yy HH:mm:ss} to {POS}, upi ref {REF}',
  'an amount of {AMT} has been credited to your account {PANL} on {DATE:dd/MM/yyyy}\\. ?total avail\\.? ?bal {BAL}',
  [['Rs.400.00 paid thru A/C XX1234 on 05-11-26 10:00:00 to QA STORE, UPI Ref 000000000216. If not done, SMS BLOCK to 0000', { amount: '400.00', pan: '1234', pos: 'QA STORE' }]],
  [['An amount of INR 500.00 has been CREDITED to your account XXX1234 on 05/11/2026. Total Avail.bal INR 6,500.00 - Canara Bank', { amount: '500.00', pan: '1234', account_balance: '6,500.00' }]],
  [], { sender_regexes: ['^CANBNK$', '^CNRB[A-Z]{2}$'], _doc: 'sender_regexes demo: new Canara header variants match without a code change.' });

bank2('pnb', 'Punjab National Bank', ['PNBSMS', 'PUNBNK'],
  'a/c {PAN} debited {AMT} dt {DATE:dd-MM-yy HH:mm:ss} thru upi:{REF}\\. ?bal {BAL}',
  'a/c {PAN} credited {AMT} dt {DATE:dd-MM-yy} thru upi:{REF}\\. ?bal {BAL}',
  [['A/c XX1234 debited INR 300.00 Dt 05-11-26 10:00:00 thru UPI:000000000217.Bal INR 2,700.00 Not u?Fwd this SMS to 0000 to block UPI.-PNB', { amount: '300.00', pan: '1234', account_balance: '2,700.00' }]],
  [['A/c XX1234 credited INR 500.00 Dt 05-11-26 thru UPI:000000000218. Bal INR 3,200.00 -PNB', { amount: '500.00', pan: '1234' }]]);

bank2('dbs', 'DBS Bank', ['DBSBNK', 'DBSDGB'],
  'amount of {AMT} debited from your digibank a/c {PAN} on {DATE:dd-MM-yy} to {POS}\\. ?upi ref {REF}',
  'amount of {AMT} credited to your digibank a/c {PAN} on {DATE:dd-MM-yy} from {POS}\\. ?upi ref {REF}',
  [['Amount of INR 250.00 debited from your digibank a/c XX1234 on 05-11-26 to QA STORE. UPI Ref 000000000219', { amount: '250.00', pan: '1234', pos: 'QA STORE' }]],
  [['Amount of INR 500.00 credited to your digibank a/c XX1234 on 05-11-26 from QA FRIEND. UPI Ref 000000000239', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]]);

bank2('au', 'AU Small Finance Bank', ['AUBANK', 'AUSFBL'],
  'debited {AMT} from a/c {PAN} on {DATE:dd-MM-yyyy} to upi/{POS}/{REF}\\. ?avl bal {BAL}',
  'credited {AMT} to a/c {PAN} on {DATE:dd-MM-yyyy} from upi/{POS}/{REF}\\. ?avl bal {BAL}',
  [['Debited INR 300.00 from A/c XX1234 on 05-11-2026 to UPI/QA STORE/000000000220. Avl Bal INR 4,700.00 -AU Small Finance Bank', { amount: '300.00', pan: '1234', pos: 'QA STORE', account_balance: '4,700.00' }]],
  [['Credited INR 500.00 to A/c XX1234 on 05-11-2026 from UPI/QA FRIEND/000000000240. Avl Bal INR 5,200.00 -AU Small Finance Bank', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]]);

bank2('indian', 'Indian Bank', ['INDBNK', 'INDIAN'],
  'a/c {PAN} debited {AMT} on {DATE:dd-MM-yy} to {POS}\\. ?upi:{REF}',
  'a/c {PAN} credited {AMT} on {DATE:dd-MM-yy} by {POS}\\. ?upi:{REF}',
  [['A/c *1234 debited Rs. 200.00 on 05-11-26 to QA STORE. UPI:000000000221. Not you? SMS BLOCK to 0000 -Indian Bank', { amount: '200.00', pan: '1234', pos: 'QA STORE' }]],
  [['A/c *1234 credited Rs. 500.00 on 05-11-26 by QA FRIEND. UPI:000000000222 -Indian Bank', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]]);

bank2('boi', 'Bank of India', ['BOIIND', 'BOISMS'],
  '{AMT} debited a/c{PAN} and credited to {POS} via upi ref no {REF} on {DATE:ddMMMyy}',
  '{AMT} credited to your ac {PAN} on {DATE:dd-MM-yy} by upi ref no\\.? ?{REF}\\. ?avl bal {BALN}',
  [['Rs.250.00 debited A/cXX1234 and credited to QA STORE via UPI Ref No 000000000223 on 05Nov26. Call 0000, if not done by you. -BOI', { amount: '250.00', pan: '1234', pos: 'QA STORE' }]],
  [['BOI - Rs.500.00 Credited to your Ac XX1234 on 05-11-26 by UPI ref No.000000000224.Avl Bal 3500.00', { amount: '500.00', pan: '1234', account_balance: '3500.00' }]]);

bank2('bandhan', 'Bandhan Bank', ['BANDHN', 'BDNBNK'],
  '{AMT} has been debited from your account {PANL} on {DATE:dd-MM-yyyy} towards upi/{REF}/{POS}\\. ?available balance:? {BAL}',
  '{AMT} has been credited to your account {PANL} on {DATE:dd-MM-yyyy} towards upi/{REF}/{POS}\\. ?available balance:? {BAL}',
  [['INR 300.00 has been debited from your account XXXXXXXX1234 on 05-11-2026 towards UPI/000000000225/QA STORE. Available balance: INR 1,700.00 -Bandhan Bank', { amount: '300.00', pan: '1234', pos: 'QA STORE', account_balance: '1,700.00' }]],
  [['INR 500.00 has been credited to your account XXXXXXXX1234 on 05-11-2026 towards UPI/000000000241/QA FRIEND. Available balance: INR 2,200.00 -Bandhan Bank', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]]);

bank2('sib', 'South Indian Bank', ['SIBSMS', 'SIBANK'],
  'a/c {PAN} debited for {AMT} on {DATE:dd-MM-yy HH:mm} to {POS}, upi ref:{REF}\\. ?bal:? {BAL}',
  'a/c {PAN} credited with {AMT} on {DATE:dd-MM-yy HH:mm} from {POS}, upi ref:{REF}\\. ?bal:? {BAL}',
  [['Your A/c X1234 debited for Rs.200.00 on 05-11-26 10:00 to QA STORE, UPI Ref:000000000226. Bal: Rs.3,000.00 - South Indian Bank', { amount: '200.00', pan: '1234', pos: 'QA STORE', account_balance: '3,000.00' }]],
  [['Your A/c X1234 credited with Rs.500.00 on 05-11-26 10:00 from QA FRIEND, UPI Ref:000000000242. Bal: Rs.3,500.00 - South Indian Bank', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]]);

bank2('central', 'Central Bank of India', ['CENTBK', 'CBIBNK'],
  'a/c no {PANL} is debited for {AMT} on {DATE:dd-MM-yyyy} and credited to {POS} \\(upi ref no {REF}\\)',
  'a/c no {PANL} is credited by {AMT} on {DATE:dd-MM-yyyy} from {POS} \\(upi ref no {REF}\\)',
  [['Your a/c no XXXXXX1234 is debited for Rs.150.00 on 05-11-2026 and credited to QA STORE (UPI Ref no 000000000227) -Central Bank of India', { amount: '150.00', pan: '1234', pos: 'QA STORE' }]],
  [['Your a/c no XXXXXX1234 is credited by Rs.500.00 on 05-11-2026 from QA FRIEND (UPI Ref no 000000000243) -Central Bank of India', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]]);

bank2('iob', 'Indian Overseas Bank', ['IOBCHN', 'IOBBNK'],
  'a/c no\\. {PANL} is debited for {AMT} on {DATE:dd-MM-yy} and credited to a/c no\\. {CPANL} \\(upi ref no {REF}\\)',
  'a/c no\\. {PANL} is credited for {AMT} on {DATE:dd-MM-yy} from {POS} \\(upi ref no {REF}\\)',
  [['Your a/c no. XXXXX1234 is debited for Rs.180.00 on 05-11-26 and credited to a/c no. XXXXX9999 (UPI Ref no 000000000228) -IOB', { amount: '180.00', pan: '1234', counterparty_pan: '9999' }]],
  [['Your a/c no. XXXXX1234 is credited for Rs.500.00 on 05-11-26 from QA FRIEND (UPI Ref no 000000000244) -IOB', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]],
  [], { _doc: 'Debit names only the payee ACCOUNT (counterparty_pan) — if it is one of the owner\'s accounts, R3a pairs it as a transfer.' });

bank2('csb', 'CSB Bank', ['CSBANK', 'CSBBNK'],
  '{AMT} debited from your csb bank a/c {PAN} on {DATE:dd-MM-yy} for upi txn to {POS}\\. ?ref {REF}',
  '{AMT} credited to your csb bank a/c {PAN} on {DATE:dd-MM-yy} for upi txn from {POS}\\. ?ref {REF}',
  [['Rs.220.00 debited from your CSB Bank A/c XX1234 on 05-11-26 for UPI txn to QA STORE. Ref 000000000229', { amount: '220.00', pan: '1234', pos: 'QA STORE' }]],
  [['Rs.500.00 credited to your CSB Bank A/c XX1234 on 05-11-26 for UPI txn from QA FRIEND. Ref 000000000245', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]]);

bank2('kgb', 'Kerala Gramin Bank', ['KGBANK', 'KERGRB'],
  'a/c {PAN} debited {AMT} on {DATE:dd-MM-yy} by upi to {POS} ref {REF}\\. ?bal {BAL}',
  'a/c {PAN} credited {AMT} on {DATE:dd-MM-yy} by upi from {POS} ref {REF}\\. ?bal {BAL}',
  [['Your A/c XX1234 debited Rs.100.00 on 05-11-26 by UPI to QA STORE Ref 000000000230. Bal Rs.900.00 -Kerala Gramin Bank', { amount: '100.00', pan: '1234', pos: 'QA STORE', account_balance: '900.00' }]],
  [['Your A/c XX1234 credited Rs.500.00 on 05-11-26 by UPI from QA FRIEND Ref 000000000246. Bal Rs.1,400.00 -Kerala Gramin Bank', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]]);

// ---------------------------------------------------------------- card-only issuers
I('amex', 'American Express', 'card', ['AMEXIN', 'AMEXIC'], [
  { sort: 100, acct: 'credit_card', ...SPEND, doc: '5-digit card tail (** 91234) → last 4.',
    t: "spent {AMT} on your amex card {PAN5} at {POS} on {DATE:dd MMMM yyyy 'at' hh:mm a}",
    s: [["Alert: You've spent INR 2,500.00 on your AMEX card ** 91234 at QA STORE on 05 November 2026 at 10:00 AM IST.", { amount: '2,500.00', pan: '1234', pos: 'QA STORE' }]] },
  { sort: 90, acct: 'credit_card', dir: 'credit', kind: 'card_payment', data: { pos: { value: 'Card bill payment received' }, ...CHAIN_CARD_PAYMENT },
    t: 'payment of {AMT} has been credited to your amex card {PAN5} on {DATE:dd MMMM yyyy}',
    s: [['We have received your payment of INR 10,000.00. Payment of INR 10,000.00 has been credited to your AMEX card ** 91234 on 05 November 2026.', { amount: '10,000.00', pan: '1234', money_kind: 'card_payment' }]] },
]);
I('onecard', 'OneCard', 'card', ['ONECRD', 'OBCARD'], [
  { sort: 100, acct: 'credit_card', ...SPEND, t: '{AMT} spent on onecard credit card {PAN} at {POS} on {DATE:dd MMM}\\. ?available limit:? {LIMIT}',
    s: [['Rs.650 spent on OneCard Credit Card XX9999 at QA STORE on 05 Nov. Available limit: Rs.30,000', { amount: '650', pan: '9999', pos: 'QA STORE', available_limit: '30,000' }]] },
]);

// ================================================================ LIVE BANKS (v4) — owner request 2026-11-09
// Sender IDs: own proposals, kept only where they match the public header listing (cross-checked);
// NKGSB unconfirmed → regex fallback. Templates are original, best-effort public shapes (unverified).
// Families these banks don't get here (ATM, cheque, NEFT, refund, EMI, statements) come from generic_bank.
const XC = { sender_status: 'cross-checked' };
bank2('bom', 'Bank of Maharashtra', ['MAHABK'],
  'a/c no {PANL} debited by {AMT} on {DATE:dd-MM-yy} for upi/{POS}/{REF}\\. ?avl bal {BAL}',
  'a/c no {PANL} credited by {AMT} on {DATE:dd-MM-yy} for upi/{POS}/{REF}\\. ?avl bal {BAL}',
  [['Your A/c No XXXXXX1234 debited by Rs.250.00 on 05-11-26 for UPI/QA STORE/000000000401. Avl Bal Rs.3,750.00 -Bank of Maharashtra', { amount: '250.00', pan: '1234', pos: 'QA STORE', account_balance: '3,750.00' }]],
  [['Your A/c No XXXXXX1234 credited by Rs.500.00 on 05-11-26 for UPI/QA FRIEND/000000000402. Avl Bal Rs.4,250.00 -Bank of Maharashtra', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]],
  [], { ...XC, sender_regexes: ['^MAHA[A-Z]{2}$'] });

bank2('idbi', 'IDBI Bank', ['IDBIBK'],
  'idbi bank a/c {PAN} debited for {AMT} on {DATE:dd-MM-yy} towards upi ref {REF} to {POS}\\. ?bal {BAL}',
  'idbi bank a/c {PAN} credited with {AMT} on {DATE:dd-MM-yy} towards upi ref {REF} from {POS}\\. ?bal {BAL}',
  [['Your IDBI Bank A/c XX1234 debited for INR 300.00 on 05-11-26 towards UPI Ref 000000000403 to QA STORE. Bal INR 2,700.00', { amount: '300.00', pan: '1234', pos: 'QA STORE', account_balance: '2,700.00' }]],
  [['Your IDBI Bank A/c XX1234 credited with INR 500.00 on 05-11-26 towards UPI Ref 000000000404 from QA FRIEND. Bal INR 3,200.00', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]],
  [], { ...XC, sender_regexes: ['^IDBI[A-Z]{2}$'] });

bank2('kvb', 'Karur Vysya Bank', ['KVBANK'],
  'a/c {PANL} is debited with {AMT} on {DATE:dd-MM-yyyy} towards upi ref:? ?{REF} to {POS}\\. ?avl bal {BAL}',
  'a/c {PANL} is credited with {AMT} on {DATE:dd-MM-yyyy} towards upi ref:? ?{REF} from {POS}\\. ?avl bal {BAL}',
  [['Your a/c XXXX1234 is debited with Rs.200.00 on 05-11-2026 towards UPI Ref:000000000405 to QA STORE. Avl Bal Rs.1,800.00 -KVB', { amount: '200.00', pan: '1234', pos: 'QA STORE', account_balance: '1,800.00' }]],
  [['Your a/c XXXX1234 is credited with Rs.500.00 on 05-11-2026 towards UPI Ref:000000000406 from QA FRIEND. Avl Bal Rs.2,300.00 -KVB', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]],
  [], { ...XC, sender_regexes: ['^KVB[A-Z]{3}$'] });

bank2('cub', 'City Union Bank', ['CUBANK'],
  'a/c {PAN} debited {AMT} on {DATE:dd-MM-yy} info:upi/{REF}/{POS}\\. ?bal {BAL}',
  'a/c {PAN} credited {AMT} on {DATE:dd-MM-yy} info:upi/{REF}/{POS}\\. ?bal {BAL}',
  [['A/c XX1234 debited Rs.180.00 on 05-11-26 Info:UPI/000000000407/QA STORE. Bal Rs.1,820.00 -CUB', { amount: '180.00', pan: '1234', pos: 'QA STORE', account_balance: '1,820.00' }]],
  [['A/c XX1234 credited Rs.500.00 on 05-11-26 Info:UPI/000000000408/QA FRIEND. Bal Rs.2,320.00 -CUB', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]],
  [], { ...XC, sender_regexes: ['^CUB[A-Z]{3}$'] });

bank2('tmb', 'Tamilnad Mercantile Bank', ['TMBANK'],
  'a/c no\\.? ?{PANL} is debited for {AMT} on {DATE:dd-MM-yy} by upi-{REF}-{POS}\\. ?avl bal {BAL}',
  'a/c no\\.? ?{PANL} is credited for {AMT} on {DATE:dd-MM-yy} by upi-{REF}-{POS}\\. ?avl bal {BAL}',
  [['Your A/c No.XXXX1234 is debited for Rs.150.00 on 05-11-26 by UPI-000000000409-QA STORE. Avl Bal Rs.850.00 -TMB', { amount: '150.00', pan: '1234', pos: 'QA STORE', account_balance: '850.00' }]],
  [['Your A/c No.XXXX1234 is credited for Rs.500.00 on 05-11-26 by UPI-000000000410-QA FRIEND. Avl Bal Rs.1,350.00 -TMB', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]],
  [], { ...XC, sender_regexes: ['^TMB[A-Z]{3}$'] });

bank2('jkb', 'Jammu & Kashmir Bank', ['JKBANK'],
  'a/c {PAN} has been debited by {AMT} on {DATE:dd-MM-yy} via upi to {POS} ref {REF}\\. ?avl bal {BAL}',
  'a/c {PAN} has been credited by {AMT} on {DATE:dd-MM-yy} via upi from {POS} ref {REF}\\. ?avl bal {BAL}',
  [['Your A/C XX1234 has been debited by INR 220.00 on 05-11-26 via UPI to QA STORE Ref 000000000411. Avl Bal INR 3,780.00 -J&K Bank', { amount: '220.00', pan: '1234', pos: 'QA STORE', account_balance: '3,780.00' }]],
  [['Your A/C XX1234 has been credited by INR 500.00 on 05-11-26 via UPI from QA FRIEND Ref 000000000412. Avl Bal INR 4,280.00 -J&K Bank', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]],
  [], { ...XC, sender_regexes: ['^JKB[A-Z]{3}$'] });

bank2('kbl', 'Karnataka Bank', ['KBLBNK', 'KTKBNK'],
  'a/c {PAN} debited for {AMT} on {DATE:dd-MM-yy} upi ref {REF} to {POS}\\. ?bal {BAL}',
  'a/c {PAN} credited with {AMT} on {DATE:dd-MM-yy} upi ref {REF} from {POS}\\. ?bal {BAL}',
  [['Your A/c XX1234 debited for Rs 260.00 on 05-11-26 UPI Ref 000000000413 to QA STORE. Bal Rs 2,740.00 -Karnataka Bank', { amount: '260.00', pan: '1234', pos: 'QA STORE', account_balance: '2,740.00' }]],
  [['Your A/c XX1234 credited with Rs 500.00 on 05-11-26 UPI Ref 000000000414 from QA FRIEND. Bal Rs 3,240.00 -Karnataka Bank', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]],
  [], XC);

bank2('saraswat', 'Saraswat Co-operative Bank', ['SARBNK'],
  'a/c {PANL} debited {AMT} on {DATE:dd-MM-yy} towards upi/{REF}/{POS}\\. ?clr bal {BAL}',
  'a/c {PANL} credited {AMT} on {DATE:dd-MM-yy} towards upi/{REF}/{POS}\\. ?clr bal {BAL}',
  [['A/c XXXX1234 debited INR 210.00 on 05-11-26 towards UPI/000000000415/QA STORE. Clr Bal INR 1,790.00 -Saraswat Bank', { amount: '210.00', pan: '1234', pos: 'QA STORE', account_balance: '1,790.00' }]],
  [['A/c XXXX1234 credited INR 500.00 on 05-11-26 towards UPI/000000000416/QA FRIEND. Clr Bal INR 2,290.00 -Saraswat Bank', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]],
  [], { ...XC, sender_regexes: ['^SAR[A-Z]{3}$'] });

bank2('equitas', 'Equitas Small Finance Bank', ['EQUTAS'],
  '{AMT} debited from your equitas a/c {PAN} on {DATE:dd-MM-yy} for upi txn to {POS}\\. ?ref {REF}\\. ?avl bal {BAL}',
  '{AMT} credited to your equitas a/c {PAN} on {DATE:dd-MM-yy} for upi txn from {POS}\\. ?ref {REF}\\. ?avl bal {BAL}',
  [['INR 330.00 debited from your Equitas A/c XX1234 on 05-11-26 for UPI txn to QA STORE. Ref 000000000417. Avl Bal INR 2,670.00', { amount: '330.00', pan: '1234', pos: 'QA STORE', account_balance: '2,670.00' }]],
  [['INR 500.00 credited to your Equitas A/c XX1234 on 05-11-26 for UPI txn from QA FRIEND. Ref 000000000418. Avl Bal INR 3,170.00', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]],
  [], { ...XC, sender_regexes: ['^EQ[A-Z]{4}$'] });

bank2('svc', 'SVC Co-operative Bank', ['SVCBNK'],
  '{AMT} debited from svc bank a/c {PAN} on {DATE:dd-MM-yy} to {POS} upi ref {REF}',
  '{AMT} credited to svc bank a/c {PAN} on {DATE:dd-MM-yy} from {POS} upi ref {REF}',
  [['Rs.140.00 debited from SVC Bank A/c XX1234 on 05-11-26 to QA STORE UPI Ref 000000000419', { amount: '140.00', pan: '1234', pos: 'QA STORE' }]],
  [['Rs.500.00 credited to SVC Bank A/c XX1234 on 05-11-26 from QA FRIEND UPI Ref 000000000420', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]],
  [], XC);

bank2('fino', 'Fino Payments Bank', ['FINOBK'],
  '{AMT} debited from your fino payments bank a/c {PAN} to {POS}\\. ?txn id {REF}\\. ?bal {BAL}',
  '{AMT} credited to your fino payments bank a/c {PAN} from {POS}\\. ?txn id {REF}\\. ?bal {BAL}',
  [['Rs.100 debited from your Fino Payments Bank A/c XX1234 to QA STORE. Txn ID 000000000421. Bal Rs.900', { amount: '100', pan: '1234', pos: 'QA STORE', account_balance: '900' }]],
  [['Rs.500 credited to your Fino Payments Bank A/c XX1234 from QA FRIEND. Txn ID 000000000422. Bal Rs.1,400', { amount: '500', pan: '1234', pos: 'QA FRIEND' }]],
  [], { ...XC, sender_regexes: ['^FINO[A-Z]{2}$'] });

bank2('psb', 'Punjab & Sind Bank', ['PSBANK'],
  'a/c {PAN} debited {AMT} on {DATE:dd-MM-yy} by upi ref {REF} to {POS}\\. ?bal {BAL}',
  'a/c {PAN} credited {AMT} on {DATE:dd-MM-yy} by upi ref {REF} from {POS}\\. ?bal {BAL}',
  [['A/c XX1234 debited INR 190.00 on 05-11-26 by UPI ref 000000000423 to QA STORE. Bal INR 1,810.00 -Punjab & Sind Bank', { amount: '190.00', pan: '1234', pos: 'QA STORE', account_balance: '1,810.00' }]],
  [['A/c XX1234 credited INR 500.00 on 05-11-26 by UPI ref 000000000424 from QA FRIEND. Bal INR 2,310.00 -Punjab & Sind Bank', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]],
  [], XC);

bank2('nkgsb', 'NKGSB Co-operative Bank', ['NKGSBB'],
  'a/c {PAN} is debited for {AMT} on {DATE:dd-MM-yy} upi ref {REF} to {POS} -nkgsb',
  'a/c {PAN} is credited for {AMT} on {DATE:dd-MM-yy} upi ref {REF} from {POS} -nkgsb',
  [['Your A/c XX1234 is debited for Rs.170.00 on 05-11-26 UPI Ref 000000000425 to QA STORE -NKGSB Bank', { amount: '170.00', pan: '1234', pos: 'QA STORE' }]],
  [['Your A/c XX1234 is credited for Rs.500.00 on 05-11-26 UPI Ref 000000000426 from QA FRIEND -NKGSB Bank', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]],
  [], { sender_status: 'unconfirmed', sender_regexes: ['^NKGSB[A-Z]?$', '^NKG[A-Z]{3}$'] });

bank2('ujjivan', 'Ujjivan Small Finance Bank', ['UJJIVN'],
  '{AMT} debited from ujjivan sfb a/c {PAN} on {DATE:dd-MM-yy} to {POS} via upi\\. ?ref {REF}\\. ?bal {BAL}',
  '{AMT} credited to ujjivan sfb a/c {PAN} on {DATE:dd-MM-yy} from {POS} via upi\\. ?ref {REF}\\. ?bal {BAL}',
  [['INR 230.00 debited from Ujjivan SFB A/c XX1234 on 05-11-26 to QA STORE via UPI. Ref 000000000427. Bal INR 1,770.00', { amount: '230.00', pan: '1234', pos: 'QA STORE', account_balance: '1,770.00' }]],
  [['INR 500.00 credited to Ujjivan SFB A/c XX1234 on 05-11-26 from QA FRIEND via UPI. Ref 000000000428. Bal INR 2,270.00', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]],
  [], XC);

bank2('uco', 'UCO Bank', ['UCOBNK'],
  'a/c {PAN} debited with {AMT} on {DATE:dd-MM-yyyy} by upi to {POS} ref {REF}\\. ?avl bal {BAL}',
  'a/c {PAN} credited with {AMT} on {DATE:dd-MM-yyyy} by upi from {POS} ref {REF}\\. ?avl bal {BAL}',
  [['A/c XX1234 Debited with Rs.240.00 on 05-11-2026 by UPI to QA STORE Ref 000000000429. Avl Bal Rs.2,760.00 -UCO Bank', { amount: '240.00', pan: '1234', pos: 'QA STORE', account_balance: '2,760.00' }]],
  [['A/c XX1234 Credited with Rs.500.00 on 05-11-2026 by UPI from QA FRIEND Ref 000000000430. Avl Bal Rs.3,260.00 -UCO Bank', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]],
  [], { ...XC, sender_regexes: ['^UCO[A-Z]{3}$'] });

bank2('ippb', 'India Post Payments Bank', ['IPBMSG'],
  '{AMT} debited from your ippb a/c {PAN} to {POS} on {DATE:dd-MM-yy}\\. ?upi ref {REF}\\. ?bal {BAL}',
  '{AMT} credited to your ippb a/c {PAN} from {POS} on {DATE:dd-MM-yy}\\. ?upi ref {REF}\\. ?bal {BAL}',
  [['Rs.120.00 debited from your IPPB A/c XX1234 to QA STORE on 05-11-26. UPI Ref 000000000431. Bal Rs.880.00', { amount: '120.00', pan: '1234', pos: 'QA STORE', account_balance: '880.00' }]],
  [['Rs.500.00 credited to your IPPB A/c XX1234 from QA FRIEND on 05-11-26. UPI Ref 000000000432. Bal Rs.1,380.00', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]],
  [], { ...XC, account_name_override: 'India Post Payments Bank' });

bank2('jio', 'Jio Payments Bank / JioMoney', ['JIOMNY'],
  '{AMT} debited from your jio payments bank a/c {PAN} to {POS}\\. ?upi ref {REF}',
  '{AMT} credited to your jio payments bank a/c {PAN} from {POS}\\. ?upi ref {REF}',
  [['Rs.150 debited from your Jio Payments Bank A/c XX1234 to QA STORE. UPI Ref 000000000433', { amount: '150', pan: '1234', pos: 'QA STORE' }]],
  [['Rs.500 credited to your Jio Payments Bank A/c XX1234 from QA FRIEND. UPI Ref 000000000434', { amount: '500', pan: '1234', pos: 'QA FRIEND' }]],
  [], { ...XC, sender_regexes: ['^JIO[A-Z]{3}$'] });

// banks with card businesses
bank2('hsbc', 'HSBC India', ['HSBCIN', 'HSBCBK'],
  'hsbc a/c {PAN} debited {AMT} on {DATE:ddMMMyy} for upi to {POS}\\.',
  'hsbc a/c {PAN} credited {AMT} on {DATE:ddMMMyy} for upi from {POS}\\.',
  [['HSBC A/c XXX1234 debited INR 500.00 on 05NOV26 for UPI to QA STORE.', { amount: '500.00', pan: '1234', pos: 'QA STORE' }]],
  [['HSBC A/c XXX1234 credited INR 500.00 on 05NOV26 for UPI from QA FRIEND.', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]],
  [{ sort: 110, acct: 'credit_card', ...SPEND, t: '{AMT} spent on hsbc credit card {PAN} at {POS} on {DATE:dd MMM yyyy}\\. ?avl limit {LIMIT}',
     s: [['INR 1,250.00 spent on HSBC Credit Card XX9999 at QA STORE on 05 Nov 2026. Avl Limit INR 1,20,000.00', { amount: '1,250.00', pan: '9999', pos: 'QA STORE', available_limit: '1,20,000.00' }]] }],
  XC);

bank2('stanc', 'Standard Chartered', ['SCBANK'],
  '{AMT} debited from your standard chartered a/c {PAN} on {DATE:dd/MM/yy} to {POS}\\. ?upi ref {REF}',
  '{AMT} credited to your standard chartered a/c {PAN} on {DATE:dd/MM/yy} from {POS}\\. ?upi ref {REF}',
  [['INR 400.00 debited from your Standard Chartered A/c XX1234 on 05/11/26 to QA STORE. UPI Ref 000000000435', { amount: '400.00', pan: '1234', pos: 'QA STORE' }]],
  [['INR 500.00 credited to your Standard Chartered A/c XX1234 on 05/11/26 from QA FRIEND. UPI Ref 000000000436', { amount: '500.00', pan: '1234', pos: 'QA FRIEND' }]],
  [{ sort: 110, acct: 'credit_card', ...SPEND, t: 'standard chartered credit card {PAN} has been used for {AMT} at {POS} on {DATE:dd/MM/yy}',
     s: [['Your Standard Chartered Credit Card XX9999 has been used for INR 1,800.00 at QA STORE on 05/11/26.', { amount: '1,800.00', pan: '9999', pos: 'QA STORE' }]] }],
  { ...XC, sender_regexes: ['^SCB[A-Z]{3}$'] });

// NBFC: loans + EMI card (not a bank account)
I('bajaj', 'Bajaj Finserv', 'card', ['BAJAJF'], [
  { sort: 100, acct: 'credit_card', ...SPEND, account_name_override: 'Bajaj Finserv EMI Card',
    doc: 'EMI-card purchase: a real spend; the EMI schedule it creates is a loan (R5e).',
    t: '{AMT} spent on your bajaj finserv (?:emi network )?card {PAN} at {POS} on {DATE:dd-MM-yy}',
    s: [['Rs.15,000.00 spent on your Bajaj Finserv EMI Network Card XX9999 at QA ELECTRONICS on 05-11-26.', { amount: '15,000.00', pan: '9999', pos: 'QA ELECTRONICS' }]] },
  { sort: 40, acct: 'loan', type: 'notice', notice: 'emi_due',
    t: 'emi of {AMT} for your bajaj finserv loan (?:a/c )?{PAN} is due on {DATE:dd-MM-yy}',
    s: [['EMI of Rs.2,499.00 for your Bajaj Finserv loan A/c XX0099 is due on 05-11-26. Keep sufficient balance.', { amount: '2,499.00', pan: '0099' }]] },
  { sort: 90, acct: 'loan', dir: 'debit', kind: 'emi', data: { pos: { value: 'Loan EMI' } },
    t: 'emi of {AMT} for your bajaj finserv loan (?:a/c )?{CPAN} has been (?:debited|received|paid)',
    s: [['EMI of Rs.2,499.00 for your Bajaj Finserv loan A/c XX0099 has been received on 05-11-26. Thank you.', { amount: '2,499.00', counterparty_pan: '0099', money_kind: 'emi' }]] },
], { ...XC, sender_regexes: ['^BAJAJ[A-Z]$', '^BFL[A-Z]{3}$'] });

// ================================================================ GENERIC LAYERS (v2.1)
// Closes the family gaps found by comparing with chitta-ref-app's family mix (cheque, NEFT/IMPS/RTGS, ATM, reversal,
// EMI, card alerts, statements) for EVERY bank — including banks with no issuer entry (unknown DLT senders).
// Engine order: specific issuer patterns → this layer → reader v2. Bank name comes from the body / sender stage.
const D = 'dd-MM-yyyy|dd/MM/yyyy|dd-MMM-yyyy|dd-MM-yy|dd/MM/yy|dd-MMM-yy|ddMMMyy';
I('generic_bank', 'Any bank (generic families)', 'bank', [], [
  // --- NEFT / IMPS / RTGS
  { sort: 100, acct: 'bank', ...IN,
    data: { pos_type_rules: { group_id: null, rules: [{ value: '\\b(?:sal|salary|payroll)\\b', category: 'salary' }] } },
    t: `{AMT} (?:has been )?credited to (?:your )?a/c {PAN} on {DATE:${D}} by {RAIL} from {NOTE}\\.? ?(?:utr|ref)(?: no)?\\.?:? ?{REFA}`,
    s: [['Rs.25,000.00 credited to your A/c XX1234 on 05-11-26 by NEFT from QA CLIENT PVT LTD. UTR QANEFT0000000001', { amount: '25,000.00', pan: '1234', txn_type: 'bank_transfer', network_reference_id: 'QANEFT0000000001' }],
        ['INR 60,000.00 has been credited to A/c XX1234 on 01-11-2026 by NEFT from QA EMPLOYER SALARY. UTR QANEFT0000000002', { amount: '60,000.00', category: 'salary' }]] },
  { sort: 101, acct: 'bank', ...SPEND,
    t: `{AMT} (?:has been )?debited from (?:your )?a/c {PAN} on {DATE:${D}} (?:by|via|through) {RAIL} to {POS}\\.? ?(?:utr|ref)(?: no)?\\.?:? ?{REFA}`,
    s: [['Rs.15,000.00 debited from your A/c XX1234 on 05-11-26 via IMPS to QA LANDLORD. Ref No 000000000301', { amount: '15,000.00', pan: '1234', pos: 'QA LANDLORD', txn_type: 'bank_transfer' }]] },
  // --- ATM
  { sort: 110, acct: 'bank', dir: 'debit', kind: 'atm', data: { pos: { value: 'ATM Withdrawal' } },
    t: `(?:cash )?withdrawal of {AMT} from (?:your )?a/c {PAN} at atm {NOTE} on {DATE:${D}}(?:.*?(?:avl|available)\\.? bal(?:ance)?:? {BAL})?`,
    s: [['Cash withdrawal of Rs.3,000.00 from your A/c XX1234 at ATM QA0002 on 05-11-26. Avl Bal Rs.7,000.00', { amount: '3,000.00', pan: '1234', money_kind: 'atm', account_balance: '7,000.00' }]] },
  { sort: 111, acct: 'bank', dir: 'debit', kind: 'atm', data: { pos: { value: 'ATM Withdrawal' } },
    t: `a/c {PAN} (?:is )?debited (?:by|with|for) {AMT} on {DATE:${D}} (?:for|towards) atm (?:cash )?(?:withdrawal|wdl)`,
    s: [['Your A/c XX1234 is debited by Rs.2,500.00 on 05-11-26 for ATM cash withdrawal at QA0003.', { amount: '2,500.00', pan: '1234', money_kind: 'atm' }]] },
  // --- cheque
  { sort: 120, acct: 'bank', ...IN, data: { pos: { value: 'Cheque deposit' }, category_hint: 'cheque' },
    t: 'cheque no\\.? ?\\d+ (?:for|of) {AMT} (?:has been )?(?:cleared and credited|credited|cleared|realised) (?:in|to) (?:your )?a/c {PAN}',
    s: [['Cheque No 000123 for Rs.8,000.00 has been cleared and credited to your A/c XX1234 on 05-11-26.', { amount: '8,000.00', pan: '1234', pos: 'Cheque deposit' }]] },
  { sort: 121, acct: 'bank', ...SPEND, data: { pos: { value: 'Cheque' }, category_hint: 'cheque' },
    t: 'cheque no\\.? ?\\d+ (?:for|of) {AMT} (?:has been )?(?:paid|debited|cleared) from (?:your )?a/c {PAN}',
    s: [['Cheque No 000124 for Rs.5,000.00 has been paid from your A/c XX1234 on 05-11-26.', { amount: '5,000.00', pan: '1234', pos: 'Cheque' }]] },
  { sort: 20, acct: 'bank', type: 'ignore', ignore: 'cheque_returned', t: 'cheque no\\.? ?\\d+ (?:for|of) .{0,30}?(?:has been )?(?:returned|bounced|dishonou?red)',
    s: [['Cheque No 000125 for Rs.4,000.00 has been returned unpaid for reason: funds insufficient.', {}]] },
  // --- reversal / refund
  { sort: 90, acct: 'bank', dir: 'credit', kind: 'refund', data: { pos: { value: 'Reversal' } },
    t: `{AMT} (?:has been )?(?:reversed|refunded) (?:to|in|into) (?:your )?a/c {PAN}(?: on {DATE:${D}})?(?:.*?ref(?:erence)?(?: no)?\\.?:? ?{REF})?`,
    s: [['Rs.499.00 has been reversed to your A/c XX1234 on 05-11-26 against failed UPI txn Ref No 000000000302.', { amount: '499.00', pan: '1234', network_reference_id: '000000000302', money_kind: 'refund' }]] },
  { sort: 91, acct: 'bank', dir: 'credit', kind: 'refund',
    t: 'refund of {AMT} (?:from {POS} )?(?:has been )?credited to (?:your )?(?:[a-z]+ ){0,3}{ACCT} {PAN}',
    s: [['Refund of Rs.1,299.00 from QA SHOP has been credited to your QA Bank Credit Card XX9999 on 05-11-26.', { amount: '1,299.00', pos: 'QA SHOP', pan: '9999', txn_type: 'card' }],
        ['Refund of Rs.300.00 has been credited to your A/c XX1234.', { amount: '300.00', pan: '1234', txn_type: 'account' }]] },
  // --- EMI / loan
  { sort: 95, acct: 'bank', dir: 'debit', kind: 'emi', data: { pos: { value: 'Loan EMI' } },
    t: 'emi of {AMT} (?:for|towards) (?:your )?loan a/c {CPAN} (?:has been )?debited from (?:your )?a/c {PAN}',
    s: [['EMI of Rs.8,450.00 for your Loan A/c XX0099 has been debited from your A/c XX1234 on 05-11-26.', { amount: '8,450.00', pan: '1234', counterparty_pan: '0099', money_kind: 'emi' }]] },
  { sort: 40, acct: 'loan', type: 'notice', notice: 'emi_due',
    t: `emi of {AMT} (?:for|on) (?:your )?loan a/c {PAN} is due on {DATE:${D}}`,
    s: [['EMI of Rs.8,450.00 for your Loan A/c XX0099 is due on 10-11-26. Keep sufficient balance.', { amount: '8,450.00', pan: '0099' }]] },
  // --- cards
  { sort: 130, acct: 'credit_card', ...SPEND,
    t: `(?:spent|purchase of|txn of) {AMT} (?:on|using) (?:your )?(?:[a-z]+ ){0,3}{CARDTYPE} card {PAN} at {POS} on {DATE:${D}}`,
    s: [['Spent Rs.560.00 on your QA Bank Credit Card XX9999 at QA CAFE on 05-11-26.', { amount: '560.00', pan: '9999', pos: 'QA CAFE', txn_type: 'credit_card' }],
        ['Purchase of Rs.2,340.00 using your QA Bank Debit Card XX9999 at QA MART on 05-11-2026.', { amount: '2,340.00', pan: '9999', pos: 'QA MART', txn_type: 'debit_card' }]] },
  { sort: 85, acct: 'credit_card', dir: 'credit', kind: 'card_payment', data: { pos: { value: 'Card bill payment received' }, ...CHAIN_CARD_PAYMENT },
    t: 'payment of {AMT} (?:has been )?received (?:on|towards|for) (?:your )?(?:[a-z]+ ){0,3}credit card {PAN}',
    s: [['Payment of Rs.15,000.00 has been received towards your QA Bank Credit Card XX9999. Thank you.', { amount: '15,000.00', pan: '9999', money_kind: 'card_payment' }]] },
  { sort: 50, acct: 'credit_card', type: 'statement', stmt: 'credit_card_bill',
    t: `(?:statement for your (?:[a-z]+ ){0,3}credit card {PAN}|credit card {PAN} statement):? .*?total (?:amount |amt )?due:? {DUE},? .*?min(?:imum)? (?:amount |amt )?due:? {MIN},? .*?due (?:date|by|on):? {DATE:${D}}`,
    s: [['Statement for your QA Bank Credit Card XX9999: Total Amount Due Rs.15,000.00, Minimum Amount Due Rs.750.00, Due Date 22-11-26.', { pan: '9999', amount: '15,000.00', min_due_amount: '750.00' }],
        ['Credit Card XX9999 statement: Total Amt Due INR 6,200.00, Min Amt Due INR 310.00, due by 25-11-2026', { pan: '9999', amount: '6,200.00', min_due_amount: '310.00' }]] },
  // --- recurring / charges / interest / balance
  { sort: 140, acct: 'bank', ...SPEND, data: { recurring_hint: true },
    t: `{AMT} (?:has been )?debited from (?:your )?a/c {PAN}(?: on {DATE:${D}})? (?:for|towards) (?:your )?(?:e-?mandate|autopay|si|nach|ecs) (?:for|to|of) {POS}\\.`,
    s: [['Rs.649.00 debited from your A/c XX1234 on 05-11-26 towards your AutoPay for QA MUSIC.', { amount: '649.00', pan: '1234', pos: 'QA MUSIC', recurring: true }]] },
  { sort: 141, acct: 'bank', ...SPEND, data: { pos: { value: 'Bank charges' }, category_hint: 'fees' },
    t: '{AMT} (?:debited|charged|deducted) (?:from|to) (?:your )?a/c {PAN} (?:towards|for) {NOTE} charges',
    s: [['Rs.17.70 debited from your A/c XX1234 towards SMS alert charges for Q3.', { amount: '17.70', pan: '1234', note: 'SMS alert', pos: 'Bank charges' }]] },
  { sort: 142, acct: 'bank', dir: 'credit', kind: 'interest', data: { pos: { value: 'Interest' } },
    t: 'interest (?:amount )?of {AMT} (?:has been )?credited to (?:your )?(?:savings )?a/c {PAN}',
    s: [['Interest amount of Rs.1,045.00 has been credited to your Savings A/c XX1234 for the quarter.', { amount: '1,045.00', pan: '1234', money_kind: 'interest' }]] },
  { sort: 60, acct: 'bank', type: 'balance',
    t: '(?:avl|available|clear) bal(?:ance)? (?:in|of|for) (?:your )?a/c {PAN} (?:is|:) {BAL}',
    s: [['Available balance in your A/c XX1234 is Rs.12,000.00 as on 05-11-26.', { pan: '1234', account_balance: '12,000.00' }]] },
], { scope: 'financial_fallback', institution_from_body: true,
  _doc: 'Applies to every financial sender (known issuers after their own patterns; unknown DLT bank senders directly). Closes chitta-ref-app family gaps: NEFT/IMPS/RTGS, ATM, cheque, reversal/refund, EMI, card alerts, statements, mandates, charges, interest, balance.' });

// Biller layer: utilities, insurance, DTH/telecom, pay-later. NEVER creates transactions (bills/reminders only).
// Covers chitta-ref-app's electricity 39 / insurance 18 / gas 11 / pay_later 9 / phone 7 / DTH 5 issuers by SHAPE, not by sender.
I('generic_biller', 'Any biller (bills and reminders)', 'biller', [], [
  { sort: 100, acct: 'utility', type: 'statement', stmt: 'utility_bill',
    t: `bill (?:amount )?(?:of|for)? ?{DUE} (?:for|against) (?:your )?(?:consumer|ca|account|a/c|k|bp|customer|service|mobile|connection)\\.? ?(?:no\\.?|number|id)?:? ?[\\w-]+,? (?:is )?due (?:on|by|date):? {DATE:${D}}`,
    s: [['Dear Consumer, bill of Rs.1,840.00 for Consumer No 000012345678 is due on 15-11-26. Pay online to avoid late fee.', { amount: '1,840.00', date: '15-11-26' }],
        ['Your gas bill amount Rs.640.00 for BP No 000099887766 is due by 18-11-2026.', { amount: '640.00', date: '18-11-2026' }]] },
  { sort: 101, acct: 'insurance', type: 'statement', stmt: 'insurance_premium',
    t: `premium (?:of|amount) {DUE} (?:for|under) (?:your )?policy (?:no\\.? ?)?[\\w/-]+ (?:is )?due (?:on|by) {DATE:${D}}`,
    s: [['Premium of Rs.12,500.00 for your Policy No QA/0000123 is due on 30-11-2026. Pay now to keep your cover active.', { amount: '12,500.00', date: '30-11-2026' }]] },
  { sort: 102, acct: 'pay_later', type: 'statement', stmt: 'pay_later_bill',
    t: `(?:pay ?later )?bill amount of {DUE} is due (?:on|by) {DATE:${D}}`,
    s: [['Your QA PayLater bill amount of Rs.2,150.00 is due on 07-11-26. Pay on time to keep using PayLater.', { amount: '2,150.00', date: '07-11-26' }]] },
  { sort: 103, acct: 'utility', type: 'notice', notice: 'recharge_due',
    t: `(?:recharge|pack|plan|subscription) (?:of {AMT} )?(?:will )?expire[sd]? on {DATE:${D}}`,
    s: [['Your DTH pack of Rs.350 will expire on 08-11-26. Recharge now to continue viewing.', { amount: '350', date: '08-11-26' }]] },
], { scope: 'any_sender',
  _doc: 'Shape-based bill and reminder detection for utilities, insurance, telecom/DTH and pay-later. Output feeds R5b/R8 only.' });

const doc = {
  _doc: [
    'Tracker SMS rules overlay — schema v2 (field reference + per-issuer chitta-ref-app comparison: RULES.md next to this file).',
    'Format mirrors the chitta-ref-app rule ANATOMY; every regex, id and sample is ORIGINAL (synthetic bodies). Nothing copied from chitta-ref-app.',
    'Formats are best-effort from public SMS shapes (format_status: synthetic-unverified) — confirm each with tester "Share pattern" reports.',
    'Generated by scripts/rules/build_rules.js (templates with placeholders → regex + group ids). Edit the generator, not this file, while it exists.',
  ],
  schema_version: 2,
  version: 4,
  min_app_version: '0.9.0',
  format_status: 'synthetic-unverified',
  blacklist_regex: String.raw`\b(?:otp|one[\s-]?time[\s-]?password|verification\s+code|passcode|cvv)\b`,
  rules: R,
};
fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
console.log(`wrote ${out}: issuers ${R.length}, patterns ${R.reduce((n, r) => n + r.patterns.length, 0)}`);
