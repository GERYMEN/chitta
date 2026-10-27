/**
 * Coercion helpers for mapping SQLite rows (`Record<string, unknown>`) into
 * domain types. Keep mappers dependency-free (no op-sqlite import) so they
 * stay pure and unit-testable.
 */
export function asString(value: unknown): string {
  return String(value);
}

export function asNumber(value: unknown): number {
  return Number(value);
}

export function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function asNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export function asBoolean(value: unknown): boolean {
  return value === 1 || value === true;
}

/**
 * Read an INTEGER epoch-ms column back as an ISO-8601 string. Returns null
 * when the column is NULL (keeps the domain convention of ISO strings for
 * every `*At` field, even though the column is stored as epoch ms).
 */
export function asNullableDateIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return new Date(Number(value)).toISOString();
}

/**
 * Write an ISO-8601 string (or null) as an INTEGER epoch-ms column value.
 */
export function dateIsoToEpochMs(value: string | null): number | null {
  if (value === null || value === undefined) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export type SqlRow = Record<string, unknown>;

/** Value set written back to SQLite — booleans already encoded as 0/1. */
export type SqlWriteRow = Record<string, string | number | null>;
