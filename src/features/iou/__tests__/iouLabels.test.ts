import { netLabel, parseRupeesToMinor, splitSummaryLabel, youGetLabel, youOweLabel } from '../iouLabels';
import { setRedacted } from '../../../shared/privacy/redaction';

afterEach(() => setRedacted(false));

describe('R10 labels', () => {
  it('parses rupee text to paise, rejects junk', () => {
    expect(parseRupeesToMinor('250')).toBe(25000);
    expect(parseRupeesToMinor('250.5')).toBe(25050);
    expect(parseRupeesToMinor(' 0.07 ')).toBe(7);
    for (const bad of ['', 'abc', '-5', '1.234', '1,000']) expect(parseRupeesToMinor(bad)).toBeNull();
  });
  it('split summary + net lines', () => {
    expect(splitSummaryLabel(2, 75000, 3)).toBe('Split: 2 people owe you ₹750');
    expect(splitSummaryLabel(1, 100, 1)).toBe('Split: 1 person owes you ₹1');
    expect(splitSummaryLabel(0, 0, 2)).toBe('Split: 2 people paid you back');
    expect(splitSummaryLabel(0, 0, 0)).toBe('');
    expect(netLabel(500)).toBe('owes you ₹5');
    expect(netLabel(-500)).toBe('you owe ₹5');
    expect(netLabel(0)).toBe('settled up');
  });
  it('Private mode masks every IOU amount', () => {
    setRedacted(true);
    expect(youGetLabel(75000)).not.toMatch(/750/);
    expect(youOweLabel(75000)).not.toMatch(/750/);
    expect(splitSummaryLabel(1, 75000, 1)).not.toMatch(/750/);
    expect(netLabel(75000)).not.toMatch(/750/);
  });
});
