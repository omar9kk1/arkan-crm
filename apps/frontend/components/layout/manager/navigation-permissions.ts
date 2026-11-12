/**
 * Role-based visibility for the shared Manager navigation. Kept in a plain
 * `.ts` module so the ownership rule is unit-testable without a React runtime.
 */
export const OWNER_ONLY_NAV_IDS = ['finance', 'trash'] as const;

export function visibleManagerMoreNavigation<T extends { id: string }>(
  role: string | undefined,
  items: readonly T[],
): T[] {
  if (role === 'OWNER') return [...items];
  return items.filter(
    (item) => !OWNER_ONLY_NAV_IDS.includes(item.id as 'finance' | 'trash'),
  );
}
