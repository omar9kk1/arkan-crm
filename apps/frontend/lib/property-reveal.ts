/**
 * Deep-link target resolution for the property lists (Manager + Employee).
 *
 * Opening a linked property from the Owner drawer must show the EXACT card in the
 * real grid — not merely open a drawer. This module owns the pure decisions for
 * that: which tab shows a given row, and which URL query parameter carries the
 * target id. Everything here is a pure function so it can be unit tested without
 * a React renderer, and the async fetch/scroll lives in the caller.
 *
 * The target is always identified by the immutable `Property.id`, never by a
 * property code, an array index or an owner name.
 */

/** URL query parameter that carries the deep-linked property id. */
export const PROPERTY_QUERY_PARAM = 'property';

/** Characters we accept in an id taken from the URL, before hitting the API. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads the deep-linked property id from a read-only search-params object.
 * Returns `null` for a missing parameter or anything that is not a UUID, so a
 * hand-edited URL can never trigger a lookup with an arbitrary string.
 */
export function readPropertyParam(
  params: { get(name: string): string | null } | null,
): string | null {
  const value = params?.get(PROPERTY_QUERY_PARAM)?.trim();
  if (!value || !UUID_PATTERN.test(value)) return null;
  return value;
}

/**
 * Manager tabs: `program` is the published inventory (AVAILABLE + SOLD rows);
 * `approval` gathers every authorized unapproved row (PENDING or REJECTED).
 * Returns the tab that makes a row of `apiStatus` visible, or `null` when the
 * row belongs to neither (e.g. a status the manager surface does not list).
 */
export function managerTabForStatus(
  apiStatus: string | undefined,
): 'program' | 'approval' | null {
  if (apiStatus === 'AVAILABLE' || apiStatus === 'SOLD') return 'program';
  if (apiStatus === 'PENDING' || apiStatus === 'REJECTED') return 'approval';
  return null;
}

/**
 * Employee tabs. Reuses the page's own `matchesTab` rule passed in by the
 * caller (so the count logic, the panel filter and this reveal can never
 * disagree), preferring the broadest tab that shows the row:
 * `all` first (approved inventory), then `review`, then `changes`.
 * Returns `null` when no tab can show the row for this viewer.
 */
export function employeeTabForRow(
  row: { apiStatus?: string; mine?: boolean; reviewStatus?: string | null },
  matchesTab: (row: unknown, tab: string) => boolean,
  orderedTabs: readonly string[] = ['all', 'mine', 'review', 'changes'],
): string | null {
  for (const tab of orderedTabs) {
    if (matchesTab(row, tab)) return tab;
  }
  return null;
}

/**
 * Merges a resolved deep-link target into the loaded rows so the exact card is
 * present even when it was not in the paginated window. The resolved row is the
 * REAL authorized DTO from `GET /properties/:id` — never a synthesised card —
 * and an already-present row is left untouched (no duplicate). Rows with an
 * optional id (the manager's `PreviewProperty`) are supported.
 */
export function withRevealedRow<T extends { id?: string | undefined }>(
  items: readonly T[],
  revealed: T | null,
): T[] {
  if (!revealed) return [...items];
  if (revealed.id !== undefined && items.some((item) => item.id === revealed.id))
    return [...items];
  return [...items, revealed];
}
