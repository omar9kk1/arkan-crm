'use client';
import { useCallback, useEffect, useState } from 'react';
import { getClientReviewCount } from '../../lib/api/client-reviews-api';
import { useClientsDataRefreshSignal } from '../notifications/clients-refresh';

/**
 * The real number behind the «تحت المراجعة» badge of the clients pages —
 * ONLY the reviews awaiting a Manager decision (`PENDING`); decided rows and
 * CHANGES_REQUESTED (which wait on the requester) are history and never
 * counted.
 *
 * The authoritative number comes from `GET /client-reviews/count`: an exact
 * backend count scoped in-service per role (manager: company-wide, employee:
 * only their own rows) — never the length of a capped list window, and
 * `0` is displayed when nothing is pending.
 *
 * The count is read on mount, re-read through the EXISTING clients
 * data-refresh signal (the bell's publisher — no new polling and no second
 * fetching system), and kept exact by the mounted tab, which reports the
 * fresh count after each of its own refetches (decisions, resubmits).
 */
export function useClientReviewCount(): {
  /** The pending count, or null until the first read settles. */
  count: number | null;
  /** Push a fresh count (used by the mounted tab after each refresh). */
  reportCount: (count: number) => void;
  /** Re-read the count now (e.g. after the employee's wizard submits). */
  refresh: () => void;
} {
  const [count, setCount] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    getClientReviewCount()
      .then((counter) => {
        if (active) setCount(counter.pending);
      })
      .catch(() => {
        // The badge simply keeps its last value (or stays hidden until the
        // first read); the tab component owns the visible error state.
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  // The bell's existing clients refresh signal: a silent count re-read
  // whenever the shared clients data may have moved on the server.
  const refreshSignal = useClientsDataRefreshSignal();
  useEffect(() => {
    if (refreshSignal === 0) return;
    setNonce((value) => value + 1);
  }, [refreshSignal]);

  return { count, reportCount: setCount, refresh };
}
