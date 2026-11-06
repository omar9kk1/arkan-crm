import type { Prisma } from '@prisma/client';
import { isUnreadableName } from './clients.service';

/**
 * The staged proposal carried by a `ClientReviewRequest`. The row's `payload`
 * JSON column holds EXACTLY this document: packed/decoded ONLY here (same
 * opaque-store convention as `Client.requestData`), so a legacy or unknown
 * shape degrades to a safe review instead of crashing.
 *
 * `addInterests`/`removeInterests` cover linked property interest changes —
 * NOT just the plain identity columns — so a wizard edit can also propose
 * linking new program properties or dropping recorded ones.
 */
export interface ClientReviewPayloadV1 {
  version: 1;
  kind: 'CREATION' | 'EDIT';
  /** The proposed identity values (ALL of them, so approval is a full write). */
  client: { name: string; phone: string; notes: string | null };
  /** The proposed structured wizard document — a valid JSON string, or null. */
  requestData: string | null;
  /** Interests to upsert on approval (validated again at approval time). */
  addInterests: ClientReviewInterestV1[];
  /** EDIT only: property ids of recorded interests the requester removed. */
  removeInterests: string[];
  /** The requester's own note for the reviewer. Never used in notifications. */
  submissionNote?: string;
}

export interface ClientReviewInterestV1 {
  propertyId: string;
  reason: string | null;
  notes: string | null;
}

/**
 * The approved-client snapshot taken when an EDIT review is submitted.
 * Approval compares THIS against a fresh read inside the SAME transaction:
 * a mismatch means the live client moved during review → safe 409, never a
 * silent rebase that would overwrite someone else's committed work.
 */
export interface ClientReviewBaseV1 {
  version: 1;
  name: string;
  phone: string;
  notes: string | null;
  requestData: string | null;
  /** ISO `Client.updatedAt` at submission time. */
  updatedAt: string;
  /** The client's current links, sorted by propertyId (comparable shape). */
  interests: ClientReviewInterestV1[];
}

/**
 * Normalizes a validated DTO into the stored payload document. Every value is
 * derived here — never trusted from the wire — with the SAME unreadable-name
 * guard the direct client paths use, so a corrupted wizard pack can never be
 * handed to a manager for approval.
 */
export function normalizeClientReviewPayload(input: {
  kind: 'CREATION' | 'EDIT';
  name: string;
  phone: string;
  notes?: string | null;
  requestData?: string | null;
  addInterests?: ClientReviewInterestV1[];
  removeInterests?: string[];
  submissionNote?: string | null;
}): ClientReviewPayloadV1 | { error: string } {
  const name = input.name.trim();
  if (!name) return { error: 'أدخل اسم العميل.' };
  // Same store-entry corruption guard as `POST/PATCH /clients`.
  if (isUnreadableName(name))
    return {
      error:
        'الاسم غير قابل للقراءة — علامات استفهام بدل الحروف. أدخل اسم العميل بلون سليم.',
    };
  const phone = input.phone.trim();
  if (!phone) return { error: 'أدخل رقم هاتف العميل.' };
  if (input.requestData != null && input.requestData.trim() !== '') {
    try {
      JSON.parse(input.requestData);
    } catch {
      return { error: 'شكل بيانات الطلب غير صالح.' };
    }
  }
  const seen = new Set<string>();
  const addInterests: ClientReviewInterestV1[] = [];
  for (const row of input.addInterests ?? []) {
    if (seen.has(row.propertyId)) continue;
    seen.add(row.propertyId);
    addInterests.push({
      propertyId: row.propertyId,
      reason: row.reason?.trim() || null,
      notes: row.notes?.trim() || null,
    });
  }
  if (input.kind === 'EDIT' && input.removeInterests?.length) {
    for (const id of input.removeInterests) seen.add(`remove:${id}`);
  }
  const removeInterests =
    input.kind === 'EDIT'
      ? [...new Set(input.removeInterests ?? [])]
      : [];
  const payload: ClientReviewPayloadV1 = {
    version: 1,
    kind: input.kind,
    client: {
      name,
      phone,
      notes: input.notes?.trim() || null,
    },
    requestData: input.requestData?.trim() || null,
    addInterests,
    removeInterests,
  };
  if (input.submissionNote?.trim())
    payload.submissionNote = input.submissionNote.trim();
  return payload;
}

/** Builds the comparable approved-state snapshot for an EDIT submission. */
export function buildClientReviewBase(input: {
  name: string;
  phone: string;
  notes: string | null;
  requestData: string | null;
  updatedAt: Date;
  interests: { propertyId: string; reason: string | null; notes: string | null }[];
}): ClientReviewBaseV1 {
  return {
    version: 1,
    name: input.name,
    phone: input.phone,
    notes: input.notes,
    requestData: input.requestData,
    updatedAt: input.updatedAt.toISOString(),
    interests: [...input.interests]
      .map((interest) => ({
        propertyId: interest.propertyId,
        reason: interest.reason ?? null,
        notes: interest.notes ?? null,
      }))
      .sort((a, b) => (a.propertyId < b.propertyId ? -1 : 1)),
  };
}

/** Structural equality of two snapshot documents (order-insensitive). */
export function sameBase(
  stored: unknown,
  fresh: ClientReviewBaseV1,
): boolean {
  if (
    !stored ||
    typeof stored !== 'object' ||
    Array.isArray(stored) ||
    (stored as ClientReviewBaseV1).version !== 1
  )
    return false;
  const row = stored as ClientReviewBaseV1;
  const previous = {
    version: 1,
    name: row.name,
    phone: row.phone,
    notes: row.notes ?? null,
    requestData: row.requestData ?? null,
    updatedAt: row.updatedAt,
    interests: (row.interests ?? [])
      .map((interest) => ({
        propertyId: interest.propertyId,
        reason: interest.reason ?? null,
        notes: interest.notes ?? null,
      }))
      .sort((a, b) => (a.propertyId < b.propertyId ? -1 : 1)),
  };
  return JSON.stringify(previous) === JSON.stringify(fresh);
}

/** Tolerant decode of a stored payload column (legacy/unknown → safe null). */
export function decodeClientReviewPayload(
  stored: unknown,
): ClientReviewPayloadV1 | null {
  if (
    !stored ||
    typeof stored !== 'object' ||
    Array.isArray(stored) ||
    (stored as ClientReviewPayloadV1).version !== 1
  )
    return null;
  const row = stored as ClientReviewPayloadV1;
  if (row.kind !== 'CREATION' && row.kind !== 'EDIT') return null;
  if (!row.client || typeof row.client.name !== 'string') return null;
  return {
    ...row,
    client: {
      name: row.client.name,
      phone:
        typeof row.client.phone === 'string' ? row.client.phone : '',
      notes: row.client.notes ?? null,
    },
    requestData: row.requestData ?? null,
    addInterests: Array.isArray(row.addInterests) ? row.addInterests : [],
    removeInterests: Array.isArray(row.removeInterests)
      ? row.removeInterests
      : [],
  };
}

/** Cast helper for the `Json` column when writing the payload. */
export function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/**
 * Structural equality of two JSON documents, key-order-insensitive:
 * PostgreSQL `jsonb` does NOT preserve key order, so a raw string compare of
 * a round-tripped payload would always differ.
 */
export function sameJsonDocument(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([x], [y]) => (x < y ? -1 : 1))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(',')}}`;
}
