/**
 * R5 parser v2 — sender stage (pure).
 *
 * Indian commercial SMS arrive from DLT headers: a 2-letter operator/circle
 * prefix, a dash, the sender's header ID (6 characters for banks), and since
 * 2025 an optional category suffix: -S (service), -T (transactional),
 * -P (promotional), -G (government). Examples of the shape (synthetic):
 * "AX-QABANK", "JD-QABANK-S", "QABANK".
 *
 * The header IDs in the table below are PUBLIC registry IDs (the same codes
 * shown on every customer's phone) written from general knowledge — they are
 * best-effort, not verified against the DLT registry. An unknown header is
 * NOT dropped: it goes through the classifier with a lower prior, so a bank we
 * do not list (a friend's bank) can still be read.
 *
 * Privacy: the raw address never leaves this module except as the parsed
 * header ID (a public institution code). Plain phone numbers are reduced to
 * the kind 'personal' — the digits are never returned.
 */

export type InstitutionKind = 'bank' | 'card' | 'wallet' | 'paylater';

export type SenderKind =
  /** A DLT header found in the financial sender table. */
  | 'known'
  /** A DLT header we do not know (not promotional). */
  | 'unknown_dlt'
  /** A DLT header with the -P (promotional) suffix — always dropped. */
  | 'promo'
  /** A plain phone number or a short code — dropped (not a bank). */
  | 'personal'
  /** Anything else (empty, odd formats) — treated like an unknown sender. */
  | 'other';

export interface SenderInfo {
  kind: SenderKind;
  /** Upper-case DLT header ID (public code), or null for numbers/other. */
  header: string | null;
  /** DLT category suffix, if present. */
  suffix: 'S' | 'T' | 'P' | 'G' | null;
  /** Canonical institution id (normalizeAccountKey ids) or 'unknown'. */
  institution: string;
  institutionKind: InstitutionKind | null;
}

interface SenderEntry {
  institution: string;
  kind: InstitutionKind;
}

const bank = (institution: string): SenderEntry => ({ institution, kind: 'bank' });
const card = (institution: string): SenderEntry => ({ institution, kind: 'card' });
const wallet = (institution: string): SenderEntry => ({ institution, kind: 'wallet' });

/**
 * Exact header ID → institution. Canonical ids match `normalizeAccountKey`
 * (SBI Card stays 'sbi' and Fi/Jupiter stay 'federal', as in v1, so account
 * keys of existing users do not move).
 */
const SENDER_TABLE: Readonly<Record<string, SenderEntry>> = {
  // SBI
  SBIBNK: bank('sbi'),
  SBIINB: bank('sbi'),
  SBIUPI: bank('sbi'),
  CBSSBI: bank('sbi'),
  ATMSBI: bank('sbi'),
  SBIPSG: bank('sbi'),
  SBYONO: bank('sbi'),
  // SBI Card (credit card) — canonical 'sbi' (v1 alias)
  SBICRD: card('sbi'),
  SBICRF: card('sbi'),
  // HDFC (bank + cards share headers)
  HDFCBK: bank('hdfc'),
  HDFCBN: bank('hdfc'),
  HDFCCC: card('hdfc'),
  // ICICI
  ICICIB: bank('icici'),
  ICICIT: bank('icici'),
  ICICIO: bank('icici'),
  ICICCC: card('icici'),
  // Axis
  AXISBK: bank('axis'),
  AXISMR: bank('axis'),
  AXISCC: card('axis'),
  // Kotak
  KOTAKB: bank('kotak'),
  KOTAKM: bank('kotak'),
  // Federal (+ Fi / Jupiter, which run on Federal Bank accounts)
  FEDBNK: bank('federal'),
  FEDFIB: bank('federal'),
  FIMONY: bank('federal'),
  JUPITR: bank('federal'),
  JUPTER: bank('federal'),
  // PNB
  PNBSMS: bank('pnb'),
  PUNBNK: bank('pnb'),
  // Bank of Baroda
  BOBTXN: bank('bob'),
  BOBSMS: bank('bob'),
  BARODA: bank('bob'),
  BOBCRD: card('bob'),
  // Canara
  CANBNK: bank('canara'),
  CNRBNK: bank('canara'),
  // Union Bank of India
  UNIONB: bank('union'),
  UBINBK: bank('union'),
  // Bank of India
  BOIIND: bank('boi'),
  BOISMS: bank('boi'),
  // Indian Bank
  INDBNK: bank('indian'),
  INDIAN: bank('indian'),
  // Indian Overseas Bank
  IOBCHN: bank('iob'),
  IOBBNK: bank('iob'),
  // Central Bank of India
  CENTBK: bank('central'),
  CBIBNK: bank('central'),
  // IDFC First
  IDFCFB: bank('idfc'),
  IDFCBK: bank('idfc'),
  // Yes
  YESBNK: bank('yes'),
  YESBKC: card('yes'),
  // IndusInd
  INDUSB: bank('indusind'),
  INDUSL: bank('indusind'),
  // South Indian Bank
  SIBSMS: bank('sib'),
  SIBANK: bank('sib'),
  // CSB
  CSBBNK: bank('csb'),
  CSBANK: bank('csb'),
  // Kerala Gramin Bank
  KGBANK: bank('kgb'),
  KERGRB: bank('kgb'),
  // AU Small Finance
  AUBANK: bank('au'),
  AUSFBL: bank('au'),
  // RBL
  RBLBNK: bank('rbl'),
  RBLCRD: card('rbl'),
  // Bandhan
  BANDHN: bank('bandhan'),
  BDNBNK: bank('bandhan'),
  // DBS
  DBSBNK: bank('dbs'),
  DBSDGB: bank('dbs'),
  // Paytm Payments Bank + Paytm wallet
  PAYTMB: bank('paytm'),
  PYTMBK: bank('paytm'),
  IPAYTM: wallet('paytm'),
  PAYTMW: wallet('paytm'),
  // Airtel Payments Bank
  AIRBNK: bank('airtel'),
  AIRTLB: bank('airtel'),
  // Cards
  AMEXIN: card('amex'),
  AMEXIC: card('amex'),
  ONECRD: card('onecard'),
  OBCARD: card('onecard'),
  // Wallets
  AMZPAY: wallet('amazonpay'),
  AMAZON: wallet('amazonpay'),
  // R5g T6: live banks added to rules.json (sender IDs cross-checked; same
  // canonical ids as the rules issuers). NKGSB is 'unconfirmed' — it is
  // resolved only through SENDER_REGEXES below, never an exact entry.
  MAHABK: bank('bom'),
  IDBIBK: bank('idbi'),
  KVBANK: bank('kvb'),
  CUBANK: bank('cub'),
  TMBANK: bank('tmb'),
  JKBANK: bank('jkb'),
  KBLBNK: bank('kbl'),
  KTKBNK: bank('kbl'),
  SARBNK: bank('saraswat'),
  EQUTAS: bank('equitas'),
  SVCBNK: bank('svc'),
  FINOBK: bank('fino'),
  PSBANK: bank('psb'),
  UJJIVN: bank('ujjivan'),
  UCOBNK: bank('uco'),
  IPBMSG: bank('ippb'),
  JIOMNY: bank('jio'),
  HSBCIN: bank('hsbc'),
  HSBCBK: bank('hsbc'),
  SCBANK: bank('stanc'),
  BAJAJF: card('bajaj'),
};

/**
 * R5g T6: issuers whose header IDs are not confirmed ('unconfirmed' in
 * rules.json) match by their rules.json sender_regexes only (after the exact
 * table and the prefixes).
 */
const SENDER_REGEXES: ReadonlyArray<readonly [RegExp, SenderEntry]> = [
  [/^NKGSB[A-Z]?$/, bank('nkgsb')],
  [/^NKG[A-Z]{3}$/, bank('nkgsb')],
];

/**
 * Prefix fallbacks for headers missing from the exact table (banks register
 * several headers). Checked in order; specific prefixes first.
 */
const SENDER_PREFIXES: ReadonlyArray<readonly [string, SenderEntry]> = [
  ['SBICR', card('sbi')],
  ['SBI', bank('sbi')],
  ['HDFC', bank('hdfc')],
  ['ICICI', bank('icici')],
  ['AXIS', bank('axis')],
  ['KOTAK', bank('kotak')],
  ['FEDB', bank('federal')],
  ['PNB', bank('pnb')],
  ['BOB', bank('bob')],
  ['CANB', bank('canara')],
  ['UNION', bank('union')],
  ['BOI', bank('boi')],
  ['IOB', bank('iob')],
  ['CENT', bank('central')],
  ['IDFC', bank('idfc')],
  ['YESB', bank('yes')],
  ['INDUS', bank('indusind')],
  ['RBL', bank('rbl')],
  ['DBS', bank('dbs')],
  ['AMEX', card('amex')],
];

const DLT_PATTERN = /^([A-Z]{2})-([A-Z0-9]{3,9})(?:-([STPG]))?$/;
const BARE_HEADER_PATTERN = /^[A-Z]{6}$/;
const PHONE_PATTERN = /^\+?\d{10,13}$/;
const SHORT_CODE_PATTERN = /^\d{3,8}$/;
const BANK_SHORT_CODE_PATTERN = /^\d{5,6}$/;

function lookup(header: string): SenderEntry | null {
  const exact = SENDER_TABLE[header];
  if (exact) return exact;
  for (const [prefix, entry] of SENDER_PREFIXES) {
    if (header.startsWith(prefix)) return entry;
  }
  for (const [re, entry] of SENDER_REGEXES) {
    if (re.test(header)) return entry;
  }
  return null;
}

function fromHeader(header: string, suffix: SenderInfo['suffix']): SenderInfo {
  if (suffix === 'P') {
    return { kind: 'promo', header, suffix, institution: 'unknown', institutionKind: null };
  }
  const entry = /\d{5,}/.test(header) ? null : lookup(header);
  if (!entry) {
    return { kind: 'unknown_dlt', header, suffix, institution: 'unknown', institutionKind: null };
  }
  return {
    kind: 'known',
    header,
    suffix,
    institution: entry.institution,
    institutionKind: entry.kind,
  };
}

/** Parse an SMS address into sender facts. Never returns the raw address. */
export function parseSender(address: string | null | undefined): SenderInfo {
  const raw = (address ?? '').replace(/\s+/g, '').toUpperCase();
  const dlt = DLT_PATTERN.exec(raw);
  if (dlt) {
    const header = dlt[2];
    // "AD-0000000000"-style: a number behind an operator prefix.
    if (/^\d+$/.test(header)) {
      return { kind: 'other', header: null, suffix: null, institution: 'unknown', institutionKind: null };
    }
    return fromHeader(header, (dlt[3] as SenderInfo['suffix']) ?? null);
  }
  if (BARE_HEADER_PATTERN.test(raw)) return fromHeader(raw, null);
  // U8: a 5-6 digit short code may be a bank's long-code alert line — it goes
  // to the classifier as 'other' (low prior, capped at 80, needs an account
  // mention). Plain personal numbers (10+ digits) and other short numbers
  // are dropped before classification.
  if (BANK_SHORT_CODE_PATTERN.test(raw)) {
    return { kind: 'other', header: null, suffix: null, institution: 'unknown', institutionKind: null };
  }
  if (PHONE_PATTERN.test(raw) || SHORT_CODE_PATTERN.test(raw)) {
    return { kind: 'personal', header: null, suffix: null, institution: 'unknown', institutionKind: null };
  }
  return { kind: 'other', header: null, suffix: null, institution: 'unknown', institutionKind: null };
}

/** Header IDs in the exact table (tests + report counts). */
export function knownSenderHeaders(): string[] {
  return Object.keys(SENDER_TABLE);
}
