'use client';
import { useEffect, useRef, useState } from 'react';
import { listProperties } from './properties-api';
import type { PropertyViewDto } from './property-types';

/**
 * Debounced, server-side property search for wizard dropdowns.
 *
 * - Every query hits `GET /properties?q=...&status=AVAILABLE&limit=...`, so
 *   results are real authorized rows decided by the backend — never a
 *   client-side filter over a preloaded page and never mock data.
 * - `AVAILABLE` only: a normal customer inquiry attaches to live stock.
 * - Bounded `limit` (the backend caps it at 100 anyway) so the dropdown never
 *   paginates through the whole table.
 * - A monotonic request id guards the responses: cleanup bumps it, so a slower
 *   stale response can never overwrite the results of a newer query.
 */
export const PROPERTY_SEARCH_MIN_QUERY = 2;
export const PROPERTY_SEARCH_LIMIT = 8;
export const PROPERTY_SEARCH_DEBOUNCE_MS = 300;

export interface PropertySearchState {
  results: PropertyViewDto[];
  searching: boolean;
  error: string | null;
}

const initialSearchState: PropertySearchState = {
  results: [],
  searching: false,
  error: null,
};

export function usePropertySearch(query: string): PropertySearchState {
  const trimmed = query.trim();
  const shouldSearch = trimmed.length >= PROPERTY_SEARCH_MIN_QUERY;
  const [state, setState] = useState<PropertySearchState>(initialSearchState);
  const latestId = useRef(0);

  useEffect(() => {
    if (!shouldSearch) {
      latestId.current += 1;
      setState(initialSearchState);
      return undefined;
    }
    const current = latestId.current + 1;
    latestId.current = current;
    setState({ ...initialSearchState, searching: true });
    const timer = setTimeout(() => {
      listProperties({
        q: trimmed,
        status: 'AVAILABLE',
        limit: PROPERTY_SEARCH_LIMIT,
      })
        .then((page) => {
          if (latestId.current !== current) return; // a newer query already ran
          setState({ results: page.items, searching: false, error: null });
        })
        .catch((cause: unknown) => {
          if (latestId.current !== current) return;
          const message =
            cause instanceof Error
              ? cause.message
              : 'تعذر البحث في العقارات. حاول مرة أخرى.';
          setState({ results: [], searching: false, error: message });
        });
    }, PROPERTY_SEARCH_DEBOUNCE_MS);
    return () => {
      latestId.current += 1; // this effect's response becomes stale
      clearTimeout(timer);
    };
  }, [shouldSearch, trimmed]);

  return state;
}
