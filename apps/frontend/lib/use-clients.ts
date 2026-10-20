'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getClientStats, listClients } from './api/clients-api';
import type { ClientApiDto, ClientStatsApiDto } from './api/client-types';

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

  const refresh = useCallback(() => {
    setNonce((v) => v + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
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
