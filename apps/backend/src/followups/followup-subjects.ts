/**
 * Pure derivation helpers for the employee follow-ups feature (task §3, §1).
 *
 * Subjects are derived ONLY from durable structured facts:
 *   - an approved `Property` row (`PROPERTY_OWNER`),
 *   - the stored `Client.requestData` document (`CLIENT_REQUEST` per type —
 *     NEVER a guess from `Client.notes` legacy text),
 *   - a `ClientPropertyInterest` row (`INQUIRY`),
 *   - a client with no document and no interests at all (`CLIENT` legacy).
 *
 * Nothing here reads, writes or interprets free-text notes.
 */

/** Structured request types stored in `Client.requestData.types`. */
export type RequestType = 'BUYER' | 'RENTER' | 'EXCHANGER';

export type FollowUpSubjectKindName =
  | 'PROPERTY_OWNER'
  | 'CLIENT_REQUEST'
  | 'INQUIRY'
  | 'CLIENT';

const REQUEST_TYPES: readonly RequestType[] = ['BUYER', 'RENTER', 'EXCHANGER'];

/** The eight follow-up tabs of the page (task §1, exact order). */
export type FollowUpTabId =
  | 'all'
  | 'owners'
  | 'buyers'
  | 'sellers'
  | 'renters'
  | 'lessors'
  | 'inquiries'
  | 'exchanges';

export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  BUYER: 'طلب شراء',
  RENTER: 'طلب إيجار',
  EXCHANGER: 'طلب بدل',
};

/**
 * Reads the approved request types out of the stored document.
 * Malformed/absent JSON → `[]` (a legacy client simply has no structured
 * requests — its notes are NEVER parsed into types).
 */
export function requestTypesOf(
  requestData: string | null | undefined,
): RequestType[] {
  if (!requestData) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(requestData);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const types = (parsed as { types?: unknown }).types;
  if (!Array.isArray(types)) return [];
  // Canonical order + de-duplication, so the derived subject set is stable.
  return REQUEST_TYPES.filter((type) => types.includes(type));
}

/** Canonical target identity of a subject — the database `@unique` value. */
export const subjectTargetKey = {
  property: (propertyId: string): string => `PROPERTY_OWNER:${propertyId}`,
  clientRequest: (clientId: string, type: RequestType): string =>
    `CLIENT_REQUEST:${clientId}:${type}`,
  inquiry: (interestId: string): string => `INQUIRY:${interestId}`,
  client: (clientId: string): string => `CLIENT:${clientId}`,
} as const;

/**
 * Recovers the structured parts of a `targetKey`. Returns null when the key
 * is malformed (never guess — the caller drops the row from derived views).
 */
export function parseTargetKey(
  targetKey: string,
): { kind: FollowUpSubjectKindName; clientId?: string; requestType?: RequestType } | null {
  const parts = targetKey.split(':');
  switch (parts[0]) {
    case 'PROPERTY_OWNER':
      return parts.length === 2 ? { kind: 'PROPERTY_OWNER' } : null;
    case 'CLIENT_REQUEST': {
      if (parts.length !== 3) return null;
      const type = parts[2] as RequestType;
      if (!REQUEST_TYPES.includes(type) || !parts[1]) return null;
      return { kind: 'CLIENT_REQUEST', clientId: parts[1], requestType: type };
    }
    case 'INQUIRY':
      return parts.length === 2 ? { kind: 'INQUIRY' } : null;
    case 'CLIENT':
      return parts.length === 2 ? { kind: 'CLIENT' } : null;
    default:
      return null;
  }
}

/** The listing types «البائعين»/«المؤجرين» split property owners by. */
export type ListingType = 'SALE' | 'RENT' | 'EXCHANGE';

/**
 * Which of the eight tabs a subject belongs to (§1: «one subject may appear
 * in multiple relevant tabs, but remains ONE underlying subject»).
 * `all` is implicit everywhere and added by the page.
 */
export function tabsOf(
  kind: FollowUpSubjectKindName,
  requestType?: RequestType | null,
  listingType?: ListingType | null,
): FollowUpTabId[] {
  switch (kind) {
    case 'PROPERTY_OWNER':
      if (listingType === 'SALE') return ['owners', 'sellers'];
      if (listingType === 'RENT') return ['owners', 'lessors'];
      // EXCHANGE owners (and unknown listing types) live under «الملاك» only —
      // the requirement defines no owner-side exchange tab.
      return ['owners'];
    case 'CLIENT_REQUEST':
      if (requestType === 'BUYER') return ['buyers'];
      if (requestType === 'RENTER') return ['renters'];
      if (requestType === 'EXCHANGER') return ['exchanges'];
      return [];
    case 'INQUIRY':
      return ['inquiries'];
    case 'CLIENT':
      // Legacy client-level subject: category unknown BY DESIGN (no structure
      // to read) — visible in «الكل» only, never guessed into a request tab.
      return [];
  }
}

export interface SubjectLabelParts {
  kind: FollowUpSubjectKindName;
  requestType?: RequestType | null;
  /** Property reference code (`A-000123`), when the subject has a property. */
  reference?: string | null;
  /** Client name, when the subject has a client. */
  clientName?: string | null;
}

/** The stable display identity of one subject (cards, history, notifications). */
export function subjectLabel(parts: SubjectLabelParts): string {
  switch (parts.kind) {
    case 'PROPERTY_OWNER':
      return `مالك العقار ${parts.reference?.trim() || '—'}`;
    case 'INQUIRY':
      return `استفسار عن العقار ${parts.reference?.trim() || '—'}`;
    case 'CLIENT_REQUEST': {
      const base =
        parts.requestType && REQUEST_TYPE_LABELS[parts.requestType]
          ? REQUEST_TYPE_LABELS[parts.requestType]
          : 'طلب عميل';
      const name = parts.clientName?.trim();
      return name ? `${base} — ${name}` : base;
    }
    case 'CLIENT':
      return `متابعة عميل ${parts.clientName?.trim() || '—'}`;
  }
}
