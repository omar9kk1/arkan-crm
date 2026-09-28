'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type ChangeEvent,
} from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '../../features/auth/components/auth-provider';
import {
  decodeDraft,
  draftPrefix,
  sanitizeDraft,
  readStoredDraft,
  writeStoredDraft,
  removeStoredDraft,
  storedDraftKeys,
} from './draft-storage';
const CLEAR = 'arkan:clear-draft';
function useDraftPrefix(form: string) {
  const { user } = useAuth();
  const path = usePathname();
  return user ? draftPrefix(user.id, user.role, path, form) : null;
}
export function useFormDraft<T>(draftKey: string, initialState: T | (() => T)) {
  const scope = useDraftPrefix(draftKey);
  const [value, setValue] = useState(initialState);
  const [ready, setReady] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const initial = useRef(value),
    latest = useRef(value),
    enabled = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (!scope || !enabled.current) return;
    try {
      writeStoredDraft(
        scope,
        JSON.stringify({
          version: 1,
          updatedAt: Date.now(),
          data: sanitizeDraft(latest.current),
        }),
      );
    } catch {
      /* Private mode/quota must not prevent editing. */
    }
  }, [scope]);
  const saveDraft: Dispatch<SetStateAction<T>> = useCallback(
    (next) => {
      const result =
        typeof next === 'function'
          ? (next as (old: T) => T)(latest.current)
          : next;
      latest.current = result;
      enabled.current = true;
      setValue(result);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 500);
    },
    [flush],
  );
  const clearDraft = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    enabled.current = false;
    if (scope)
      try {
        removeStoredDraft(scope);
      } catch {
        /* Storage may be unavailable. */
      }
    latest.current = initial.current;
    setValue(initial.current);
    setHasDraft(false);
  }, [scope]);
  useEffect(() => {
    if (!scope) return;
    let restored: unknown;
    try {
      restored = decodeDraft(readStoredDraft(scope), initial.current);
    } catch {
      /* Storage may be unavailable. */
    }
    if (restored !== undefined) {
      latest.current = restored as T;
      setValue(restored as T);
      setHasDraft(true);
      // Migrate earlier session-only saves so closing the browser won't lose them.
      writeStoredDraft(
        scope,
        JSON.stringify({
          version: 1,
          updatedAt: Date.now(),
          data: sanitizeDraft(restored),
        }),
      );
    } else {
      latest.current = initial.current;
      setValue(initial.current);
    }
    enabled.current = restored !== undefined;
    setReady(true);
    const clear = (e: Event) => {
      if (scope.startsWith((e as CustomEvent<string>).detail)) clearDraft();
    };
    const hide = () => flush();
    const visibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener(CLEAR, clear);
    window.addEventListener('pagehide', hide);
    window.addEventListener('beforeunload', hide);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      flush();
      window.removeEventListener(CLEAR, clear);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('beforeunload', hide);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [scope, flush, clearDraft]);
  return { value, setValue: saveDraft, saveDraft, clearDraft, hasDraft, ready };
}
export function useDraftState<T>(
  key: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const d = useFormDraft(key, initial);
  return [d.value, d.setValue];
}
export function useDraftScope(form: string) {
  const prefix = useDraftPrefix(form);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!prefix) return;
    try {
      setRestored(
        storedDraftKeys().some(
          (k) =>
            k.startsWith(prefix) &&
            decodeDraft(readStoredDraft(k), null) !== undefined,
        ),
      );
    } catch {
      /* Storage may be unavailable. */
    }
  }, [prefix]);
  const clear = useCallback(() => {
    if (!prefix) return;
    window.dispatchEvent(new CustomEvent(CLEAR, { detail: prefix }));
    try {
      storedDraftKeys()
        .filter((k) => k.startsWith(prefix))
        .forEach(removeStoredDraft);
    } catch {
      /* Storage may be unavailable. */
    }
    setRestored(false);
  }, [prefix]);
  return { clear, restored, prefix };
}
export function useDraftFields(form: string) {
  const [fields, setFields] = useDraftState<Record<string, string>>(
    `${form}:fields`,
    {},
  );
  return (name: string, fallback = '') => ({
    value: fields[name] ?? fallback,
    onChange: (
      event: ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => setFields((old) => ({ ...old, [name]: event.target.value })),
  });
}
