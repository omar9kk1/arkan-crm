'use client';

import { useEffect, useState } from 'react';

/**
 * A tiny broadcast channel between the notification poll and the property lists.
 *
 * The notification bell already asks the server, once every 15s, whether the
 * caller has a genuinely NEW notification. Instead of giving every list its own
 * timer (or reloading the page), the bell publishes one signal here and the
 * mounted property pages re-read themselves through their EXISTING `refetch`.
 *
 * Two properties keep this cheap and loop-free:
 * - the bell is the ONLY publisher, and it emits only when the server actually
 *   returned something new, so there is no polling, no probing and no storm;
 * - a page only observes signals emitted AFTER it mounted (see the hook below),
 *   so mounting late — or after a reconnect — never costs a duplicate request.
 */
const listeners = new Set<() => void>();

/** Publish "the data behind the property lists may have changed on the server". */
export function notifyPropertyDataChanged(): void {
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
 * zero and never replays an older signal, which is what lets a caller treat `0`
 * as "nothing has happened since I rendered".
 */
export function usePropertyRefreshSignal(): number {
  const [signal, setSignal] = useState(0);
  useEffect(() => {
    return subscribe(() => setSignal((value) => value + 1));
  }, []);
  return signal;
}
