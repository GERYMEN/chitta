import {
  compareRowsDesc,
  firstCursor,
  InboxCursor,
  isLastPage,
  nextCursor,
  PagedRow,
  rowMatchesPage,
} from '../inboxPaging';

/** Same selection + order as the native query (via the pure mirror). */
function page(inbox: PagedRow[], sinceMs: number, cursor: InboxCursor, limit: number): PagedRow[] {
  return inbox
    .filter(row => rowMatchesPage(row, sinceMs, cursor))
    .sort(compareRowsDesc)
    .slice(0, limit);
}

/** Walk every page like syncSms does; `stopAfter` simulates Cancel. */
function walk(
  inbox: PagedRow[],
  window: { sinceMs: number; beforeMs: number },
  limit: number,
  stopAfter = Infinity,
) {
  const seen: string[] = [];
  let cursor = firstCursor(window);
  let pages = 0;
  let completed = false;
  while (pages < stopAfter) {
    const rows = page(inbox, window.sinceMs, cursor, limit);
    pages++;
    seen.push(...rows.map(r => r.id));
    cursor = nextCursor(rows, cursor);
    if (isLastPage(rows.length, limit)) {
      completed = true;
      break;
    }
  }
  return { seen, pages, completed };
}

const T = 1_800_000_000_000;

describe('R4b inbox paging planner (mirror of native readInboxPage)', () => {
  it('first page is exactly since <= date < before (beforeId 0 never matches)', () => {
    const inbox = [
      { id: '1', date: T - 1 },
      { id: '2', date: T },
      { id: '3', date: T + 10 },
    ];
    const rows = page(inbox, T, firstCursor({ sinceMs: T, beforeMs: T + 10 }), 10);
    expect(rows.map(r => r.id)).toEqual(['2']);
  });

  it('reads every SMS exactly once across page boundaries, newest first', () => {
    const inbox = Array.from({ length: 650 }, (_, i) => ({ id: String(i + 1), date: T + i * 1000 }));
    const { seen, pages, completed } = walk(inbox, { sinceMs: 0, beforeMs: T + 10_000_000 }, 300);
    expect(pages).toBe(3);
    expect(completed).toBe(true);
    expect(seen).toHaveLength(650);
    expect(new Set(seen).size).toBe(650);
    expect(seen[0]).toBe('650');
    expect(seen[649]).toBe('1');
  });

  it('several SMS with the same date split across a page boundary are neither skipped nor doubled', () => {
    // 7 messages share one date; page size 3 cuts through them twice.
    const inbox: PagedRow[] = [
      { id: '1', date: T - 5 },
      ...Array.from({ length: 7 }, (_, i) => ({ id: String(10 + i), date: T })),
      { id: '40', date: T + 5 },
    ];
    const { seen, completed } = walk(inbox, { sinceMs: 0, beforeMs: T + 100 }, 3);
    expect(completed).toBe(true);
    expect(seen).toEqual(['40', '16', '15', '14', '13', '12', '11', '10', '1']);
  });

  it('an exactly full last page needs one more (empty) read to finish', () => {
    const inbox = Array.from({ length: 6 }, (_, i) => ({ id: String(i + 1), date: T + i }));
    const { seen, pages, completed } = walk(inbox, { sinceMs: 0, beforeMs: T + 100 }, 3);
    expect(pages).toBe(3);
    expect(completed).toBe(true);
    expect(seen).toHaveLength(6);
  });

  it('respects the window start (older SMS are never read)', () => {
    const inbox = Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), date: T + i }));
    const { seen } = walk(inbox, { sinceMs: T + 5, beforeMs: T + 100 }, 2);
    expect(seen).toEqual(['10', '9', '8', '7', '6']);
  });

  it('cancel after one page: only that page was read and the walk is not complete', () => {
    const inbox = Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), date: T + i }));
    const { seen, completed } = walk(inbox, { sinceMs: 0, beforeMs: T + 100 }, 4, 1);
    expect(seen).toEqual(['10', '9', '8', '7']);
    expect(completed).toBe(false);
  });

  it('empty window: one short page, complete, cursor unchanged', () => {
    const cursor = firstCursor({ sinceMs: T, beforeMs: T + 1 });
    expect(nextCursor([], cursor)).toBe(cursor);
    expect(isLastPage(0, 300)).toBe(true);
  });
});
