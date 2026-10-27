import { formatRupeesFromMinor } from '../currency';

describe('formatRupeesFromMinor', () => {
  it('formats small amounts without grouping', () => {
    expect(formatRupeesFromMinor(45000)).toBe('₹450');
  });

  it('groups thousands using Indian numbering', () => {
    expect(formatRupeesFromMinor(129900)).toBe('₹1,299');
    expect(formatRupeesFromMinor(6500000)).toBe('₹65,000');
  });

  it('groups lakhs using Indian numbering', () => {
    expect(formatRupeesFromMinor(14285000)).toBe('₹1,42,850');
  });

  it('shows paise when requested', () => {
    expect(formatRupeesFromMinor(8245000, { showPaise: true })).toBe('₹82,450.00');
  });

  it('renders negative amounts with a leading minus', () => {
    expect(formatRupeesFromMinor(-45000)).toBe('-₹450');
  });

  it('renders a positive sign when requested', () => {
    expect(formatRupeesFromMinor(850000, { showPositiveSign: true })).toBe('+₹8,500');
  });

  it('never shows a positive sign for negative amounts', () => {
    expect(formatRupeesFromMinor(-45000, { showPositiveSign: true })).toBe('-₹450');
  });

  it('rounds to the nearest rupee when showPaise is false', () => {
    expect(formatRupeesFromMinor(25075)).toBe('₹251');
    expect(formatRupeesFromMinor(25000)).toBe('₹250');
    expect(formatRupeesFromMinor(-25075)).toBe('-₹251');
  });

  it('keeps exact paise when showPaise is true', () => {
    expect(formatRupeesFromMinor(25075, { showPaise: true })).toBe('₹250.75');
    expect(formatRupeesFromMinor(25000, { showPaise: true })).toBe('₹250.00');
  });
});
