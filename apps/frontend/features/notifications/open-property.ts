'use client';

import { useSyncExternalStore } from 'react';

/**
 * A tiny cross-component request channel: the notification bell asks the
 * currently mounted properties page to open one specific property, using the
 * page's EXISTING details drawer.
 *
 * A module-level store (rather than a URL query parameter) is the smallest change
 * that works both when the page is already mounted and when the click navigates
 * to the page from somewhere else — no `useSearchParams` Suspense boundary, no
 * router remount, no URL the user could re-trigger by refreshing.
 */
export interface OpenPropertyRequest {
  propertyId: string;
  /** Bumped on every request so a repeated click still notifies subscribers. */
  nonce: number;
}

let current: OpenPropertyRequest | null = null;
let nonce = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Ask the properties page to open `propertyId` in its details drawer. */
export function requestOpenProperty(propertyId: string): void {
  nonce += 1;
  current = { propertyId, nonce };
  emit();
}

/**
 * Acknowledge the request for `propertyId` (only if it is still the pending one),
 * so a later render cannot re-open the same drawer.
 */
export function consumeOpenProperty(propertyId: string): void {
  if (current?.propertyId !== propertyId) return;
  current = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): OpenPropertyRequest | null {
  return current;
}

/** The server never has a pending client request. */
function getServerSnapshot(): OpenPropertyRequest | null {
  return null;
}

export function useOpenPropertyRequest(): OpenPropertyRequest | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
