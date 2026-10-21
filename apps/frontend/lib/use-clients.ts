'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getClientStats, listClients } from './api/clients-api';
import type { ClientApiDto, ClientStatsApiDto } from './api/client-types';
import { useClientsDataRefreshSignal } from '../features/notifications/clients-refresh';

export interface ClientsResource {
  clients: ClientApiDto[];
  stats: ClientStatsApiDto | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useClients(): ClientsResource {
  const [clients, setClients] = useState<ClientApiDto[]>([]);
  const [stats, setStats] = useState<ClientStatsApiDto | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState<number>(0);
  const silentRef = useRef(false);

  const refresh = useCallback(() => {
    setNonce((v) => v + 1);
  }, []);

  useEffect(() => {
    let active = true;
    // A notification-driven re-read is SILENT: the rows already on screen stay
    // (no loading flicker, unchanged tab/filters/search/open drawer) and are
    // replaced in place, so a list can never duplicate.
    const silent = silentRef.current;
    silentRef.current = false;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    Promise.all([listClients(), getClientStats()])
      .then(([list, counters]) => {
        if (!active) return;
        setClients(list.items);
        setStats(counters);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setClients([]);
        setStats(null);
        setLoading(false);
        const message =
          cause instanceof Error ? cause.message : 'تعذر تحميل العملاء.';
        setError(message);
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  // The bell publishes ONE signal when a genuinely new record-activity
  // notification arrives (employee saved a client/contact/follow-up/interest).
  // Every mounted clients page re-reads itself here — as a silent refetch, so
  // the visible state (tab, filters, search, open drawer) is untouched. No
  // extra timer: the bell's 15s poll remains the only sampling point.
  const refreshSignal = useClientsDataRefreshSignal();
  useEffect(() => {
    if (refreshSignal === 0) return;
    silentRef.current = true;
    setNonce((value) => value + 1);
  }, [refreshSignal]);

  return useMemo<ClientsResource>(
    () => ({
      clients,
      stats,
      loading,
      error,
      refresh,
    }),
    [clients, stats, loading, error, refresh],
  );
}
