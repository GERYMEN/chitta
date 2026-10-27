import { parseSmsReference } from '../smsReference';

describe('parseSmsReference', () => {
  it('parses a valid SMS reference hash', () => {
    expect(parseSmsReference('sms-13674-1792935297758')).toEqual({
      smsId: '13674',
      dateMs: 1792935297758,
    });
  });

  it('returns null for a null or empty hash (manual transactions)', () => {
    expect(parseSmsReference(null)).toBeNull();
    expect(parseSmsReference(undefined)).toBeNull();
    expect(parseSmsReference('')).toBeNull();
  });

  it('returns null for garbage or non-SMS formats', () => {
    expect(parseSmsReference('manual-123')).toBeNull();
    expect(parseSmsReference('sms-13674')).toBeNull();
    expect(parseSmsReference('sms-13674-1792935297758-9')).toBeNull();
    expect(parseSmsReference('xsms-1-2')).toBeNull();
  });

  it('returns null when parts are not numeric', () => {
    expect(parseSmsReference('sms-abc-1792935297758')).toBeNull();
    expect(parseSmsReference('sms-13674-abc')).toBeNull();
    expect(parseSmsReference('sms-1 3-17')).toBeNull();
    expect(parseSmsReference('sms--5-17')).toBeNull();
  });
});
