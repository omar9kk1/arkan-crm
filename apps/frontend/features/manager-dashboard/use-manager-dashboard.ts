'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getManagerDashboard } from '../../lib/api/dashboard-api';
import type {
  ManagerDashboardDto,
  ManagerDashboardPeriod,
} from '../../lib/api/dashboard-types';
import { useClientsDataRefreshSignal } from '../notifications/clients-refresh';
import { usePropertyRefreshSignal } from '../notifications/property-refresh';

/** Same lightweight cross-session cadence as the property lists. */
const AUTO_SYNC_MS = 20_000;

export function useManagerDashboard(period: ManagerDashboardPeriod): {
  data: ManagerDashboardDto | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [data, setData] = useState<ManagerDashboardDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(
    async (silent: boolean) => {
      const id = ++requestId.current;
      if (!silent) setLoading(true);
      try {
        const next = await getManagerDashboard(period);
        // A stale response (older period / older poll) never overwrites the
        // current selection.
        if (!mounted.current || id !== requestId.current) return;
        setData(next);
        setError(null);
      } catch (cause) {
        if (!mounted.current || id !== requestId.current) return;
        // Keep the last successful snapshot on screen; the next signal retries.
        setError(
          cause instanceof Error
            ? cause.message
            : 'تعذّر تحديث بيانات اللوحة.',
        );
      } finally {
        if (mounted.current && id === requestId.current) setLoading(false);
      }
    },
    [period],
  );

  useEffect(() => {
    mounted.current = true;
    void load(false);
    return () => {
      mounted.current = false;
    };
  }, [load]);

  // Any genuinely new property or record notification means at least one
  // dashboard metric may have moved. Re-read silently, never blanking the UI.
  const propertySignal = usePropertyRefreshSignal();
  const clientsSignal = useClientsDataRefreshSignal();
  const previousPropertySignal = useRef(propertySignal);
  const previousClientsSignal = useRef(clientsSignal);
  useEffect(() => {
    const changed =
      propertySignal !== previousPropertySignal.current ||
      clientsSignal !== previousClientsSignal.current;
    previousPropertySignal.current = propertySignal;
    previousClientsSignal.current = clientsSignal;
    // A period switch recreates `load` but is NOT a data-change signal; only a
    // genuinely new notification should trigger this extra silent read.
    if (changed) void load(true);
  }, [propertySignal, clientsSignal, load]);

  useEffect(() => {
    const sync = () => {
      if (document.visibilityState !== 'visible') return;
      void load(true);
    };
    const timer = window.setInterval(sync, AUTO_SYNC_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, [load]);

  return {
    data,
    loading,
    error,
    refresh: () => void load(true),
  };
}
