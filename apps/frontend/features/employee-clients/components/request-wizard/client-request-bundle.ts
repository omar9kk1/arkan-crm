import {
  formatSnapshotPrice,
  initialRequest,
  clientLabels,
  requestError,
  normalizeLinkedProperty,
  requestSummary,
  parseStoredRequestData,
  type ClientRequestDraft,
  type ClientType,
} from './client-request-model';
import type { EmployeeClient } from '../../client-model';
import type { PropertyInterestPayload } from '../../../../lib/api/client-types';
export interface ClientRequestBundle {
  mode: 'NEW_CLIENT' | 'EXISTING_CLIENT';
  clientId: string;
  name: string;
  phone: string;
  notes: string;
  types: ClientType[];
  requests: Partial<Record<ClientType, ClientRequestDraft>>;
}
export function initialBundle(): ClientRequestBundle {
  return {
    mode: 'NEW_CLIENT',
    clientId: '',
    name: '',
    phone: '',
    notes: '',
    types: [],
    requests: {},
  };
}
export function selectClient(client: EmployeeClient): ClientRequestBundle {
  if (client.requestBundle)
    return {
      ...client.requestBundle,
      mode: 'EXISTING_CLIENT',
      clientId: client.id,
    };
  const types: ClientType[] = [];
  if (client.type.includes('شراء')) types.push('BUYER');
  if (client.type.includes('إيجار')) types.push('RENTER');
  if (client.type.includes('بدل')) types.push('EXCHANGER');
  const requests: ClientRequestBundle['requests'] = {};
  for (const type of types)
    requests[type] =
      client.requestDraft?.clientType === type
        ? client.requestDraft
        : { ...initialRequest(), clientType: type };
  return {
    mode: 'EXISTING_CLIENT',
    clientId: client.id,
    name: client.name,
    phone: client.phone,
    notes: client.notes,
    types,
    requests,
  };
}
export function toggleType(
  bundle: ClientRequestBundle,
  type: ClientType,
): ClientRequestBundle {
  return {
    ...bundle,
    types: bundle.types.includes(type)
      ? bundle.types.filter((t) => t !== type)
      : [...bundle.types, type],
    requests: {
      ...bundle.requests,
      [type]: bundle.requests[type] || {
        ...initialRequest(),
        clientType: type,
      },
    },
  };
}
/**
 * The bundle EDIT mode saves through `PATCH /clients/:id` — the SAME client
 * row, never a second one. The per-type notes and free message text stay in
 * the structured document; the human `notes` column is only what the user
 * sees/edits in step 1 (prefilled from the persisted notes, never the
 * request summary — legacy notes are not rewritten behind their back).
 */
export interface EditClientRequestPayload {
  name: string;
  phone: string;
  notes: string | null;
  /** The packed wizard request document this save becomes. */
  requestData: string;
  /** Real linked selections, upserted on the client (server-validated). */
  propertyInterests: PropertyInterestPayload[];
  /** Persisted structured links the user explicitly dropped in the wizard. */
  removePropertyInterestIds: string[];
}
/**
 * The bundle EDIT mode starts from: identity prefilled with the REAL client
 * columns, the structured request restored from the persisted document (or
 * deliberately empty when none exists yet — nothing is invented), and the
 * persisted session bundle ignored in favour of the trustworthy store.
 */
export function editBundleFromClient(
  client: Pick<
    EmployeeClient,
    'id' | 'name' | 'phone' | 'notes' | 'requestData' | 'propertyInterests'
  >,
): ClientRequestBundle {
  const base: ClientRequestBundle = {
    mode: 'EXISTING_CLIENT',
    clientId: client.id,
    name: client.name,
    phone: client.phone,
    notes: client.notes,
    types: [],
    requests: {},
  };
  // Overlay the persisted document (identity stays from the columns — the
  // stored draft copies of name/phone may be stale).
  const stored = parseStoredRequestData(client.requestData);
  if (!stored) return base;
  return {
    ...base,
    types: [...stored.types],
    requests: { ...stored.requests },
  };
}
/** The interest property-ids the user made a linked choice about. */
function storedLinkedIds(bundle: ClientRequestBundle): string[] {
  return bundle.types
    .map((type) => {
      const draft = bundle.requests[type];
      if (!draft?.interest.hasLinkedProperty) return '';
      return normalizeLinkedProperty(draft.linkedProperty).propertyId;
    })
    .filter(Boolean);
}
/**
 * The `PATCH` payload of a wizard EDIT save. Removal is an EXPLICIT user
 * consequence: an id the persisted document linked and this save no longer
 * links (the user unticked it or replaced it). Persisted interests that were
 * never part of the structured state are NEVER silently removed — they stay
 * exactly as they are.
 */
export function editClientSavePayload(
  bundle: ClientRequestBundle,
  editing: Pick<
    EmployeeClient,
    'id' | 'name' | 'phone' | 'notes' | 'requestData' | 'propertyInterests'
  >,
): EditClientRequestPayload {
  const nowLinked = new Set(
    storedLinkedIds(bundle),
  );
  const beforeLinked = new Set(
    storedLinkedIds(editBundleFromClient(editing)),
  );
  const persisted = bundlePropertyInterests(bundle);
  return {
    name: bundle.name.trim(),
    phone: bundle.phone.trim(),
    notes: bundle.notes.trim() || null,
    requestData: JSON.stringify({
      version: 1,
      types: bundle.types,
      requests: bundle.requests,
    }),
    propertyInterests: persisted,
    // Only structured links that existed BEFORE may become removals here.
    removePropertyInterestIds: [...beforeLinked].filter(
      (id) => !nowLinked.has(id),
    ),
  };
}
export function typeDraft(
  b: ClientRequestBundle,
  type: ClientType,
): ClientRequestDraft {
  return {
    ...(b.requests[type] || initialRequest()),
    clientType: type,
    name: b.name,
    phone: b.phone,
    // The per-type note belongs to the STORED draft: a restored edit draft
    // keeps its persisted note (never reset), and a fresh draft starts ''.
    notes: b.requests[type]?.notes ?? '',
  };
}
export function bundleError(
  b: ClientRequestBundle,
  step: number,
  clients: readonly EmployeeClient[],
  /** Edit mode: dropping ALL types is an explicit outcome, not an error. */
  editing = false,
): string {
  // The edit flow is LOCKED to its client id (never a combobox choice), so
  // the registry of openable clients is irrelevant and may be empty.
  if (!editing && b.mode === 'EXISTING_CLIENT' && !clients.some((c) => c.id === b.clientId))
    return 'اختر عميلًا موجودًا.';
  if (!b.name.trim() || !b.phone.trim()) return 'أدخل اسم العميل ورقم الهاتف.';
  if (step >= 1 && !editing && !b.types.length)
    return 'اختر نوع طلب واحدًا على الأقل، ويمكنك اختيار أكثر من نوع.';
  if (step >= 2)
    for (const type of b.types) {
      const error = requestError(typeDraft(b, type), step === 2 ? 1 : 2);
      if (error) return `${clientLabels[type]}: ${error}`;
    }
  return '';
}
export function bundleSummary(b: ClientRequestBundle): string {
  return [b.notes, ...b.types.map((type) => requestSummary(typeDraft(b, type)))]
    .filter(Boolean)
    .join('\n\n');
}
/**
 * The interests the final save must PERSIST in the database: only real linked
 * selections — a draft with `hasLinkedProperty` whose `Property.id` matches its
 * snapshot. One payload entry per DISTINCT property (a repeated pick never
 * duplicates; the backend upserts the (client, property) pair). Properties from
 * the free-text "new request" path are intentionally NOT here — no durable
 * entity exists for them and no `Property.id` points at anything.
 */
export function bundlePropertyInterests(
  b: ClientRequestBundle,
): PropertyInterestPayload[] {
  const interests = new Map<string, PropertyInterestPayload>();
  for (const type of b.types) {
    const draft = typeDraft(b, type);
    if (!draft.interest.hasLinkedProperty) continue;
    const linked = normalizeLinkedProperty(draft.linkedProperty);
    if (!linked.propertyId || !linked.property) continue;
    interests.set(linked.propertyId, {
      propertyId: linked.propertyId,
      ...(linked.reason.trim() ? { reason: linked.reason.trim() } : {}),
      ...(linked.notes.trim() ? { notes: linked.notes.trim() } : {}),
    });
  }
  return [...interests.values()];
}
export function saveBundle(
  b: ClientRequestBundle,
  clients: readonly EmployeeClient[],
): EmployeeClient {
  const old =
    b.mode === 'EXISTING_CLIENT'
      ? clients.find((c) => c.id === b.clientId)
      : undefined;
  const drafts = b.types.map((type) => typeDraft(b, type));
  // The interest payloads that WILL be persisted with this save (validated
  // server-side): real selections only.
  const persistedInterests = bundlePropertyInterests(b);
  // Linked rows here are ONLY real selections: a snapshot whose id matches the
  // draft's `Property.id`. The old demo list is gone — nothing is attached
  // unless it was picked from a real, authorized backend search result.
  const linked = drafts
    .map((d) => normalizeLinkedProperty(d.linkedProperty))
    .filter((l) => l.propertyId && l.property)
    .map((l) => l.property!);
  const allProperties = [
    ...(old?.properties || []),
    ...linked.map((p) => ({
      name: p.reference,
      area: p.area,
      price: formatSnapshotPrice(p.askingPrice),
    })),
  ].filter((p, i, list) => list.findIndex((v) => v.name === p.name) === i);
  const operations = { BUYER: 'شراء', RENTER: 'إيجار', EXCHANGER: 'بدل' };
  const sanitized: ClientRequestBundle['requests'] = {};
  for (const d of drafts)
    sanitized[d.clientType] = {
      ...d,
      message: d.interest.hasNewRequest ? d.message : '',
      requestDetails: d.interest.hasNewRequest ? d.requestDetails : null,
      linkedProperty: d.interest.hasLinkedProperty
        ? normalizeLinkedProperty(d.linkedProperty)
        : { propertyId: '', property: null, reason: '', notes: '' },
    };
  const areas = drafts
    .map((d) =>
      d.interest.hasNewRequest
        ? d.requestDetails?.desiredProperty.area
        : normalizeLinkedProperty(d.linkedProperty).property?.area,
    )
    .filter(Boolean);
  return {
    ...old,
    id:
      old?.id ||
      globalThis.crypto?.randomUUID?.() ||
      `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    name: b.name.trim(),
    phone: b.phone.trim(),
    type: b.types.map((t) => operations[t]).join(' / '),
    employee: old?.employee || 'غير مُسند',
    area: areas.join(' / ') || 'غير محدد',
    budget: drafts
      .map(
        (d) =>
          `${clientLabels[d.clientType]}: ${d.interest.hasNewRequest ? [d.requestDetails?.desiredProperty.budget && `من ${d.requestDetails.desiredProperty.budget}`, d.requestDetails?.desiredProperty.budgetTo && `إلى ${d.requestDetails.desiredProperty.budgetTo}`].filter(Boolean).join(' ') || 'غير محدد' : formatSnapshotPrice(normalizeLinkedProperty(d.linkedProperty).property?.askingPrice ?? null)}`,
      )
      .join(' / '),
    notes: bundleSummary(b),
    history: old?.history || [],
    next: old?.next || '',
    properties: allProperties,
    // Planned interests for DISPLAY until the post-save refresh refetches the
    // real persisted rows from `GET /clients` (which is the source of truth).
    propertyInterests: [
      ...(old?.propertyInterests ?? []).filter(
        (row) => !persistedInterests.some((p) => p.propertyId === row.propertyId),
      ),
      ...persistedInterests.map((p) => {
        const linkedRow = linked.find((l) => l.id === p.propertyId);
        return {
          propertyId: p.propertyId,
          name: linkedRow?.reference || p.propertyId,
          area: linkedRow?.area || '',
          price: formatSnapshotPrice(linkedRow?.askingPrice ?? null),
          reason: p.reason ?? '',
          notes: p.notes ?? '',
        };
      }),
    ],
    requestDraft: drafts[0],
    requestBundle: { ...b, requests: sanitized },
  };
}
