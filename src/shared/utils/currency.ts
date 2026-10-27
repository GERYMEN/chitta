/**
 * INR formatting, Indian numbering convention (docs/DESIGN.md).
 * Amounts are stored as integer minor units (paise); this is the only
 * place floating point touches money, and only for display.
 */
function groupIndian(integerPart: string): string {
  const isNegative = integerPart.startsWith('-');
  const digits = isNegative ? integerPart.slice(1) : integerPart;

  if (digits.length <= 3) return (isNegative ? '-' : '') + digits;

  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');

  return (isNegative ? '-' : '') + grouped + ',' + last3;
}

export interface FormatRupeesOptions {
  /** Show paise as ".00" even when zero. Default: false. */
  showPaise?: boolean;
  /** Prefix "+" for positive amounts (incoming credit notation). Default: false. */
  showPositiveSign?: boolean;
}

export function formatRupeesFromMinor(
  amountMinor: number,
  options: FormatRupeesOptions = {},
): string {
  const { showPaise = false, showPositiveSign = false } = options;

  const isNegative = amountMinor < 0;
  const absoluteMinor = Math.abs(amountMinor);
  const rupees = showPaise
    ? Math.floor(absoluteMinor / 100)
    : Math.round(absoluteMinor / 100);
  const paise = absoluteMinor % 100;

  const grouped = groupIndian(String(rupees));
  const paiseSuffix = showPaise ? `.${String(paise).padStart(2, '0')}` : '';
  const sign = isNegative ? '-' : showPositiveSign ? '+' : '';

  return `${sign}₹${grouped}${paiseSuffix}`;
}
