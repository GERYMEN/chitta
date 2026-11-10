/**
 * R5: canonical institution id → display label. The v1 labels are kept
 * exactly (they are part of the in-memory suggestion grouping key).
 */
const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  hdfc: 'HDFC',
  federal: 'Federal',
  sbi: 'SBI',
  icici: 'ICICI',
  axis: 'Axis',
  kotak: 'Kotak',
  pnb: 'PNB',
  boi: 'Bank of India',
  canara: 'Canara',
  union: 'Union Bank',
  yes: 'Yes Bank',
  idfc: 'IDFC',
  // v2
  bob: 'Bank of Baroda',
  indian: 'Indian Bank',
  iob: 'Indian Overseas Bank',
  central: 'Central Bank',
  indusind: 'IndusInd',
  sib: 'South Indian Bank',
  csb: 'CSB Bank',
  kgb: 'Kerala Gramin Bank',
  au: 'AU Bank',
  rbl: 'RBL Bank',
  bandhan: 'Bandhan Bank',
  dbs: 'DBS Bank',
  paytm: 'Paytm',
  airtel: 'Airtel Payments Bank',
  amex: 'Amex',
  onecard: 'OneCard',
  amazonpay: 'Amazon Pay',
  // R5g T6: the 20 live banks added to rules.json (2026-11-09).
  bom: 'Bank of Maharashtra',
  idbi: 'IDBI Bank',
  kvb: 'Karur Vysya Bank',
  cub: 'City Union Bank',
  tmb: 'Tamilnad Mercantile Bank',
  jkb: 'J&K Bank',
  kbl: 'Karnataka Bank',
  saraswat: 'Saraswat Bank',
  equitas: 'Equitas Bank',
  svc: 'SVC Bank',
  fino: 'Fino Payments Bank',
  psb: 'Punjab & Sind Bank',
  nkgsb: 'NKGSB Bank',
  ujjivan: 'Ujjivan Bank',
  uco: 'UCO Bank',
  hsbc: 'HSBC',
  stanc: 'Standard Chartered',
  ippb: 'India Post Payments Bank',
  jio: 'Jio Payments Bank',
  bajaj: 'Bajaj Finserv',
  unknown: 'Unknown Bank',
};

/** The canonical ids parser v1 could produce (account keys built on them stay stable). */
export const V1_CANONICALS: ReadonlySet<string> = new Set([
  'hdfc',
  'federal',
  'sbi',
  'icici',
  'axis',
  'kotak',
  'pnb',
  'boi',
  'canara',
  'union',
  'yes',
  'idfc',
]);

export function institutionDisplayName(canonical: string): string {
  return DISPLAY_NAMES[canonical] ?? 'Unknown Bank';
}

/** Every canonical id with a label (tests: each one has fixtures). */
export function knownInstitutions(): string[] {
  return Object.keys(DISPLAY_NAMES).filter(id => id !== 'unknown');
}
