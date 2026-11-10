# SMS rules (rules.json) — reference and chitta-ref-app comparison

Generated 2026-11-08 by `scripts/rules/gen_coverage.js`. Do not edit by hand.

## What this is

- **Overlay, not replacement.** The R5g engine tries these templates first; no match falls back to reader v2 (`parser/readSms.ts`).
- **Original content.** The format mirrors the chitta-ref-app rule *anatomy* (issuer → senders → patterns → data_fields with
  capture-group ids). Every regex, id and sample is written from scratch against synthetic bodies (QA names, XX1234).
  chitta-ref-app numbers below are **counts only**, taken to explain coverage; no chitta-ref-app regex, sample or id is in this repo.
- **Formats are unverified** (`format_status: synthetic-unverified`): best-effort public shapes. Each pattern must be
  confirmed or corrected from tester "Share pattern" reports before it is trusted for auto-approve.

## chitta-ref-app logic → this schema (implemented by R5g)

| chitta-ref-app concept | Here | What it does |
|---|---|---|
| sender list per issuer | `senders` | DLT header IDs (after stripping `AX-`/`-S`) select the issuer |
| sender regexes | `sender_regexes` | new header variants without a code change (demo: Canara) |
| OTP blacklist | `blacklist_regex` | OTP / PIN / CVV texts never parse |
| pattern order | `sort_UID` | first match wins; specific forms (reversal, card payment, EMI) sort before generic debits |
| obsolete | `obsolete` (+ `obsolete_after`) | retired wording still parses old SMS in a re-scan (demo: HDFC) |
| preProcessor | `preprocessor` | fix glued text before matching (demo: BOB `AvlBal:Rs5,650`) |
| reparse | `reparse` | one SMS → several records (demo: ICICI ATM + fee) |
| sms_type | transaction / statement / notice / balance / event / ignore | bills, mandates, balance-only and failed SMS never become spending |
| account_type | bank / credit_card / debit_card / wallet / … | debit_card resolves to the bank a/c via R5d aliases |
| data_fields + group_id | amount, pan, pos, note, date, account_balance, available_limit, min_due_amount, currency, network_reference_id, counterparty_pan | capture group → field |
| date formats / use_sms_time | `date.formats` | body date when plausible, else SMS time |
| transaction_type_rule | `transaction_type_rule` (+ pos_override, set_no_pos, money_kind_override) | e.g. rail "Mob Bk" → net banking; "ATM" → cash; P2A → person |
| pos_type_rules | `pos_type_rules` (+ income_flag_override) | e.g. "SALARY" → salary category; "refund" → not income |
| network reference type | `network_reference_id.type_rule` | UPI / IMPS / NEFT / RTGS ref kind for refund + duplicate rankers |
| chaining (incomplete / deleted, parent/child override) | `chaining_rule` | duplicate alerts, reversal → original, card payment bank ↔ card — **suggestions only** in Tracker |
| account name override / set_account_as_expense | same names | display name in New accounts found; wallets: loads are transfers, spends are expenses |
| misc_information.get_balance | same | "Check balance" numbers (shown only when `verified`) |
| version / min_app_version | same | newest compatible document wins (bundled now, downloaded later) |
| *(Tracker only)* format_verified | issuer flag, default false (set on none yet) | N1 (owner 2026-11-10): template vs reader disagreement is held for review; `true` (after a tester's masked "Share pattern" confirmed the format) lets that issuer's templates win outright |
| *(Tracker only)* money_kind | spend · income · refund · transfer · card_payment · atm · wallet_load · emi · interest | the money **meaning** chitta-ref-app spreads over categories and account types |

## Totals

- Issuers: **49** (29 from `parser/senders.ts` + 20 live banks added 2026-11-09 — add their headers/aliases to senders.ts in R5g) + **2** generic layers (any bank, any biller). Patterns: **157** here vs **1791** active in chitta-ref-app for the same issuers.
- Reader v2 alone on our transaction samples: **123/145** fully right (amount + direction + last-4 **and** plain spend/income meaning).
  The rest is what the rules add (money meaning, 3-digit/long masks, wallet direction, reversal, currency).

| Issuer | chitta-ref-app active | chitta-ref-app txn/stmt/event | Ours | Reader v2 alone |
|---|--:|--:|--:|--:|
| HDFC Bank | 114 | 102/12/0 | 12 | 6/10 |
| ICICI Bank | 81 | 71/10/0 | 7 | 4/7 |
| State Bank of India | 81 | 76/5/0 | 9 | 4/7 |
| Axis Bank | 94 | 86/8/0 | 5 | 3/4 |
| Kotak Mahindra Bank | 107 | 100/7/0 | 5 | 5/5 |
| Paytm | 85 | 78/1/6 | 3 | 2/3 |
| Amazon Pay | 27 | 22/3/2 | 2 | 1/2 |
| IndusInd Bank | 59 | 55/4/0 | 3 | 3/3 |
| IDFC FIRST Bank | 56 | 48/8/0 | 3 | 3/3 |
| YES Bank | 54 | 50/4/0 | 3 | 3/3 |
| Federal Bank | 53 | 51/2/0 | 2 | 2/2 |
| Union Bank of India | 53 | 52/1/0 | 2 | 2/2 |
| RBL Bank | 51 | 39/12/0 | 4 | 3/3 |
| Airtel Payments Bank | 47 | 47/0/0 | 2 | 2/2 |
| Bank of Baroda | 45 | 38/7/0 | 3 | 3/3 |
| Canara Bank | 44 | 41/3/0 | 2 | 2/2 |
| Punjab National Bank | 39 | 38/1/0 | 2 | 2/2 |
| DBS Bank | 38 | 37/1/0 | 2 | 2/2 |
| AU Small Finance Bank | 38 | 34/4/0 | 2 | 2/2 |
| Indian Bank | 37 | 35/2/0 | 2 | 2/2 |
| Bank of India | 34 | 33/1/0 | 2 | 2/2 |
| Bandhan Bank | 23 | 23/0/0 | 2 | 2/2 |
| South Indian Bank | 23 | 23/0/0 | 2 | 2/2 |
| Central Bank of India | 22 | 20/2/0 | 2 | 2/2 |
| Indian Overseas Bank | 18 | 17/1/0 | 2 | 2/2 |
| CSB Bank | 4 | 4/0/0 | 2 | 2/2 |
| Kerala Gramin Bank | 4 | 4/0/0 | 2 | 2/2 |
| American Express | 9 | 5/4/0 | 2 | 1/2 |
| OneCard | — | — | 1 | 1/1 |
| Bank of Maharashtra | 32 | 30/2/0 | 2 | 2/2 |
| IDBI Bank | 27 | 25/2/0 | 2 | 2/2 |
| Karur Vysya Bank | 23 | 23/0/0 | 2 | 2/2 |
| City Union Bank | 23 | 22/1/0 | 2 | 2/2 |
| Tamilnad Mercantile Bank | 28 | 27/1/0 | 2 | 2/2 |
| Jammu & Kashmir Bank | 27 | 25/2/0 | 2 | 2/2 |
| Karnataka Bank | 21 | 21/0/0 | 2 | 2/2 |
| Saraswat Co-operative Bank | 25 | 24/1/0 | 2 | 2/2 |
| Equitas Small Finance Bank | 25 | 25/0/0 | 2 | 2/2 |
| SVC Co-operative Bank | 21 | 21/0/0 | 2 | 2/2 |
| Fino Payments Bank | 20 | 20/0/0 | 2 | 2/2 |
| Punjab & Sind Bank | 19 | 19/0/0 | 2 | 2/2 |
| NKGSB Co-operative Bank | 19 | 19/0/0 | 2 | 2/2 |
| Ujjivan Small Finance Bank | 18 | 18/0/0 | 2 | 2/2 |
| UCO Bank | 16 | 16/0/0 | 2 | 2/2 |
| India Post Payments Bank | 28 | 28/0/0 | 2 | 2/2 |
| Jio Payments Bank / JioMoney | 16 | 16/0/0 | 2 | 2/2 |
| HSBC India | 15 | 13/2/0 | 3 | 3/3 |
| Standard Chartered | 28 | 23/5/0 | 3 | 3/3 |
| Bajaj Finserv | 20 | 13/7/0 | 3 | 1/2 |
| Any bank (generic families) | — | — | 18 | 10/17 |
| Any biller (bills and reminders) | — | — | 4 | 0/0 |

## Per issuer — what chitta-ref-app has, what we have, why the gap

chitta-ref-app's large counts are mostly **variants of the same families**: banks reword alerts every year and chitta-ref-app keeps one
pattern per wording (plus obsolete ones). We keep **one template per family** and rely on reader v2 for variants;
new wordings arrive through tester "Share pattern" reports and become new templates (one PR, one sample each).

### HDFC Bank (`hdfc`)

- **Senders here:** HDFCBK, HDFCBN, HDFCCC
- **chitta-ref-app:** 114 active (+14 obsolete) · 7 sender IDs · transaction 102, statement 12, event 0 · captures balance in 43, reference in 25, chaining in 11
  - account types: bank 50, credit_card 25, prepaid 15, debit_card 13, loan 6, bill_pay 4, sip 1
  - transaction families: card spend 41, other 32, ATM/cash 14, NEFT/IMPS/RTGS 14, UPI 14, refund/reversal 10, salary/interest 4, cheque 2
- **Ours:** 12 patterns · debit 3, credit 2, card payment 2, card spend 1, refund/reversal 1, EMI/loan 1, notice 1, statement 1 · logic: chaining, obsolete, merchant rules
- **Reader v2 alone on these samples:** 6/10 — rules needed for: `T-HDFC-0007: parsed, but meaning 'card_payment' needs the rule`; `T-HDFC-0008: expense 250 last4=1234`; `T-HDFC-0009: parsed, but meaning 'emi' needs the rule`; `T-HDFC-0010: parsed, but meaning 'card_payment' needs the rule`
- **chitta-ref-app families missing from this issuer's own templates:** ATM withdrawal, cheque
- **Closed by the generic bank layer:** ATM withdrawal, cheque
- **Still pending:** none — confirm wording via tester shares

### ICICI Bank (`icici`)

- **Senders here:** ICICIB, ICICIT, ICICIO, ICICCC
- **chitta-ref-app:** 81 active (+18 obsolete) · 3 sender IDs · transaction 71, statement 10, event 0 · captures balance in 32, reference in 14, chaining in 4
  - account types: bank 38, credit_card 17, prepaid 16, loan 4, debit_card 3, sip 2, pay_later 1
  - transaction families: other 30, card spend 26, refund/reversal 9, UPI 8, ATM/cash 7, salary/interest 6, NEFT/IMPS/RTGS 5, EMI/loan 1
- **Ours:** 7 patterns · debit 2, credit 1, ATM/cash 1, card spend 1, card payment 1, statement 1 · logic: chaining, reparse, currency
- **Reader v2 alone on these samples:** 4/7 — rules needed for: `T-ICICI-0003: expense 23.6 last4=-`; `T-ICICI-0005: unknown_financial`; `T-ICICI-0006: parsed, but meaning 'card_payment' needs the rule`
- **chitta-ref-app families missing from this issuer's own templates:** NEFT/IMPS/RTGS wording, EMI / loan debit, reversal / refund
- **Closed by the generic bank layer:** NEFT/IMPS/RTGS wording, EMI / loan debit, reversal / refund
- **Still pending:** none — confirm wording via tester shares

### State Bank of India (`sbi`)

- **Senders here:** SBIBNK, SBIINB, SBIUPI, CBSSBI, ATMSBI, SBIPSG, SBYONO, SBICRD, SBICRF
- **chitta-ref-app:** 81 active (+14 obsolete) · 17 sender IDs · transaction 76, statement 5, event 0 · captures balance in 25, reference in 25, chaining in 0
  - account types: bank 50, credit_card 18, debit_card 8, prepaid 4, bill_pay 1
  - transaction families: other 32, card spend 17, ATM/cash 11, UPI 9, refund/reversal 6, cheque 5, salary/interest 5, NEFT/IMPS/RTGS 4
- **Ours:** 9 patterns · debit 2, credit 1, ATM/cash 1, own transfer 1, salary/interest 1, card spend 1, statement 1, ignore 1
- **Reader v2 alone on these samples:** 4/7 — rules needed for: `T-SBI-0003: expense 300 last4=-`; `T-SBI-0004: parsed, but meaning 'atm' needs the rule`; `T-SBI-0005: parsed, but meaning 'transfer' needs the rule`
- **chitta-ref-app families missing from this issuer's own templates:** NEFT/IMPS/RTGS wording, reversal / refund, cheque
- **Closed by the generic bank layer:** NEFT/IMPS/RTGS wording, reversal / refund, cheque
- **Still pending:** none — confirm wording via tester shares

### Axis Bank (`axis`)

- **Senders here:** AXISBK, AXISMR, AXISCC
- **chitta-ref-app:** 94 active (+6 obsolete) · 3 sender IDs · transaction 86, statement 8, event 0 · captures balance in 53, reference in 9, chaining in 0
  - account types: bank 52, prepaid 16, credit_card 14, debit_card 9, loan 3
  - transaction families: other 36, card spend 21, UPI 14, NEFT/IMPS/RTGS 12, ATM/cash 10, refund/reversal 8, salary/interest 2
- **Ours:** 5 patterns · credit 1, debit 1, card spend 1, card payment 1, balance 1 · logic: chaining, type rules
- **Reader v2 alone on these samples:** 3/4 — rules needed for: `T-AXIS-0004: parsed, but meaning 'card_payment' needs the rule`
- **chitta-ref-app families missing from this issuer's own templates:** NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, bill / statement
- **Closed by the generic bank layer:** NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, bill / statement
- **Still pending:** none — confirm wording via tester shares

### Kotak Mahindra Bank (`kotak`)

- **Senders here:** KOTAKB, KOTAKM
- **chitta-ref-app:** 107 active (+2 obsolete) · 4 sender IDs · transaction 100, statement 7, event 0 · captures balance in 45, reference in 36, chaining in 2
  - account types: bank 66, credit_card 16, prepaid 13, debit_card 7, loan 4, bill_pay 1
  - transaction families: other 42, card spend 26, UPI 13, NEFT/IMPS/RTGS 12, refund/reversal 10, salary/interest 8, ATM/cash 7, cheque 3, EMI/loan 1
- **Ours:** 5 patterns · debit 3, credit 1, card spend 1 · logic: type rules
- **Reader v2 alone on these samples:** 5/5
- **chitta-ref-app families missing from this issuer's own templates:** ATM withdrawal, EMI / loan debit, reversal / refund, cheque, bill / statement
- **Closed by the generic bank layer:** ATM withdrawal, EMI / loan debit, reversal / refund, cheque, bill / statement
- **Still pending:** none — confirm wording via tester shares

### Paytm (`paytm`)

- **Senders here:** IPAYTM, PAYTMW, PAYTMB, PYTMBK
- **chitta-ref-app:** 85 active (+5 obsolete) · 4 sender IDs · transaction 78, statement 1, event 6 · captures balance in 28, reference in 25, chaining in 3
  - account types: bank 36, prepaid 35, generic 6, pay_later 5, debit_card 3
  - transaction families: other 54, UPI 11, ATM/cash 5, refund/reversal 4, card spend 4, salary/interest 2, NEFT/IMPS/RTGS 1
- **Ours:** 3 patterns · debit 2, wallet top-up 1 · logic: account-as-expense
- **Reader v2 alone on these samples:** 2/3 — rules needed for: `T-PAYTM-0001: parsed, but meaning 'wallet_load' needs the rule`
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, ATM withdrawal, reversal / refund, bill / statement, travel / ticket events (deliberately skipped)
- **Closed by the generic bank layer:** card alerts, ATM withdrawal, reversal / refund, bill / statement
- **Still pending:** travel / ticket events (deliberately skipped)

### Amazon Pay (`amazonpay`)

- **Senders here:** AMAZON, AMZPAY
- **chitta-ref-app:** 27 active (+1 obsolete) · 27 sender IDs · transaction 22, statement 3, event 2 · captures balance in 8, reference in 4, chaining in 0
  - account types: prepaid 16, pay_later 8, generic 2, bill_pay 1
  - transaction families: other 10, refund/reversal 5, ATM/cash 3, card spend 2, UPI 1, EMI/loan 1
- **Ours:** 2 patterns · debit 1, wallet top-up 1 · logic: account-as-expense
- **Reader v2 alone on these samples:** 1/2 — rules needed for: `T-AMAZONPAY-0002: parsed, but meaning 'wallet_load' needs the rule`
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, ATM withdrawal, EMI / loan debit, reversal / refund, bill / statement, travel / ticket events (deliberately skipped)
- **Closed by the generic bank layer:** card alerts, ATM withdrawal, EMI / loan debit, reversal / refund, bill / statement
- **Still pending:** travel / ticket events (deliberately skipped)

### IndusInd Bank (`indusind`)

- **Senders here:** INDUSB, INDUSL
- **chitta-ref-app:** 59 active (+0 obsolete) · 3 sender IDs · transaction 55, statement 4, event 0 · captures balance in 27, reference in 20, chaining in 0
  - account types: bank 40, credit_card 11, prepaid 5, debit_card 2, loan 1
  - transaction families: other 19, card spend 13, UPI 11, NEFT/IMPS/RTGS 10, refund/reversal 6, salary/interest 6, ATM/cash 5, cheque 1
- **Ours:** 3 patterns · debit 1, credit 1, card spend 1
- **Reader v2 alone on these samples:** 3/3
- **chitta-ref-app families missing from this issuer's own templates:** NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Closed by the generic bank layer:** NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Still pending:** none — confirm wording via tester shares

### IDFC FIRST Bank (`idfc`)

- **Senders here:** IDFCBK, IDFCFB
- **chitta-ref-app:** 56 active (+0 obsolete) · 4 sender IDs · transaction 48, statement 8, event 0 · captures balance in 33, reference in 11, chaining in 0
  - account types: bank 23, credit_card 16, prepaid 9, debit_card 6, loan 2
  - transaction families: other 17, card spend 14, NEFT/IMPS/RTGS 8, ATM/cash 5, refund/reversal 4, cheque 3, salary/interest 3, UPI 1
- **Ours:** 3 patterns · debit 1, credit 1, card spend 1
- **Reader v2 alone on these samples:** 3/3
- **chitta-ref-app families missing from this issuer's own templates:** NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Closed by the generic bank layer:** NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Still pending:** none — confirm wording via tester shares

### YES Bank (`yes`)

- **Senders here:** YESBNK, YESBKC
- **chitta-ref-app:** 54 active (+0 obsolete) · 2 sender IDs · transaction 50, statement 4, event 0 · captures balance in 35, reference in 8, chaining in 0
  - account types: bank 34, credit_card 10, prepaid 5, debit_card 3, bill_pay 1, loan 1
  - transaction families: other 18, card spend 12, NEFT/IMPS/RTGS 11, UPI 7, salary/interest 5, cheque 3, refund/reversal 2, ATM/cash 2
- **Ours:** 3 patterns · debit 1, credit 1, card spend 1
- **Reader v2 alone on these samples:** 3/3
- **chitta-ref-app families missing from this issuer's own templates:** NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Closed by the generic bank layer:** NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Still pending:** none — confirm wording via tester shares

### Federal Bank (`federal`)

- **Senders here:** FEDBNK, FEDFIB, FIMONY, JUPITR, JUPTER
- **chitta-ref-app:** 53 active (+1 obsolete) · 2 sender IDs · transaction 51, statement 2, event 0 · captures balance in 30, reference in 9, chaining in 0
  - account types: bank 31, debit_card 10, prepaid 7, credit_card 4, loan 1
  - transaction families: other 23, NEFT/IMPS/RTGS 8, card spend 8, ATM/cash 5, salary/interest 4, UPI 4, refund/reversal 3, cheque 1
- **Ours:** 2 patterns · debit 1, credit 1
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Still pending:** none — confirm wording via tester shares

### Union Bank of India (`union`)

- **Senders here:** UNIONB, UBINBK
- **chitta-ref-app:** 53 active (+2 obsolete) · 2 sender IDs · transaction 52, statement 1, event 0 · captures balance in 34, reference in 12, chaining in 0
  - account types: bank 40, debit_card 6, credit_card 6, loan 1
  - transaction families: other 20, UPI 11, card spend 10, refund/reversal 7, NEFT/IMPS/RTGS 5, cheque 4, salary/interest 4, ATM/cash 3, EMI/loan 1
- **Ours:** 2 patterns · debit 1, credit 1 · logic: type rules
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, ATM withdrawal, EMI / loan debit, reversal / refund, cheque, bill / statement
- **Closed by the generic bank layer:** card alerts, ATM withdrawal, EMI / loan debit, reversal / refund, cheque, bill / statement
- **Still pending:** none — confirm wording via tester shares

### RBL Bank (`rbl`)

- **Senders here:** RBLBNK, RBLCRD
- **chitta-ref-app:** 51 active (+2 obsolete) · 2 sender IDs · transaction 39, statement 12, event 0 · captures balance in 28, reference in 9, chaining in 0
  - account types: bank 27, credit_card 20, debit_card 3, loan 1
  - transaction families: other 11, card spend 10, NEFT/IMPS/RTGS 8, UPI 6, refund/reversal 4, EMI/loan 4, cheque 3, salary/interest 3, ATM/cash 2
- **Ours:** 4 patterns · debit 1, credit 1, card spend 1, statement 1
- **Reader v2 alone on these samples:** 3/3
- **chitta-ref-app families missing from this issuer's own templates:** NEFT/IMPS/RTGS wording, ATM withdrawal, EMI / loan debit, reversal / refund, cheque
- **Closed by the generic bank layer:** NEFT/IMPS/RTGS wording, ATM withdrawal, EMI / loan debit, reversal / refund, cheque
- **Still pending:** none — confirm wording via tester shares

### Airtel Payments Bank (`airtel`)

- **Senders here:** AIRBNK, AIRTLB
- **chitta-ref-app:** 47 active (+2 obsolete) · 2 sender IDs · transaction 47, statement 0, event 0 · captures balance in 31, reference in 29, chaining in 0
  - account types: bank 27, prepaid 19, debit_card 1
  - transaction families: other 34, ATM/cash 4, NEFT/IMPS/RTGS 3, refund/reversal 3, salary/interest 3, card spend 1
- **Ours:** 2 patterns · debit 1, credit 1
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund
- **Still pending:** none — confirm wording via tester shares

### Bank of Baroda (`bob`)

- **Senders here:** BOBTXN, BOBSMS, BARODA, BOBCRD
- **chitta-ref-app:** 45 active (+3 obsolete) · 6 sender IDs · transaction 38, statement 7, event 0 · captures balance in 27, reference in 14, chaining in 0
  - account types: bank 32, credit_card 6, loan 3, prepaid 3, debit_card 1
  - transaction families: other 16, UPI 12, NEFT/IMPS/RTGS 7, ATM/cash 4, card spend 4, cheque 2, refund/reversal 1, salary/interest 1
- **Ours:** 3 patterns · debit 1, credit 1, card spend 1 · logic: preprocessor
- **Reader v2 alone on these samples:** 3/3
- **chitta-ref-app families missing from this issuer's own templates:** NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Closed by the generic bank layer:** NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Still pending:** none — confirm wording via tester shares

### Canara Bank (`canara`)

- **Senders here:** CANBNK, CNRBNK + regexes ^CANBNK$, ^CNRB[A-Z]{2}$
- **chitta-ref-app:** 44 active (+0 obsolete) · 4 sender IDs · transaction 41, statement 3, event 0 · captures balance in 25, reference in 11, chaining in 3
  - account types: bank 31, credit_card 8, debit_card 5
  - transaction families: other 16, card spend 8, UPI 7, NEFT/IMPS/RTGS 7, salary/interest 4, ATM/cash 3, refund/reversal 2, cheque 1
- **Ours:** 2 patterns · debit 1, credit 1 · logic: sender_regexes
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Still pending:** none — confirm wording via tester shares

### Punjab National Bank (`pnb`)

- **Senders here:** PNBSMS, PUNBNK
- **chitta-ref-app:** 39 active (+30 obsolete) · 8 sender IDs · transaction 38, statement 1, event 0 · captures balance in 27, reference in 13, chaining in 4
  - account types: bank 29, debit_card 5, credit_card 5
  - transaction families: other 13, UPI 10, card spend 8, NEFT/IMPS/RTGS 7, ATM/cash 4, refund/reversal 3, salary/interest 3, cheque 1
- **Ours:** 2 patterns · debit 1, credit 1
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Still pending:** none — confirm wording via tester shares

### DBS Bank (`dbs`)

- **Senders here:** DBSBNK, DBSDGB
- **chitta-ref-app:** 38 active (+3 obsolete) · 3 sender IDs · transaction 37, statement 1, event 0 · captures balance in 23, reference in 10, chaining in 0
  - account types: bank 26, debit_card 8, credit_card 4
  - transaction families: other 12, card spend 10, UPI 10, NEFT/IMPS/RTGS 6, refund/reversal 5, ATM/cash 4, salary/interest 4, cheque 1
- **Ours:** 2 patterns · debit 1, credit 1
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Still pending:** none — confirm wording via tester shares

### AU Small Finance Bank (`au`)

- **Senders here:** AUBANK, AUSFBL
- **chitta-ref-app:** 38 active (+0 obsolete) · 1 sender IDs · transaction 34, statement 4, event 0 · captures balance in 24, reference in 4, chaining in 0
  - account types: bank 26, credit_card 12
  - transaction families: other 12, UPI 12, NEFT/IMPS/RTGS 9, card spend 8, refund/reversal 4, cheque 2, salary/interest 2, ATM/cash 2
- **Ours:** 2 patterns · debit 1, credit 1
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Still pending:** none — confirm wording via tester shares

### Indian Bank (`indian`)

- **Senders here:** INDBNK, INDIAN
- **chitta-ref-app:** 37 active (+7 obsolete) · 3 sender IDs · transaction 35, statement 2, event 0 · captures balance in 13, reference in 15, chaining in 0
  - account types: bank 25, debit_card 8, credit_card 3, loan 1
  - transaction families: other 11, UPI 9, NEFT/IMPS/RTGS 7, card spend 5, ATM/cash 5, refund/reversal 2, salary/interest 2, cheque 1
- **Ours:** 2 patterns · debit 1, credit 1
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Still pending:** none — confirm wording via tester shares

### Bank of India (`boi`)

- **Senders here:** BOIIND, BOISMS
- **chitta-ref-app:** 34 active (+1 obsolete) · 5 sender IDs · transaction 33, statement 1, event 0 · captures balance in 22, reference in 9, chaining in 0
  - account types: bank 26, debit_card 6, credit_card 2
  - transaction families: other 16, UPI 7, NEFT/IMPS/RTGS 5, ATM/cash 4, salary/interest 4, refund/reversal 3, card spend 2, cheque 1
- **Ours:** 2 patterns · debit 1, credit 1
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Still pending:** none — confirm wording via tester shares

### Bandhan Bank (`bandhan`)

- **Senders here:** BANDHN, BDNBNK
- **chitta-ref-app:** 23 active (+0 obsolete) · 2 sender IDs · transaction 23, statement 0, event 0 · captures balance in 14, reference in 5, chaining in 0
  - account types: bank 21, debit_card 2
  - transaction families: other 10, NEFT/IMPS/RTGS 3, salary/interest 3, UPI 3, ATM/cash 2, cheque 1, card spend 1
- **Ours:** 2 patterns · debit 1, credit 1
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, cheque
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, cheque
- **Still pending:** none — confirm wording via tester shares

### South Indian Bank (`sib`)

- **Senders here:** SIBSMS, SIBANK
- **chitta-ref-app:** 23 active (+1 obsolete) · 2 sender IDs · transaction 23, statement 0, event 0 · captures balance in 13, reference in 7, chaining in 0
  - account types: bank 22, prepaid 1
  - transaction families: other 12, UPI 8, NEFT/IMPS/RTGS 6, refund/reversal 2, salary/interest 2, ATM/cash 1, cheque 1
- **Ours:** 2 patterns · debit 1, credit 1
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque
- **Closed by the generic bank layer:** NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque
- **Still pending:** none — confirm wording via tester shares

### Central Bank of India (`central`)

- **Senders here:** CENTBK, CBIBNK
- **chitta-ref-app:** 22 active (+1 obsolete) · 2 sender IDs · transaction 20, statement 2, event 0 · captures balance in 12, reference in 5, chaining in 0
  - account types: bank 14, debit_card 4, credit_card 3, loan 1
  - transaction families: other 8, card spend 6, NEFT/IMPS/RTGS 4, ATM/cash 3, UPI 1, cheque 1
- **Ours:** 2 patterns · debit 1, credit 1
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, cheque, bill / statement
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, cheque, bill / statement
- **Still pending:** none — confirm wording via tester shares

### Indian Overseas Bank (`iob`)

- **Senders here:** IOBCHN, IOBBNK
- **chitta-ref-app:** 18 active (+0 obsolete) · 1 sender IDs · transaction 17, statement 1, event 0 · captures balance in 7, reference in 9, chaining in 2
  - account types: bank 15, credit_card 3
  - transaction families: other 7, NEFT/IMPS/RTGS 5, card spend 3, salary/interest 2, UPI 2, ATM/cash 1, refund/reversal 1
- **Ours:** 2 patterns · debit 1, credit 1
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, bill / statement
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, bill / statement
- **Still pending:** none — confirm wording via tester shares

### CSB Bank (`csb`)

- **Senders here:** CSBANK, CSBBNK
- **chitta-ref-app:** 4 active (+2 obsolete) · 1 sender IDs · transaction 4, statement 0, event 0 · captures balance in 2, reference in 2, chaining in 0
  - account types: bank 4
  - transaction families: other 2, UPI 2
- **Ours:** 2 patterns · debit 1, credit 1
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** none
- **Closed by the generic bank layer:** —
- **Still pending:** none — confirm wording via tester shares

### Kerala Gramin Bank (`kgb`)

- **Senders here:** KGBANK, KERGRB
- **chitta-ref-app:** 4 active (+0 obsolete) · 1 sender IDs · transaction 4, statement 0, event 0 · captures balance in 2, reference in 2, chaining in 0
  - account types: bank 4
  - transaction families: UPI 2, NEFT/IMPS/RTGS 1, other 1
- **Ours:** 2 patterns · debit 1, credit 1
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** none
- **Closed by the generic bank layer:** —
- **Still pending:** none — confirm wording via tester shares

### American Express (`amex`)

- **Senders here:** AMEXIN, AMEXIC
- **chitta-ref-app:** 9 active (+0 obsolete) · 11 sender IDs · transaction 5, statement 4, event 0 · captures balance in 1, reference in 0, chaining in 0
  - account types: credit_card 9
  - transaction families: card spend 5
- **Ours:** 2 patterns · card spend 1, card payment 1 · logic: chaining
- **Reader v2 alone on these samples:** 1/2 — rules needed for: `T-AMEX-0002: parsed, but meaning 'card_payment' needs the rule`
- **chitta-ref-app families missing from this issuer's own templates:** bill / statement
- **Closed by the generic bank layer:** bill / statement
- **Still pending:** none — confirm wording via tester shares

### OneCard (`onecard`)

- **Senders here:** ONECRD, OBCARD
- **chitta-ref-app:** no issuer of this name in chitta-ref-app's file (newer institution) — ours is first coverage.
- **Ours:** 1 patterns · card spend 1
- **Reader v2 alone on these samples:** 1/1
- **chitta-ref-app families missing from this issuer's own templates:** none
- **Closed by the generic bank layer:** —
- **Still pending:** none — confirm wording via tester shares

### Bank of Maharashtra (`bom`)

- **Senders here (cross-checked):** MAHABK + regexes ^MAHA[A-Z]{2}$
- **chitta-ref-app:** 32 active (+2 obsolete) · 1 sender IDs · transaction 30, statement 2, event 0 · captures balance in 19, reference in 13, chaining in 0
  - account types: bank 26, debit_card 3, credit_card 2, loan 1
  - transaction families: other 13, UPI 10, cheque 3, salary/interest 3, NEFT/IMPS/RTGS 2, refund/reversal 2, card spend 1, ATM/cash 1
- **Ours:** 2 patterns · debit 1, credit 1 · logic: sender_regexes
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Closed by the generic bank layer:** card alerts, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Still pending:** none — confirm wording via tester shares

### IDBI Bank (`idbi`)

- **Senders here (cross-checked):** IDBIBK + regexes ^IDBI[A-Z]{2}$
- **chitta-ref-app:** 27 active (+0 obsolete) · 2 sender IDs · transaction 25, statement 2, event 0 · captures balance in 16, reference in 8, chaining in 2
  - account types: bank 17, debit_card 3, credit_card 3, prepaid 3, loan 1
  - transaction families: other 11, UPI 8, NEFT/IMPS/RTGS 3, refund/reversal 3, ATM/cash 2, card spend 2, salary/interest 2, cheque 1
- **Ours:** 2 patterns · debit 1, credit 1 · logic: sender_regexes
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque, bill / statement
- **Still pending:** none — confirm wording via tester shares

### Karur Vysya Bank (`kvb`)

- **Senders here (cross-checked):** KVBANK + regexes ^KVB[A-Z]{3}$
- **chitta-ref-app:** 23 active (+0 obsolete) · 3 sender IDs · transaction 23, statement 0, event 0 · captures balance in 10, reference in 4, chaining in 0
  - account types: bank 20, prepaid 2, debit_card 1
  - transaction families: other 13, NEFT/IMPS/RTGS 5, refund/reversal 2, cheque 2, card spend 1, ATM/cash 1
- **Ours:** 2 patterns · debit 1, credit 1 · logic: sender_regexes
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque
- **Still pending:** none — confirm wording via tester shares

### City Union Bank (`cub`)

- **Senders here (cross-checked):** CUBANK + regexes ^CUB[A-Z]{3}$
- **chitta-ref-app:** 23 active (+0 obsolete) · 4 sender IDs · transaction 22, statement 1, event 0 · captures balance in 15, reference in 5, chaining in 0
  - account types: bank 14, credit_card 5, debit_card 4
  - transaction families: card spend 7, NEFT/IMPS/RTGS 6, ATM/cash 4, cheque 4, other 3, salary/interest 3, refund/reversal 3, UPI 2, EMI/loan 1
- **Ours:** 2 patterns · debit 1, credit 1 · logic: sender_regexes
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, EMI / loan debit, reversal / refund, cheque, bill / statement
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, EMI / loan debit, reversal / refund, cheque, bill / statement
- **Still pending:** none — confirm wording via tester shares

### Tamilnad Mercantile Bank (`tmb`)

- **Senders here (cross-checked):** TMBANK + regexes ^TMB[A-Z]{3}$
- **chitta-ref-app:** 28 active (+0 obsolete) · 1 sender IDs · transaction 27, statement 1, event 0 · captures balance in 20, reference in 13, chaining in 0
  - account types: bank 21, debit_card 4, credit_card 3
  - transaction families: other 11, NEFT/IMPS/RTGS 6, card spend 5, UPI 4, ATM/cash 2, refund/reversal 2, salary/interest 1
- **Ours:** 2 patterns · debit 1, credit 1 · logic: sender_regexes
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, bill / statement
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, bill / statement
- **Still pending:** none — confirm wording via tester shares

### Jammu & Kashmir Bank (`jkb`)

- **Senders here (cross-checked):** JKBANK + regexes ^JKB[A-Z]{3}$
- **chitta-ref-app:** 27 active (+1 obsolete) · 2 sender IDs · transaction 25, statement 2, event 0 · captures balance in 16, reference in 8, chaining in 0
  - account types: bank 23, credit_card 4
  - transaction families: other 13, UPI 5, NEFT/IMPS/RTGS 5, salary/interest 2, card spend 2, refund/reversal 2, ATM/cash 1
- **Ours:** 2 patterns · debit 1, credit 1 · logic: sender_regexes
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, bill / statement
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, bill / statement
- **Still pending:** none — confirm wording via tester shares

### Karnataka Bank (`kbl`)

- **Senders here (cross-checked):** KBLBNK, KTKBNK
- **chitta-ref-app:** 21 active (+0 obsolete) · 2 sender IDs · transaction 21, statement 0, event 0 · captures balance in 9, reference in 10, chaining in 0
  - account types: bank 19, debit_card 2
  - transaction families: other 7, UPI 7, NEFT/IMPS/RTGS 4, salary/interest 3, card spend 2, refund/reversal 2, ATM/cash 1
- **Ours:** 2 patterns · debit 1, credit 1
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund
- **Still pending:** none — confirm wording via tester shares

### Saraswat Co-operative Bank (`saraswat`)

- **Senders here (cross-checked):** SARBNK + regexes ^SAR[A-Z]{3}$
- **chitta-ref-app:** 25 active (+2 obsolete) · 3 sender IDs · transaction 24, statement 1, event 0 · captures balance in 19, reference in 5, chaining in 0
  - account types: bank 20, debit_card 3, credit_card 2
  - transaction families: other 7, NEFT/IMPS/RTGS 7, UPI 6, card spend 4, cheque 2, salary/interest 2, refund/reversal 1
- **Ours:** 2 patterns · debit 1, credit 1 · logic: sender_regexes
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, reversal / refund, cheque, bill / statement
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, reversal / refund, cheque, bill / statement
- **Still pending:** none — confirm wording via tester shares

### Equitas Small Finance Bank (`equitas`)

- **Senders here (cross-checked):** EQUTAS + regexes ^EQ[A-Z]{4}$
- **chitta-ref-app:** 25 active (+1 obsolete) · 3 sender IDs · transaction 25, statement 0, event 0 · captures balance in 17, reference in 7, chaining in 2
  - account types: bank 17, prepaid 6, debit_card 2
  - transaction families: other 12, NEFT/IMPS/RTGS 6, UPI 6, card spend 3, refund/reversal 2, ATM/cash 2, cheque 1, salary/interest 1
- **Ours:** 2 patterns · debit 1, credit 1 · logic: sender_regexes
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque
- **Still pending:** none — confirm wording via tester shares

### SVC Co-operative Bank (`svc`)

- **Senders here (cross-checked):** SVCBNK
- **chitta-ref-app:** 21 active (+0 obsolete) · 1 sender IDs · transaction 21, statement 0, event 0 · captures balance in 18, reference in 8, chaining in 0
  - account types: bank 17, debit_card 4
  - transaction families: other 8, NEFT/IMPS/RTGS 5, UPI 5, ATM/cash 2, card spend 2, cheque 1
- **Ours:** 2 patterns · debit 1, credit 1
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, cheque
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, cheque
- **Still pending:** none — confirm wording via tester shares

### Fino Payments Bank (`fino`)

- **Senders here (cross-checked):** FINOBK + regexes ^FINO[A-Z]{2}$
- **chitta-ref-app:** 20 active (+3 obsolete) · 2 sender IDs · transaction 20, statement 0, event 0 · captures balance in 13, reference in 10, chaining in 0
  - account types: bank 19, debit_card 1
  - transaction families: other 9, NEFT/IMPS/RTGS 4, UPI 3, ATM/cash 2, refund/reversal 1, salary/interest 1
- **Ours:** 2 patterns · debit 1, credit 1 · logic: sender_regexes
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund
- **Closed by the generic bank layer:** NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund
- **Still pending:** none — confirm wording via tester shares

### Punjab & Sind Bank (`psb`)

- **Senders here (cross-checked):** PSBANK
- **chitta-ref-app:** 19 active (+0 obsolete) · 1 sender IDs · transaction 19, statement 0, event 0 · captures balance in 15, reference in 6, chaining in 2
  - account types: bank 18, debit_card 1
  - transaction families: UPI 7, other 6, NEFT/IMPS/RTGS 4, ATM/cash 2, cheque 2, salary/interest 2, refund/reversal 2, card spend 1
- **Ours:** 2 patterns · debit 1, credit 1
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, reversal / refund, cheque
- **Still pending:** none — confirm wording via tester shares

### NKGSB Co-operative Bank (`nkgsb`)

- **Senders here (unconfirmed):** NKGSBB + regexes ^NKGSB[A-Z]?$, ^NKG[A-Z]{3}$
- **chitta-ref-app:** 19 active (+0 obsolete) · 1 sender IDs · transaction 19, statement 0, event 0 · captures balance in 19, reference in 4, chaining in 0
  - account types: bank 19
  - transaction families: NEFT/IMPS/RTGS 7, other 6, UPI 6, ATM/cash 3, salary/interest 2, card spend 1, EMI/loan 1, refund/reversal 1
- **Ours:** 2 patterns · debit 1, credit 1 · logic: sender_regexes
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, EMI / loan debit, reversal / refund
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, EMI / loan debit, reversal / refund
- **Still pending:** none — confirm wording via tester shares

### Ujjivan Small Finance Bank (`ujjivan`)

- **Senders here (cross-checked):** UJJIVN
- **chitta-ref-app:** 18 active (+1 obsolete) · 1 sender IDs · transaction 18, statement 0, event 0 · captures balance in 14, reference in 3, chaining in 1
  - account types: bank 17, debit_card 1
  - transaction families: UPI 6, other 5, NEFT/IMPS/RTGS 5, refund/reversal 2, ATM/cash 2, salary/interest 2, card spend 1, EMI/loan 1, cheque 1
- **Ours:** 2 patterns · debit 1, credit 1
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, EMI / loan debit, reversal / refund, cheque
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, EMI / loan debit, reversal / refund, cheque
- **Still pending:** none — confirm wording via tester shares

### UCO Bank (`uco`)

- **Senders here (cross-checked):** UCOBNK + regexes ^UCO[A-Z]{3}$
- **chitta-ref-app:** 16 active (+1 obsolete) · 1 sender IDs · transaction 16, statement 0, event 0 · captures balance in 15, reference in 1, chaining in 0
  - account types: bank 11, debit_card 3, prepaid 2
  - transaction families: other 8, ATM/cash 4, card spend 3, refund/reversal 1, NEFT/IMPS/RTGS 1, UPI 1
- **Ours:** 2 patterns · debit 1, credit 1 · logic: sender_regexes
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, ATM withdrawal, reversal / refund
- **Closed by the generic bank layer:** card alerts, ATM withdrawal, reversal / refund
- **Still pending:** none — confirm wording via tester shares

### India Post Payments Bank (`ippb`)

- **Senders here (cross-checked):** IPBMSG
- **chitta-ref-app:** 28 active (+0 obsolete) · 2 sender IDs · transaction 28, statement 0, event 0 · captures balance in 23, reference in 11, chaining in 0
  - account types: bank 25, debit_card 3
  - transaction families: other 11, UPI 7, NEFT/IMPS/RTGS 5, ATM/cash 5, salary/interest 3, card spend 2, refund/reversal 2, EMI/loan 2
- **Ours:** 2 patterns · debit 1, credit 1
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, EMI / loan debit, reversal / refund
- **Closed by the generic bank layer:** card alerts, NEFT/IMPS/RTGS wording, ATM withdrawal, EMI / loan debit, reversal / refund
- **Still pending:** none — confirm wording via tester shares

### Jio Payments Bank / JioMoney (`jio`)

- **Senders here (cross-checked):** JIOMNY + regexes ^JIO[A-Z]{3}$
- **chitta-ref-app:** 16 active (+2 obsolete) · 2 sender IDs · transaction 16, statement 0, event 0 · captures balance in 11, reference in 7, chaining in 0
  - account types: bank 12, prepaid 4
  - transaction families: other 7, UPI 6, NEFT/IMPS/RTGS 4, refund/reversal 1
- **Ours:** 2 patterns · debit 1, credit 1 · logic: sender_regexes
- **Reader v2 alone on these samples:** 2/2
- **chitta-ref-app families missing from this issuer's own templates:** NEFT/IMPS/RTGS wording, reversal / refund
- **Closed by the generic bank layer:** NEFT/IMPS/RTGS wording, reversal / refund
- **Still pending:** none — confirm wording via tester shares

### HSBC India (`hsbc`)

- **Senders here (cross-checked):** HSBCIN, HSBCBK
- **chitta-ref-app:** 15 active (+3 obsolete) · 3 sender IDs · transaction 13, statement 2, event 0 · captures balance in 5, reference in 4, chaining in 0
  - account types: bank 7, credit_card 6, debit_card 2
  - transaction families: card spend 5, other 4, UPI 2, ATM/cash 2, refund/reversal 2, salary/interest 1, NEFT/IMPS/RTGS 1
- **Ours:** 3 patterns · debit 1, credit 1, card spend 1
- **Reader v2 alone on these samples:** 3/3
- **chitta-ref-app families missing from this issuer's own templates:** ATM withdrawal, reversal / refund, bill / statement
- **Closed by the generic bank layer:** ATM withdrawal, reversal / refund, bill / statement
- **Still pending:** none — confirm wording via tester shares

### Standard Chartered (`stanc`)

- **Senders here (cross-checked):** SCBANK + regexes ^SCB[A-Z]{3}$
- **chitta-ref-app:** 28 active (+1 obsolete) · 4 sender IDs · transaction 23, statement 5, event 0 · captures balance in 8, reference in 8, chaining in 0
  - account types: bank 16, credit_card 10, debit_card 1, loan 1
  - transaction families: other 11, UPI 6, card spend 4, NEFT/IMPS/RTGS 2, salary/interest 2, ATM/cash 1, refund/reversal 1
- **Ours:** 3 patterns · debit 1, credit 1, card spend 1 · logic: sender_regexes
- **Reader v2 alone on these samples:** 3/3
- **chitta-ref-app families missing from this issuer's own templates:** ATM withdrawal, reversal / refund, bill / statement
- **Closed by the generic bank layer:** ATM withdrawal, reversal / refund, bill / statement
- **Still pending:** none — confirm wording via tester shares

### Bajaj Finserv (`bajaj`)

- **Senders here (cross-checked):** BAJAJF + regexes ^BAJAJ[A-Z]$, ^BFL[A-Z]{3}$
- **chitta-ref-app:** 20 active (+0 obsolete) · 6 sender IDs · transaction 13, statement 7, event 0 · captures balance in 9, reference in 0, chaining in 0
  - account types: credit_card 9, prepaid 9, loan 1, insurance 1
  - transaction families: other 8, card spend 4, refund/reversal 1, UPI 1
- **Ours:** 3 patterns · card spend 1, notice 1, EMI/loan 1 · logic: sender_regexes
- **Reader v2 alone on these samples:** 1/2 — rules needed for: `T-BAJAJ-0002: income 2499 last4=0099`
- **chitta-ref-app families missing from this issuer's own templates:** reversal / refund, bill / statement
- **Closed by the generic bank layer:** reversal / refund, bill / statement
- **Still pending:** none — confirm wording via tester shares

### Any bank (generic families) (`generic_bank`)

- **Senders here:** any financial sender (known issuers after their own patterns; unknown DLT bank headers)
- **Layer** (scope `financial_fallback`): no chitta-ref-app equivalent — chitta-ref-app repeats these families per bank; we write each once for all banks.
- **Ours:** 18 patterns · debit 4, credit 2, ATM/cash 2, refund/reversal 2, ignore 1, EMI/loan 1, notice 1, card spend 1, card payment 1, statement 1, salary/interest 1, balance 1 · logic: chaining, type rules, merchant rules
- **Reader v2 alone on these samples:** 10/17 — rules needed for: `T-GENERIC_BANK-0003: parsed, but meaning 'atm' needs the rule`; `T-GENERIC_BANK-0004: parsed, but meaning 'atm' needs the rule`; `T-GENERIC_BANK-0007: parsed, but meaning 'refund' needs the rule`; `T-GENERIC_BANK-0008: parsed, but meaning 'refund' needs the rule`; `T-GENERIC_BANK-0008: parsed, but meaning 'refund' needs the rule`; `T-GENERIC_BANK-0009: expense 8450 last4=0099`; `T-GENERIC_BANK-0011: parsed, but meaning 'card_payment' needs the rule`

### Any biller (bills and reminders) (`generic_biller`)

- **Senders here:** any sender
- **Layer** (scope `any_sender`): no chitta-ref-app equivalent — chitta-ref-app repeats these families per bank; we write each once for all banks.
- **Ours:** 4 patterns · statement 3, notice 1
- **Reader v2 alone on these samples:** 0/0

## Pending vs chitta-ref-app — issuers Tracker has no entry for

Counts from chitta-ref-app's file; names are public institution names. Covered **by shape** through the generic layers, not by copying.

| Type | Issuers | chitta-ref-app patterns | Merged / closed | Covered by |
|---|--:|--:|--:|---|
| electricity | 39 | 53 | 0 | biller layer (utility bills) |
| bank | 24 | 266 | 10 | generic bank layer (unknown DLT sender → generic families → reader v2) |
| insurance | 18 | 31 | 1 | biller layer (premium due) |
| prepaid | 16 | 135 | 3 | NOT covered by templates — reader v2 only (wallet spends) |
| generic | 15 | 39 | 0 | skipped — travel / ticket events |
| gas | 11 | 16 | 0 | biller layer (utility bills) |
| pay_later | 9 | 38 | 4 | biller layer (dues) — spends not yet |
| phone | 7 | 19 | 1 | biller layer (bills, recharge expiry) |
| credit_card | 7 | 57 | 1 | generic bank layer card templates (spend, payment received, statement) |
| prepaid_dth | 5 | 10 | 0 | biller layer (recharge expiry) |
| loan | 3 | 4 | 0 | generic bank layer EMI templates + biller notices |

**Live issuers worth their own entry next** (most chitta-ref-app patterns, not merged/closed): Dhanlaxmi Bank (15), TJSB (15), One Card (15), DCB (14), Abhyudaya (14), AP Mahesh (14), MobiKwik (14), DeutscheBk (13), PayZapp (13), Cosmos (12), Indiabulls (12), Slice (12), PhonePe (11), Zaggle (11), SBM Bnk (10), TATA (9), Bharat Bank (8), FlipKart (8), Sodexo (8), Jupiter (8).
Add each with its own DLT headers (from real tester SMS) and at least one template per family it sends.
