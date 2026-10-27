import { removeAccountMessage } from '../removeAccountMessage';

describe('removeAccountMessage', () => {
  it('0 transactions: says it has none and drops the history sentence', () => {
    const msg = removeAccountMessage('QA Bank ••9999', 0);
    expect(msg).toBe(
      "Remove QA Bank ••9999? It has no transactions. New SMS from this account won't be imported. You can restore it later.",
    );
    expect(msg).not.toMatch(/stays?|counting/);
  });

  it('1 transaction: singular verb agreement', () => {
    const msg = removeAccountMessage('QA Bank', 1);
    expect(msg).toContain(
      'Its 1 transaction stays in your history but stops counting toward your balance.',
    );
    expect(msg).not.toContain('transactions');
  });

  it('many transactions: plural verb agreement', () => {
    const msg = removeAccountMessage('QA Bank', 12);
    expect(msg).toContain(
      'Its 12 transactions stay in your history but stop counting toward your balance.',
    );
    expect(msg).toMatch(/^Remove QA Bank\? /);
    expect(msg).toContain('You can restore it later.');
  });
});
