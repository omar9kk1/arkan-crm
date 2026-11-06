'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { AuthUser } from '@arkan/shared';
import {
  getProperty,
  getPropertyHistory,
  listProperties,
} from './api/properties-api';
import type { PropertyViewDto } from './api/property-types';
import {
  consumeOpenProperty,
  peekOpenPropertyRequest,
  useOpenPropertyRequest,
} from '../features/notifications/open-property';
import { usePropertyRefreshSignal } from '../features/notifications/property-refresh';
import { PROPERTY_QUERY_PARAM, readPropertyParam } from './property-reveal';

/**
 * The shared fetching/refresh core behind the property LISTS (the manager
 * approvals surface and the employee «my/assigned properties» surface).
 *
 * Both pages rendered the same machinery by copy: a cursor-paginated read of
 * `GET /properties` guarded by a monotonic request id (a late page can never
 * overwrite a newer load), a SILENT mode so a notification-driven re-read keeps
 * the rows already on screen until the fresh ones replace them, a load-more
 * continuation, and the two notification channels (the refresh signal and the
 * deep-link that opens one property in the page's EXISTING details drawer).
 *
 * What genuinely differs per surface is CONFIGURED, never copied:
 * - `pageSize` / `maxPagesPerLoad` — the manager pulls a few pages per load so
 *   its headline counts cover a sensible window; the employee reads one page;
 * - `mapProperty` — each page keeps its own existing display model
 *   (`PreviewProperty` vs `Property`) through the shared adapter;
 * - `onOpenError` — a failed deep-link is reported through the page's own
 *   notice/toast.
 *
 * Everything user-visible stays in the calling pages: permissions, tab
 * filtering, counts, review actions and the exact Astra markup are untouched —
 * this module only owns the rows, the cursor, the loading/error flags and the
 * two refresh channels.
 */
export interface UsePropertyListOptions<
  T extends { id?: string | undefined },
> {
  /** Rows requested per page (the calling surface's `PAGE_SIZE`). */
  pageSize: number;
  /**
   * Pages pulled per load so the headline counts cover a sensible window.
   * Defaults to `1` (exactly one page per load, the employee list's behaviour).
   */
  maxPagesPerLoad?: number;
  /** `PropertyViewDto` → the page's existing display model. */
  mapProperty: (dto: PropertyViewDto, viewer: AuthUser | null) => T;
  /** Reports a failed notification deep-link; the page owns the wording/UI. */
  onOpenError?: (message: string) => void;
  /** Viewer from `useAuth()`; re-reads the list whenever the session changes. */
  viewer: AuthUser | null;
  /**
   * Optional silent auto-sync interval (ms). While mounted and visible the hook
   * re-reads the list through its existing request guard, so a Manager action on
   * another browser/device appears without a page reload and without flicker.
   */
  autoSyncMs?: number;
}

export interface PropertyListResult<T extends { id?: string | undefined }> {
  items: T[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  /** Re-reads the list through the existing request guard (never loops). */
  refetch: () => void;
  loadMore: () => void;
  /** Row the details drawer is open on (also set by the deep-link). */
  selected: T | null;
  setSelected: Dispatch<SetStateAction<T | null>>;
  /**
   * The deep-linked target: the REAL authorized row resolved from
   * `GET /properties/:id`, present here even when it is not in the loaded page
   * window. `null` when no target is active. Callers must merge it into the rows
   * they display (never synthesise a card) so the exact card is rendered.
   */
  revealed: T | null;
  /** `revealed.id`, or null — the id whose card should show the selected state. */
  targetId: string | null;
  /** Closes the drawer AND clears the deep-link target (store + URL param). */
  closeSelected: () => void;
}

export function usePropertyList<T extends { id?: string | undefined }>({
  pageSize,
  maxPagesPerLoad = 1,
  mapProperty,
  onOpenError,
  viewer,
  autoSyncMs = 0,
}: UsePropertyListOptions<T>): PropertyListResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<T | null>(null);
  /**
   * The deep-linked target resolved from `GET /properties/:id`. It is a REAL
   * authorized row (never a synthesised card), kept separately so the caller can
   * render its exact card even when the paginated window does not contain it.
   */
  const [revealed, setRevealed] = useState<T | null>(null);
  // Monotonic id: a late page can never overwrite a newer load.
  const requestId = useRef(0);
  // Set by a notification-driven re-read so it can update in the background.
  const silentRef = useRef(false);
  const [nonce, setNonce] = useState(0);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlTargetId = readPropertyParam(searchParams);

  // The mapper and the error reporter may be re-created by a render, but the
  // effects below re-run only for the data/channel deps (exactly as the pages
  // did before), so the latest references are kept in refs.
  const mapPropertyRef = useRef(mapProperty);
  const onOpenErrorRef = useRef(onOpenError);
  useEffect(() => {
    mapPropertyRef.current = mapProperty;
    onOpenErrorRef.current = onOpenError;
  });

  const refetch = useCallback(() => setNonce((value) => value + 1), []);

  // The notification poll re-reads this list whenever it learns of a genuinely
  // new property notification, so the OTHER user's screen updates without a
  // browser refresh. It goes through `refetch`, so it reuses the existing
  // request guard, tab filtering and headline counts, and it can never loop:
  // this list publishes nothing back.
  const refreshSignal = usePropertyRefreshSignal();
  useEffect(() => {
    if (refreshSignal === 0) return;
    silentRef.current = true;
    refetch();
  }, [refreshSignal, refetch]);

  // Cross-browser/device sync: a Manager action (delete/approve/reject/restore)
  // happens in another session, so local invalidation/notifications are not
  // enough. A short visible-only poll re-reads the list silently; focus and
  // visibility changes also re-check immediately. Cleanup guarantees no timer
  // survives an unmount.
  useEffect(() => {
    if (!autoSyncMs || autoSyncMs <= 0) return;
    let disposed = false;
    const sync = () => {
      if (disposed) return;
      if (
        typeof document !== 'undefined' &&
        document.visibilityState !== 'visible'
      )
        return;
      silentRef.current = true;
      refetch();
    };
    const timer = window.setInterval(sync, autoSyncMs);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, [autoSyncMs, refetch]);

  // Resolves a deep-linked property through `GET /properties/:id` (the backend
  // re-authorizes on read, so a stale/denied id answers 404 and is reported
  // instead of opening an empty drawer). Two channels feed this:
  //  - the URL query parameter `?property=<id>`, which survives a refresh and a
  //    direct deep-link, and
  //  - the transient notification store, which works before the URL updates.
  const openRequest = useOpenPropertyRequest();
  const pendingId = urlTargetId ?? openRequest?.propertyId ?? null;
  // The URL param survives across renders, so this effect can re-run for an id
  // that was already resolved (e.g. when the transient store request is
  // consumed). One authorized fetch per distinct target id is enough.
  const resolvedTarget = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingId || !viewer) return;
    if (resolvedTarget.current === pendingId) return;
    let cancelled = false;
    (async () => {
      try {
        let dto: PropertyViewDto;
        try {
          dto = await getProperty(pendingId);
        } catch (cause) {
          // Rejected rows are readable by their creator through the standard
          // endpoint; a SOFT-DELETED row is hidden there. Fall back to the
          // creator-only history endpoint so the decision notification still
          // opens the original details. Other employees get a non-disclosing
          // 404 from BOTH endpoints.
          if (viewer.role !== 'EMPLOYEE') throw cause;
          dto = await getPropertyHistory(pendingId);
        }
        if (cancelled) return;
        resolvedTarget.current = pendingId;
        const row = mapPropertyRef.current(dto, viewer);
        setRevealed(row);
        setSelected(row);
      } catch (cause) {
        if (cancelled) return;
        // A failed target is not locked, so a retry (fresh click) can resolve it
        // later; the page's own notice reports the safe message.
        resolvedTarget.current = null;
        setRevealed(null);
        onOpenErrorRef.current?.(
          cause instanceof Error ? cause.message : 'تعذّر فتح العقار.',
        );
      } finally {
        // Only the transient channel is consumed here; the URL param is cleared
        // explicitly (closeSelected) so a refresh keeps showing the target.
        if (openRequest?.propertyId === pendingId) consumeOpenProperty(pendingId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingId, viewer, openRequest?.propertyId]);

  useEffect(() => {
    const id = ++requestId.current;
    // A notification-driven re-read is SILENT: the rows already on screen stay
    // until the fresh ones replace them, so the panel never blinks away.
    const silent = silentRef.current;
    silentRef.current = false;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    (async () => {
      const rows: PropertyViewDto[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page = await listProperties(
          cursor ? { limit: pageSize, cursor } : { limit: pageSize },
        );
        if (id !== requestId.current) return;
        rows.push(...page.items);
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor && pages < maxPagesPerLoad);
      if (id !== requestId.current) return;
      setItems(
        rows.map((dto: PropertyViewDto) => mapPropertyRef.current(dto, viewer)),
      );
      setNextCursor(cursor);
      setLoading(false);
    })().catch((cause: unknown) => {
      if (id !== requestId.current) return;
      if (silent) {
        // Keep the rows on screen; the next poll retries.
        setLoading(false);
        return;
      }
      setItems([]);
      setNextCursor(null);
      setLoading(false);
      setError(
        cause instanceof Error
          ? cause.message
          : 'تعذر تحميل العقارات من الخادم.',
      );
    });
  }, [nonce, viewer, pageSize, maxPagesPerLoad]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    const id = requestId.current;
    setLoadingMore(true);
    listProperties({ limit: pageSize, cursor: nextCursor })
      .then((page) => {
        if (id !== requestId.current) return;
        setItems((previous) => [
          ...previous,
          ...page.items.map((dto: PropertyViewDto) =>
            mapPropertyRef.current(dto, viewer),
          ),
        ]);
        setNextCursor(page.nextCursor);
        setLoadingMore(false);
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return;
        setLoadingMore(false);
        setError(
          cause instanceof Error
            ? cause.message
            : 'تعذر تحميل المزيد من العقارات.',
        );
      });
  }, [nextCursor, loadingMore, pageSize, viewer]);

  /**
   * Closes the drawer and clears the deep-link target: drops the transient store
   * request, clears `?property=`, and releases the resolved row. Used by the
   * drawer's close button so a refresh after closing does not re-open it.
   */
  const closeSelected = useCallback(() => {
    setSelected(null);
    setRevealed(null);
    // Allow the same id to be deep-linked again later (e.g. from the owner
    // drawer after closing) instead of being treated as already resolved.
    resolvedTarget.current = null;
    const pending = peekOpenPropertyRequest();
    if (pending) consumeOpenProperty(pending.propertyId);
    if (urlTargetId) {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      params.delete(PROPERTY_QUERY_PARAM);
      params.delete('decision');
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }
  }, [pathname, router, searchParams, urlTargetId]);

  return {
    items,
    nextCursor,
    loading,
    loadingMore,
    error,
    refetch,
    loadMore,
    selected,
    setSelected,
    revealed,
    targetId: revealed?.id ?? null,
    closeSelected,
  };
}
