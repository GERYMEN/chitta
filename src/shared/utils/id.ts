/**
 * Local, single-device id generator. Collision risk at this id space is a
 * non-issue — no uuid dependency required.
 */
export function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
