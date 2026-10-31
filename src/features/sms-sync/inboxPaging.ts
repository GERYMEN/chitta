import type { SyncWindow } from '../../domain/settings/smsSyncStart.rules';

/**
 * R4b: pure mirror of the native `SmsReader.readInboxPage` paging so page
 * boundaries can be unit-tested without a device.
 *
 * Native query (bound args only, never concatenated):
 *   selection: date >= ? AND (date < ? OR (date = ? AND _id < ?))
 *   args:      [sinceMs, beforeMs, beforeMs, beforeId]
 *   order:     date DESC, _id DESC        (at most `limit` rows are read)
 *
 * Rows come newest first in a strict (date, _id) order, so the cursor of the
 * next page is the (date, _id) of the OLDEST row seen. Several SMS sharing
 * the same date are never skipped or read twice: the ones with a smaller _id
 * fall on the next page through the `date = ? AND _id < ?` branch.
 *
 * The first page uses beforeId 0: `_id < 0` never matches (SMS ids are > 0),
 * so it is exactly `sinceMs <= date < beforeMs`.
 */
export interface InboxCursor {
  beforeMs: number;
  beforeId: number;
}

export interface PagedRow {
  id: string;
  date: number;
}

export function firstCursor(window: SyncWindow): InboxCursor {
  return { beforeMs: window.beforeMs, beforeId: 0 };
}

/** Cursor after a page: the (date, _id) of its oldest (last) row. */
export function nextCursor(page: ReadonlyArray<PagedRow>, previous: InboxCursor): InboxCursor {
  const last = page[page.length - 1];
  if (!last) return previous;
  return { beforeMs: last.date, beforeId: Number(last.id) };
}

/** A short page is the last one. */
export function isLastPage(pageLength: number, limit: number): boolean {
  return pageLength < limit;
}

/** TS copy of the native selection (used by the fake inbox in tests). */
export function rowMatchesPage(row: PagedRow, sinceMs: number, cursor: InboxCursor): boolean {
  const id = Number(row.id);
  return (
    row.date >= sinceMs &&
    (row.date < cursor.beforeMs || (row.date === cursor.beforeMs && id < cursor.beforeId))
  );
}

/** TS copy of the native order: date DESC, _id DESC. */
export function compareRowsDesc(a: PagedRow, b: PagedRow): number {
  if (a.date !== b.date) return b.date - a.date;
  return Number(b.id) - Number(a.id);
}
