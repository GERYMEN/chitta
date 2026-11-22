import { autoTagsFor, normalizeTagName, tagKey, tagsMatchingFilter, validateTagName } from '../tag.rules';

describe('R11 tag rules', () => {
  it('derives auto tags from the payment method only', () => {
    expect(autoTagsFor({ paymentMethod: 'upi' })).toEqual(['#UPI']);
    expect(autoTagsFor({ paymentMethod: 'card' })).toEqual(['#Card']);
    expect(autoTagsFor({ paymentMethod: 'cash' })).toEqual(['#Cash']);
    expect(autoTagsFor({ paymentMethod: 'bank' })).toEqual(['#Bank']);
    expect(autoTagsFor({ paymentMethod: 'other' })).toEqual([]);
  });

  it('normalizes: trim, strip leading #, collapse spaces; key is lower-case', () => {
    expect(normalizeTagName('  #Food  Run ')).toBe('Food Run');
    expect(tagKey('#Food')).toBe('food');
    expect(tagKey('  food ')).toBe(tagKey('FOOD'));
  });

  it('validates empty / too long names', () => {
    expect(validateTagName('  # ')).toBeNull();
    expect(validateTagName('a'.repeat(31))).toBeNull();
    expect(validateTagName(' #QA tag ')).toBe('QA tag');
  });

  it('matches a filter by custom tag key or derived auto tag', () => {
    const t = { paymentMethod: 'upi' as const };
    expect(tagsMatchingFilter(t, ['qa-key'], 'qa-key')).toBe(true);
    expect(tagsMatchingFilter(t, [], '#UPI')).toBe(true);
    expect(tagsMatchingFilter(t, [], '#Card')).toBe(false);
    expect(tagsMatchingFilter(t, ['x'], 'y')).toBe(false);
  });
});
