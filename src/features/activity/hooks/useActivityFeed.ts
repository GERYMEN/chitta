import { useCallback, useRef, useState } from 'react';
import { auditRepository } from '../../../data/repositories/audit.repository';
import { AuditFeedEvent } from '../../../domain/audit/audit.types';

export const ACTIVITY_PAGE_SIZE = 30;

/**
 * Cursor-paginated audit feed. `reload` fetches the newest page (called on
 * screen focus); `loadMore` appends the page strictly older than the last
 * row's (eventAt, seq). A ref guards against overlapping fetches.
 */
export function useActivityFeed(pageSize: number = ACTIVITY_PAGE_SIZE) {
  const [events, setEvents] = useState<AuditFeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);

  const reload = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const page = await auditRepository.listRecent(pageSize);
      setEvents(page);
      setHasMore(page.length === pageSize);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [pageSize]);

  const loadMore = useCallback(async () => {
    const last = events[events.length - 1];
    if (busy.current || !hasMore || !last) return;
    busy.current = true;
    setLoadingMore(true);
    try {
      const page = await auditRepository.listRecent(pageSize, {
        eventAt: last.eventAt,
        seq: last.seq,
      });
      setEvents(previous => [...previous, ...page]);
      setHasMore(page.length === pageSize);
    } catch {
      setHasMore(false);
    } finally {
      busy.current = false;
      setLoadingMore(false);
    }
  }, [events, hasMore, pageSize]);

  return { events, loading, loadingMore, hasMore, failed, reload, loadMore };
}
