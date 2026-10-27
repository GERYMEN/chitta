/**
 * Transaction-list date formatting: "Today, 1:15 PM", "Yesterday, 8:40 PM",
 * or "Oct 1, 9:00 AM" for older dates (docs/reference/dashboard screen.png).
 */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function formatTransactionTimestamp(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (isSameDay(date, now)) return `Today, ${formatTime(date)}`;
  if (isSameDay(date, yesterday)) return `Yesterday, ${formatTime(date)}`;

  const month = date.toLocaleDateString('en-IN', { month: 'short' });
  return `${month} ${date.getDate()}, ${formatTime(date)}`;
}

export function formatShortTime(iso: string): string {
  return formatTime(new Date(iso));
}
