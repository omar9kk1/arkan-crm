import type { UpdateClientDto } from './dto/update-client.dto';

/**
 * The structured wizard request state persisted on `Client.requestData`
 * (approved one-column migration `20261021232825_client_request_data`).
 *
 * The FRONTEND alone packs this document (it owns the wizard model); the
 * service stores the string opaquely and owns the DECODED reading below for
 * change detection and the manager notification. Every legacy or unparsable
 * row degrades to `null` — never an error, never a rewrite of human notes.
 */

export interface StoredClientRequestBundle {
  version: 1;
  /** Wizard request types exactly as the client model defines them. */
  types: unknown;
  /** Per-type wizard draft (opaque nested document, read defensively). */
  requests: unknown;
}

export interface DecodedClientRequestBundle {
  types: string[];
  requests: Record<string, Record<string, unknown>>;
}

/** Decode `Client.requestData`; anything unexpected reads as "nothing yet". */
export function decodeClientRequestData(
  raw: string | null | undefined,
): DecodedClientRequestBundle | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return null;
    const doc = parsed as Partial<StoredClientRequestBundle>;
    if (doc.version !== 1) return null;
    const types = Array.isArray(doc.types)
      ? doc.types.filter(
          (type): type is string =>
            typeof type === 'string' &&
            ['BUYER', 'RENTER', 'EXCHANGER'].includes(type),
        )
      : [];
    const requests: Record<string, Record<string, unknown>> = {};
    if (doc.requests && typeof doc.requests === 'object') {
      for (const [type, draft] of Object.entries(
        doc.requests as Record<string, unknown>,
      )) {
        if (
          draft &&
          typeof draft === 'object' &&
          !Array.isArray(draft) &&
          typeof type === 'string'
        )
          requests[type] = draft as Record<string, unknown>;
      }
    }
    return { types, requests };
  } catch {
    return null;
  }
}

/** Arabic label per wizard request type (stays in sync with the frontend). */
const TYPE_LABELS: Record<string, string> = {
  BUYER: 'مشتري',
  RENTER: 'مستأجر',
  EXCHANGER: 'مبدل عقار',
};

/**
 * Structured per-type fields compared with old → new wording. The REQUIREMENT
 * of privacy: the wizard free-text message, its `notes` and the custom fields
 * NEVER travel to the notification — they appear only as a fact that something
 * changed.
 */
const STRUCTURED_FIELDS: {
  key: string;
  labels: string[];
}[] = [
  // budget and budgetTo combine into ONE range item.
  { key: 'budget', labels: ['budget', 'budgetTo'] },
  { key: 'area', labels: ['area'] },
  { key: 'governorate', labels: ['governorate'] },
  { key: 'propertyType', labels: ['propertyType'] },
  { key: 'operationType', labels: ['operationType'] },
  { key: 'size', labels: ['size'] },
  { key: 'roomsOrFloor', labels: ['roomsOrFloor'] },
  { key: 'duration', labels: ['duration'] },
];

const BUDGET_LABEL = 'الميزانية';
const FIELD_LABELS: Record<string, string> = {
  area: 'المنطقة',
  governorate: 'المحافظة',
  propertyType: 'نوع العقار',
  operationType: 'نوع العملية',
  size: 'الحجم',
  roomsOrFloor: 'الغرف أو الطابق',
  duration: 'مدة الإيجار',
};

/**
 * The privacy-safe Arabic summary of a wizard EDIT save: the REAL changed
 * request fields, with old → new values for the structured non-sensitive ones
 * (budget, area, property type…), type-set changes, and a fact-only wording
 * for anything free-text. Appended to the plain client-fields summary.
 */
export function clientRequestChangeSummary(
  existingRaw: string | null,
  dto: UpdateClientDto,
): string[] {
  if (dto.requestData === undefined) return [];
  const nextRaw = dto.requestData?.trim() || null;
  const before = decodeClientRequestData(existingRaw);
  const after = decodeClientRequestData(nextRaw);
  if (before === null || after === null) {
    // A one-sided document: the decodable side still names the added/removed
    // TYPES (never invented values); the budget/details stay a fact.
    if ((existingRaw ?? null) === nextRaw) return [];
    const items: string[] = [];
    if (before === null && after !== null) {
      for (const type of after.types)
        items.push(`أُضيف نوع الطلب: ${TYPE_LABELS[type] ?? type}`);
      items.push('تم تعديل تفاصيل الطلب');
    } else if (after === null && before !== null) {
      for (const type of before.types)
        items.push(`أُزيل نوع الطلب: ${TYPE_LABELS[type] ?? type}`);
      items.push('تم تعديل تفاصيل الطلب');
    } else {
      items.push('تم تعديل تفاصيل الطلب');
    }
    return items;
  }
  const items: string[] = [];
  const beforeTypes = new Set(before.types);
  const afterTypes = new Set(after.types);
  for (const type of after.types)
    if (!beforeTypes.has(type))
      items.push(`أُضيف نوع الطلب: ${TYPE_LABELS[type] ?? type}`);
  for (const type of before.types)
    if (!afterTypes.has(type))
      items.push(`أُزيل نوع الطلب: ${TYPE_LABELS[type] ?? type}`);
  for (const type of before.types) {
    if (!afterTypes.has(type)) continue;
    const beforeDraft = before.requests[type] ?? {};
    const afterDraft = after.requests[type] ?? {};
    const label = TYPE_LABELS[type] ?? type;
    const afterDetails = recordOf(afterDraft['requestDetails']);
    if (!afterDetails) {
      // The request became a free-form draft or was removed — fact only.
      if (JSON.stringify(beforeDraft) !== JSON.stringify(afterDraft))
        items.push(`تم تعديل تفاصيل طلب ${label}`);
      continue;
    }
    const beforeDetails = recordOf(beforeDraft['requestDetails']);
    if (!beforeDetails) {
      if (JSON.stringify(beforeDraft) !== JSON.stringify(afterDraft))
        items.push(`تم تعديل تفاصيل طلب ${label}`);
      continue;
    }
    const beforeDesired = recordOf(beforeDetails['desiredProperty']);
    const afterDesired = recordOf(afterDetails['desiredProperty']);
    if (!beforeDesired || !afterDesired) {
      if (JSON.stringify(beforeDetails) !== JSON.stringify(afterDetails))
        items.push(`تم تعديل تفاصيل طلب ${label}`);
      continue;
    }
    // Structured scalars, old → new.
    for (const field of STRUCTURED_FIELDS)
      if (fieldDiff(beforeDesired, afterDesired, field.labels))
        items.push(rangeItem(field.key, beforeDesired, afterDesired));
    // EVERYTHING that remains in the whole draft (message text, notes, floors,
    // specifications, custom fields, the current property…) is private
    // free-form content — a deep-equality check, a fact-only wording.
    const beforeRest = structuredRest(beforeDraft, beforeDesired, beforeDetails);
    const afterRest = structuredRest(afterDraft, afterDesired, afterDetails);
    if (JSON.stringify(beforeRest) !== JSON.stringify(afterRest))
      items.push(`تم تعديل تفاصيل طلب ${label}`);
  }
  return items;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Did ANY of the (possibly combined) labels change between the two drafts? */
function fieldDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels: string[],
): boolean {
  return labels.some((label) => textOf(before[label]) !== textOf(after[label]));
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : value === null ? '' : '';
}

/** `الميزانية: من X إلى Y` (range) or a plain `الحقل: من X إلى Y`. */
function rangeItem(
  key: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string {
  const label = key === 'budget' ? BUDGET_LABEL : FIELD_LABELS[key] ?? key;
  // The budget combines its floor and ceiling into ONE concise range: the
  // wording reads «الميزانية: من 10 – 15 إلى 20 – 30».
  if (key === 'budget')
    return `${label}: من ${budgetRange(before)} إلى ${budgetRange(after)}`;
  return `${label}: من ${textOf(before[key]) || 'مسجّل'} إلى ${textOf(after[key]) || 'مسجّل'}`;
}

/** `10 – 15` from `budget`/`budgetTo`, one bound alone, or «غير محدد». */
function budgetRange(record: Record<string, unknown>): string {
  const from = textOf(record['budget']);
  const to = textOf(record['budgetTo']);
  if (from && to) return `${from} – ${to}`;
  return from || to || 'غير محدد';
}

/** The draft MINUS the structured desiredProperty scalars already compared. */
function structuredRest(
  draft: Record<string, unknown>,
  desired: Record<string, unknown>,
  details: Record<string, unknown>,
): unknown {
  const restDesired = { ...desired };
  for (const keep of ['budget', 'budgetTo', 'area', 'governorate', 'propertyType', 'operationType', 'size', 'roomsOrFloor', 'duration'])
    delete restDesired[keep];
  return {
    ...draft,
    requestDetails: { ...details, desiredProperty: restDesired },
  };
}
