export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

export function timeOfDay(date: Date): TimeOfDay {
  const hour = date.getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

/** "Good <time>, <name>" — or "Welcome" when no name has been set yet. */
export function greetingFor(date: Date, userName: string): string {
  const name = userName.trim();
  if (name === '') return 'Welcome';
  return `Good ${timeOfDay(date)}, ${name}`;
}
