export const DRAFT_PREFIX = 'arkan:draft:v1:';
export function sanitizeDraft(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeDraft);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/password|token|secret|credential/i.test(key))
        .map(([key, item]) => [key, sanitizeDraft(item)]),
    );
  return value;
}
export function decodeDraft(raw: string | null, initial: unknown): unknown {
  if (!raw) return undefined;
  try {
    const record = JSON.parse(raw);
    if (record.version !== 1 || !Number.isFinite(record.updatedAt))
      return undefined;
    const data = record.data;
    if (
      initial !== null &&
      (Array.isArray(initial)
        ? !Array.isArray(data)
        : typeof initial !== typeof data ||
          (typeof initial === 'object' &&
            (data === null || Array.isArray(data))))
    )
      return undefined;
    return sanitizeDraft(data);
  } catch {
    return undefined;
  }
}

// Called only from effects or their save/cleanup callbacks, never during render.
export function readStoredDraft(key: string): string | null {
  const candidates: string[] = [];
  for (const getStorage of [() => localStorage, () => sessionStorage]) {
    try {
      const raw = getStorage().getItem(key);
      if (raw && decodeDraft(raw, null) !== undefined) candidates.push(raw);
    } catch {
      /* Storage can be blocked. */
    }
  }
  return (
    candidates.sort(
      (a, b) => JSON.parse(b).updatedAt - JSON.parse(a).updatedAt,
    )[0] ?? null
  );
}
export function writeStoredDraft(key: string, raw: string) {
  try {
    localStorage.setItem(key, raw);
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* Legacy cleanup is optional. */
    }
  } catch {
    try {
      sessionStorage.setItem(key, raw);
    } catch {
      /* Editing must remain available. */
    }
  }
}
export function storedDraftKeys(): string[] {
  const keys = new Set<string>();
  for (const getStorage of [() => localStorage, () => sessionStorage]) {
    try {
      Object.keys(getStorage())
        .filter((key) => key.startsWith(DRAFT_PREFIX))
        .forEach((key) => keys.add(key));
    } catch {
      /* Storage can be blocked. */
    }
  }
  return [...keys];
}
export function removeStoredDraft(key: string) {
  for (const getStorage of [() => localStorage, () => sessionStorage]) {
    try {
      getStorage().removeItem(key);
    } catch {
      /* Storage can be blocked. */
    }
  }
}
export function draftPrefix(
  userId: string,
  role: string,
  path: string,
  form: string,
) {
  return `${DRAFT_PREFIX}${encodeURIComponent(userId)}:${role}:${encodeURIComponent(path)}:${form}:`;
}
