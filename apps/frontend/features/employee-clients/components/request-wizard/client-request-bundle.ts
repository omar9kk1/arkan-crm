import {
  initialRequest,
  clientLabels,
  requestError,
  requestSummary,
  properties,
  type ClientRequestDraft,
  type ClientType,
} from './client-request-model';
import type { EmployeeClient } from '../../client-model';
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
export function typeDraft(
  b: ClientRequestBundle,
  type: ClientType,
): ClientRequestDraft {
  return {
    ...(b.requests[type] || initialRequest()),
    clientType: type,
    name: b.name,
    phone: b.phone,
    notes: '',
  };
}
export function bundleError(
  b: ClientRequestBundle,
  step: number,
  clients: readonly EmployeeClient[],
): string {
  if (b.mode === 'EXISTING_CLIENT' && !clients.some((c) => c.id === b.clientId))
    return 'اختر عميلًا موجودًا.';
  if (!b.name.trim() || !b.phone.trim()) return 'أدخل اسم العميل ورقم الهاتف.';
  if (step >= 1 && !b.types.length)
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
export function saveBundle(
  b: ClientRequestBundle,
  clients: readonly EmployeeClient[],
): EmployeeClient {
  const old =
    b.mode === 'EXISTING_CLIENT'
      ? clients.find((c) => c.id === b.clientId)
      : undefined;
  const drafts = b.types.map((type) => typeDraft(b, type));
  const linked = drafts.flatMap((d) =>
    d.interest.hasLinkedProperty
      ? properties.filter((p) => p.id === d.linkedProperty.propertyId)
      : [],
  );
  const allProperties = [...(old?.properties || []), ...linked].filter(
    (p, i, list) => list.findIndex((v) => v.name === p.name) === i,
  );
  const operations = { BUYER: 'شراء', RENTER: 'إيجار', EXCHANGER: 'بدل' };
  const sanitized: ClientRequestBundle['requests'] = {};
  for (const d of drafts)
    sanitized[d.clientType] = {
      ...d,
      message: d.interest.hasNewRequest ? d.message : '',
      requestDetails: d.interest.hasNewRequest ? d.requestDetails : null,
      linkedProperty: d.interest.hasLinkedProperty
        ? d.linkedProperty
        : { propertyId: '', reason: '', notes: '' },
    };
  const areas = drafts
    .map((d) =>
      d.interest.hasNewRequest
        ? d.requestDetails?.desiredProperty.area
        : properties.find((p) => p.id === d.linkedProperty.propertyId)?.area,
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
    area: areas.join(' / ') || 'غير محدد',
    budget: drafts
      .map(
        (d) =>
          `${clientLabels[d.clientType]}: ${d.interest.hasNewRequest ? [d.requestDetails?.desiredProperty.budget && `من ${d.requestDetails.desiredProperty.budget}`, d.requestDetails?.desiredProperty.budgetTo && `إلى ${d.requestDetails.desiredProperty.budgetTo}`].filter(Boolean).join(' ') || 'غير محدد' : properties.find((p) => p.id === d.linkedProperty.propertyId)?.price || 'غير محدد'}`,
      )
      .join(' / '),
    notes: bundleSummary(b),
    history: old?.history || [],
    next: old?.next || '',
    properties: allProperties,
    requestDraft: drafts[0],
    requestBundle: { ...b, requests: sanitized },
  };
}
