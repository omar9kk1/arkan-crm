'use client';

import { useEffect, useState } from 'react';

/**
 * A tiny broadcast channel between the notification poll and the CLIENTS
 * surfaces, mirroring `property-refresh.ts` (one publisher, counter signal).
 *
 * When the bell learns that a genuinely NEW record-acitivity notification
 * arrived (a client, contact, follow-up or interest was saved by an employee),
 * the already-open clients pages must show that record without a page reload.
 * Instead of polling anywhere else, the bell publishes one signal here and the
 * pages re-read through their EXISTING `refetch` — tab, filters, search text
 * and open drawers are all local page state and survive the refetch untouched.
 *
 * Cheap and loop-free by construction:
 * - the bell is the ONLY publisher and emits only for genuinely new rows;
 * - a mounted page observes signals emitted AFTER it mounted (starts at 0).
 */
const listeners = new Set<() => void>();

/** Publish "the data behind the clients pages may have changed on the server". */
export function notifyClientsDataChanged(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * A counter that increments once per signal received while mounted. It starts at
 * zero and never replays an older signal, so `0` means "nothing happened yet".
 */
export function useClientsDataRefreshSignal(): number {
  const [signal, setSignal] = useState(0);
  useEffect(() => {
    return subscribe(() => setSignal((value) => value + 1));
  }, []);
  return signal;
}
