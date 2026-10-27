/**
 * Body copy for the "Remove account?" confirm dialog, with correct
 * singular/plural agreement for the transaction count.
 */
export function removeAccountMessage(name: string, transactionCount: number): string {
  let history: string;
  if (transactionCount <= 0) {
    history = 'It has no transactions.';
  } else if (transactionCount === 1) {
    history =
      'Its 1 transaction stays in your history but stops counting toward your balance.';
  } else {
    history =
      `Its ${transactionCount} transactions stay in your history ` +
      'but stop counting toward your balance.';
  }
  return (
    `Remove ${name}? ${history} ` +
    "New SMS from this account won't be imported. You can restore it later."
  );
}
