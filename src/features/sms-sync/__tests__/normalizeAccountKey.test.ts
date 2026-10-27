import {
  ACCOUNT_KEY_NORMALIZER_VERSION,
  accountKeyForAccount,
  accountKeyToString,
  bankCanonicalForText,
  normalizeAccountKey,
} from '../normalizeAccountKey';

describe('normalizeAccountKey — bank alias map', () => {
  it.each([
    ['HDFC Bank card ending 8123', 'hdfc'],
    ['debited from HDFC A/C X1859', 'hdfc'],
    ['HDFCBK: Rs.100 debited', 'hdfc'],
    ['a/c X1859 to GPay -Federal Bank', 'federal'],
    ['FEDBNK Rs.250.00 debited', 'federal'],
    ['Federal Bank a/c ending 1859', 'federal'],
    ['State Bank of India a/c X1859', 'sbi'],
    ['SBICRD Rs.100 debited', 'sbi'],
    ['ICICI Bank card ending 8123', 'icici'],
    ['ICICIB Rs.100 debited', 'icici'],
    ['debited from ICICI A/C X1859', 'icici'],
    ['Axis Bank A/C *7302', 'axis'],
    ['AXISBK Rs.100 debited', 'axis'],
    ['debited from Axis a/c X1859', 'axis'],
    ['Kotak Mahindra Bank a/c X1859', 'kotak'],
    ['KOTAKB Rs.100 debited', 'kotak'],
    ['debited from Kotak a/c X1859', 'kotak'],
    ['Punjab National Bank a/c X1859', 'pnb'],
    ['PNB a/c ending 1859', 'pnb'],
    ['Bank of India a/c X1859', 'boi'],
    ['BOI Rs.100 debited', 'boi'],
    ['Canara Bank a/c X1859', 'canara'],
    ['debited from Canara a/c X1859', 'canara'],
    ['Union Bank of India a/c X1859', 'union'],
    ['Union Bank a/c X1859', 'union'],
    ['Yes Bank a/c X1859', 'yes'],
    ['YESBNK Rs.100 debited', 'yes'],
    ['IDFC FIRST Bank a/c X1859', 'idfc'],
    ['IDFC First a/c X1859', 'idfc'],
    ['debited from IDFC a/c X1859', 'idfc'],
  ])('resolves bank "%s" -> %s', (body, expected) => {
    expect(normalizeAccountKey(body).bankCanonical).toBe(expected);
  });

  it('resolves the previously-broken SBI case: "SBI Card ending 5368" -> sbi (not unknown)', () => {
    expect(normalizeAccountKey('Rs.500 debited from SBI Card ending 5368').bankCanonical).toBe(
      'sbi',
    );
  });

  it('resolves the previously-broken SBI case: "SBI A/C 5368" -> sbi (not unknown)', () => {
    expect(normalizeAccountKey('Rs.500 debited from SBI A/C 5368').bankCanonical).toBe('sbi');
  });

  it('prefers "State Bank of India" over the "Bank of India" substring (sbi, not boi)', () => {
    expect(normalizeAccountKey('State Bank of India a/c X1859').bankCanonical).toBe('sbi');
  });

  it('prefers "Union Bank of India" over the "Bank of India" substring (union, not boi)', () => {
    expect(normalizeAccountKey('Union Bank of India a/c X1859').bankCanonical).toBe('union');
  });

  it('falls through to unknown when no alias matches', () => {
    expect(normalizeAccountKey('Rs.100 debited from SomeCreditUnion a/c X1859').bankCanonical).toBe(
      'unknown',
    );
  });
});

describe('normalizeAccountKey — lastFour extraction', () => {
  it.each([
    ['XX1859', '1859'],
    ['*1859', '1859'],
    ['X1859', '1859'],
    ['XXXX1859', '1859'],
    ['a/c ending 1859', '1859'],
    ['a/c X1859', '1859'],
    ['card ending 8123', '8123'],
    ['A/C *7302', '7302'],
    ['Acct XX1234', '1234'],
  ])('extracts lastFour from "%s" -> %s', (body, expected) => {
    expect(normalizeAccountKey(body).lastFour).toBe(expected);
  });

  it('returns empty-string sentinel (not null) for a bare UPI message with no account reference', () => {
    const key = normalizeAccountKey('Rs.100.00 debited from UPI app');
    expect(key.lastFour).toBe('');
  });

  it('does not false-match a 4-digit amount as lastFour', () => {
    expect(normalizeAccountKey('Rs.1859.00 debited at BigBasket').lastFour).toBe('');
  });
});

describe('normalizeAccountKey — accountKind precedence', () => {
  it('credit card wording wins over bank/account wording', () => {
    expect(normalizeAccountKey('credit card a/c ending 8123').accountKind).toBe('credit_card');
  });

  it('bank/account wording resolves to bank when no credit card wording', () => {
    expect(normalizeAccountKey('a/c X1859').accountKind).toBe('bank');
  });

  it('falls back to upi when neither credit card nor account wording matches', () => {
    expect(normalizeAccountKey('debited from UPI app').accountKind).toBe('upi');
  });
});

describe('normalizeAccountKey — unknown + independent fields', () => {
  it('no match -> bankCanonical unknown, lastFour empty, accountKind still resolved', () => {
    const key = normalizeAccountKey('Rs.100 debited from UPI app');
    expect(key.bankCanonical).toBe('unknown');
    expect(key.lastFour).toBe('');
    expect(key.accountKind).toBe('upi');
  });

  it('resolves accountKind and lastFour independently even when the bank is unknown', () => {
    const key = normalizeAccountKey('debited from a/c X1859 by SomeCreditUnion');
    expect(key.bankCanonical).toBe('unknown');
    expect(key.accountKind).toBe('bank');
    expect(key.lastFour).toBe('1859');
  });
});

describe('normalizeAccountKey — normalizerVersion', () => {
  it('stamps ACCOUNT_KEY_NORMALIZER_VERSION on every returned key', () => {
    expect(normalizeAccountKey('SBI a/c X1859').normalizerVersion).toBe(
      ACCOUNT_KEY_NORMALIZER_VERSION,
    );
    expect(normalizeAccountKey('debited from UPI app').normalizerVersion).toBe(
      ACCOUNT_KEY_NORMALIZER_VERSION,
    );
  });
});

describe('accountKeyToString', () => {
  it('is deterministic: identical for the same key called twice', () => {
    const body = 'Rs.500 debited from SBI A/C 5368';
    expect(accountKeyToString(normalizeAccountKey(body))).toBe(
      accountKeyToString(normalizeAccountKey(body)),
    );
  });

  it('produces distinct strings for different keys', () => {
    const a = accountKeyToString(normalizeAccountKey('SBI a/c X1859'));
    const b = accountKeyToString(normalizeAccountKey('HDFC a/c X1859'));
    const c = accountKeyToString(normalizeAccountKey('SBI a/c X7302'));
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('formats in bank_canonical:account_kind:last_four order', () => {
    expect(accountKeyToString(normalizeAccountKey('SBI a/c X1859'))).toBe('sbi:bank:1859');
  });
});

describe('normalizeAccountKey — determinism across last-four formats', () => {
  it('maps different last-four formats of one account to the SAME AccountKey', () => {
    const ending = normalizeAccountKey('SBI a/c ending 1859 debited');
    const maskedX = normalizeAccountKey('SBI a/c X1859 debited');
    const maskedStar = normalizeAccountKey('SBI A/C *1859 debited');

    expect(ending.lastFour).toBe('1859');
    expect(maskedX.lastFour).toBe('1859');
    expect(maskedStar.lastFour).toBe('1859');

    expect(accountKeyToString(ending)).toBe('sbi:bank:1859');
    expect(accountKeyToString(maskedX)).toBe(accountKeyToString(ending));
    expect(accountKeyToString(maskedStar)).toBe(accountKeyToString(ending));
  });
});

describe('D10 account-name key helpers', () => {
  it('bankCanonicalForText resolves aliases in an account name', () => {
    expect(bankCanonicalForText('HDFC Salary Account')).toBe('hdfc');
    expect(bankCanonicalForText('State Bank of India savings')).toBe('sbi');
    expect(bankCanonicalForText('Federal')).toBe('federal');
  });

  it('bankCanonicalForText falls back to unknown', () => {
    expect(bankCanonicalForText('QA Delete Bank 9999')).toBe('unknown');
    expect(bankCanonicalForText('Cash Wallet')).toBe('unknown');
  });

  it('accountKeyForAccount builds the decision key with the empty last-four sentinel', () => {
    expect(accountKeyForAccount({ name: 'HDFC Card', type: 'credit_card', lastFour: '8123' })).toEqual({
      bankCanonical: 'hdfc',
      accountKind: 'credit_card',
      lastFour: '8123',
      normalizerVersion: ACCOUNT_KEY_NORMALIZER_VERSION,
    });
    expect(accountKeyForAccount({ name: 'Wallet', type: 'cash', lastFour: null }).lastFour).toBe('');
  });
});
