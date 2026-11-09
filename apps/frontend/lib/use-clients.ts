'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getClientStats, listClients } from './api/clients-api';
import type {
  ClientListClassification,
  ClientListFilter,
  ClientListItemApiDto,
  ClientStatsApiDto,
} from './api/client-types';
import { useClientsDataRefreshSignal } from '../features/notifications/clients-refresh';

const PAGE_SIZE = 50;

export interface ClientsQuery {
  search?: string;
  filter?: ClientListFilter;
  classification?: ClientListClassification;
}

export interface ClientsResource {
  clients: ClientListItemApiDto[];
  stats: ClientStatsApiDto | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  nextCursor: string | null;
  refresh: () => void;
  loadMore: () => Promise<void>;
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Authorised client list with server-side search/filtering and cursor pages.
 * The hook resets to the first page whenever the search or filters change and
 * ignores stale responses, so old search results can never overwrite a newer
 * query.
 */
export function useClients(query: ClientsQuery = {}): ClientsResource {
  const search = query.search?.trim() ?? '';
  const filter = query.filter;
  const classification = query.classification;
  const debouncedSearch = useDebouncedValue(search, 300);

  const [clients, setClients] = useState<ClientListItemApiDto[]>([]);
  const [stats, setStats] = useState<ClientStatsApiDto | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [nonce, setNonce] = useState<number>(0);

  const cursorRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const busyRef = useRef(false);
  const paramsRef = useRef({ search: debouncedSearch, filter, classification });
  paramsRef.current = { search: debouncedSearch, filter, classification };

  const refresh = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    let active = true;
    busyRef.current = true;
    cursorRef.current = null;
    setClients([]);
    setNextCursor(null);
    setLoading(true);
    setLoadingMore(false);
    setError(null);

    Promise.all([
      listClients({
        search: debouncedSearch || undefined,
        filter,
        classification,
        limit: PAGE_SIZE,
      }),
      getClientStats(),
    ])
      .then(([list, counters]) => {
        if (!active || requestId !== requestIdRef.current) return;
        setClients(list.items);
        setNextCursor(list.nextCursor);
        cursorRef.current = list.nextCursor;
        setStats(counters);
        setLoading(false);
        busyRef.current = false;
      })
      .catch((cause: unknown) => {
        if (!active || requestId !== requestIdRef.current) return;
        setClients([]);
        setNextCursor(null);
        setStats(null);
        setLoading(false);
        busyRef.current = false;
        setError(
          cause instanceof Error
            ? cause.message
            : 'تعذّر تحميل قائمة العملاء.',
        );
      });

    return () => {
      active = false;
    };
  }, [debouncedSearch, filter, classification, nonce]);

  const loadMore = useCallback(async () => {
    const cursor = cursorRef.current;
    if (!cursor || busyRef.current) return;
    const requestId = requestIdRef.current;
    const params = paramsRef.current;
    busyRef.current = true;
    setLoadingMore(true);
    setError(null);
    try {
      const list = await listClients({
        search: params.search || undefined,
        filter: params.filter,
        classification: params.classification,
        cursor,
        limit: PAGE_SIZE,
      });
      if (requestId !== requestIdRef.current) return;
      setClients((previous) => {
        const seen = new Set(previous.map((client) => client.id));
        return [
          ...previous,
          ...list.items.filter((client) => !seen.has(client.id)),
        ];
      });
      setNextCursor(list.nextCursor);
      cursorRef.current = list.nextCursor;
    } catch (cause: unknown) {
      if (requestId !== requestIdRef.current) return;
      setError(
        cause instanceof Error
          ? cause.message
          : 'تعذّر تحميل المزيد من العملاء.',
      );
    } finally {
      if (requestId === requestIdRef.current) {
        setLoadingMore(false);
        busyRef.current = false;
      }
    }
  }, []);

  // The bell publishes ONE signal when new client/contact activity arrives.
  // Reset to the first page so newly approved records are visible; the open
  // drawer keeps its own full record, so it is not affected.
  const refreshSignal = useClientsDataRefreshSignal();
  const lastSignalRef = useRef(0);
  useEffect(() => {
    if (refreshSignal === 0 || refreshSignal === lastSignalRef.current) return;
    lastSignalRef.current = refreshSignal;
    refresh();
  }, [refreshSignal, refresh]);

  return useMemo<ClientsResource>(
    () => ({
      clients,
      stats,
      loading,
      loadingMore,
      error,
      nextCursor,
      refresh,
      loadMore,
    }),
    [
      clients,
      stats,
      loading,
      loadingMore,
      error,
      nextCursor,
      refresh,
      loadMore,
    ],
  );
}
