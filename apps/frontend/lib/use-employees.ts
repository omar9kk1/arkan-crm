'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listEmployees,
  type EmployeeSortQuery,
  type EmployeeStatusQuery,
} from './api/employees-api';
import type {
  EmployeeListItemDto,
  EmployeeSummaryApiDto,
} from './api/employee-types';
import { useDebouncedValue } from './use-debounced-value';

const PAGE_SIZE = 50;

export interface EmployeesQuery {
  search?: string;
  status?: EmployeeStatusQuery;
  sort?: EmployeeSortQuery;
}

export interface EmployeesResource {
  employees: EmployeeListItemDto[];
  summary: EmployeeSummaryApiDto | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  nextCursor: string | null;
  refresh: () => void;
  loadMore: () => Promise<void>;
}

/** Authorized employee directory with server-side search/filter + cursor pages. */
export function useEmployees(query: EmployeesQuery = {}): EmployeesResource {
  const search = query.search?.trim() ?? '';
  const status = query.status ?? 'all';
  const sort = query.sort ?? 'clientsCount';
  const debouncedSearch = useDebouncedValue(search, 300);

  const [employees, setEmployees] = useState<EmployeeListItemDto[]>([]);
  const [summary, setSummary] = useState<EmployeeSummaryApiDto | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const cursorRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const busyRef = useRef(false);
  const paramsRef = useRef({ search: debouncedSearch, status, sort });
  paramsRef.current = { search: debouncedSearch, status, sort };

  const refresh = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    busyRef.current = true;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setEmployees([]);
    setNextCursor(null);
    cursorRef.current = null;
    listEmployees({
      search: debouncedSearch || undefined,
      status,
      sort,
      limit: PAGE_SIZE,
    })
      .then((page) => {
        if (requestId !== requestIdRef.current) return;
        setEmployees(page.items);
        setSummary(page.summary ?? null);
        setNextCursor(page.nextCursor);
        cursorRef.current = page.nextCursor;
      })
      .catch((cause: unknown) => {
        if (requestId !== requestIdRef.current) return;
        setError(
          cause instanceof Error
            ? cause.message
            : 'تعذّر تحميل دليل الموظفين.',
        );
      })
      .finally(() => {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          busyRef.current = false;
        }
      });
  }, [debouncedSearch, status, sort, nonce]);

  const loadMore = useCallback(async () => {
    const cursor = cursorRef.current;
    if (!cursor || busyRef.current) return;
    const requestId = requestIdRef.current;
    const params = paramsRef.current;
    busyRef.current = true;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await listEmployees({
        search: params.search || undefined,
        status: params.status,
        sort: params.sort,
        cursor,
        limit: PAGE_SIZE,
      });
      if (requestId !== requestIdRef.current) return;
      setEmployees((previous) => {
        const seen = new Set(previous.map((employee) => employee.id));
        return [
          ...previous,
          ...page.items.filter((employee) => !seen.has(employee.id)),
        ];
      });
      setNextCursor(page.nextCursor);
      cursorRef.current = page.nextCursor;
    } catch (cause: unknown) {
      if (requestId !== requestIdRef.current) return;
      setError(
        cause instanceof Error
          ? cause.message
          : 'تعذّر تحميل المزيد من الموظفين.',
      );
    } finally {
      if (requestId === requestIdRef.current) {
        setLoadingMore(false);
        busyRef.current = false;
      }
    }
  }, []);

  return useMemo<EmployeesResource>(
    () => ({
      employees,
      summary,
      loading,
      loadingMore,
      error,
      nextCursor,
      refresh,
      loadMore,
    }),
    [
      employees,
      summary,
      loading,
      loadingMore,
      error,
      nextCursor,
      refresh,
      loadMore,
    ],
  );
}
