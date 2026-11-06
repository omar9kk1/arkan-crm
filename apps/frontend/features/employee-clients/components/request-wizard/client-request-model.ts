import type { DealType } from '../../../../lib/api/property-types';
import type { ClientRequestBundle } from './client-request-bundle';

export type ClientType = 'BUYER' | 'RENTER' | 'EXCHANGER';
export interface RequestFloor {
  name: string;
  portion: 'FULL' | 'HALF' | 'QUARTER';
  details: string;
}
export function floorSummary(floors: RequestFloor[]): string {
  const portions = { FULL: 'دور كامل', HALF: 'نصف دور', QUARTER: 'ربع دور' };
  return floors
    .map(
      (floor) =>
        `${floor.name}${floor.portion !== 'FULL' ? ` (${portions[floor.portion]})` : ''}: ${floor.details}`,
    )
    .join('\n');
}
export interface ParsedRequestData {
  floors?: RequestFloor[];
  governorate: string;
  area: string;
  propertyType: string;
  operationType: string;
  budget: string;
  budgetTo?: string;
  size: string;
  roomsOrFloor: string;
  duration: string;
  specifications: string;
  notes: string;
}
export interface CustomField {
  label: string;
  value: string;
}
export interface ClientRequestDraft {
  name: string;
  phone: string;
  notes: string;
  clientType: ClientType;
  interest: { hasLinkedProperty: boolean; hasNewRequest: boolean };
  linkedProperty: LinkedPropertyDraft;
  message: string;
  requestDetails: null | {
    desiredProperty: ParsedRequestData;
    currentProperty?: ParsedRequestData;
    customFields: CustomField[];
  };
}

/**
 * Public summary of the REAL selected property, kept next to the raw
 * `Property.id` so the wizard can display and preserve the selection across
 * steps without re-fetching. Only public listing fields travel here — never any
 * owner/broker contact detail. The id is the backend's immutable `Property.id`;
 * display codes are not used for the selection itself.
 */
export interface LinkedPropertySnapshot {
  id: string;
  reference: string;
  area: string;
  listingType: DealType;
  askingPrice: string | null;
}

export interface LinkedPropertyDraft {
  /** Immutable backend `Property.id` of the selected row (never a code). */
  propertyId: string;
  /** Snapshot of the same row at selection time; null when nothing selected. */
  property: LinkedPropertySnapshot | null;
  reason: string;
  notes: string;
}
export const clientLabels: Record<ClientType, string> = {
  BUYER: 'مشتري',
  RENTER: 'مستأجر',
  EXCHANGER: 'مبدل عقار',
};
export const placeholders: Record<ClientType, string> = {
  BUYER:
    'عميل يبحث عن بيت في المطلاع، ميزانية 300 ألف، دورين، 400 متر، يفضل زاوية',
  RENTER:
    'عميل يريد إيجار شقة في السالمية، غرفتين، بحدود 450 دينار، قريب من الخدمات',
  EXCHANGER:
    'عندي بيت في الجهراء 400 متر وأريد أبدله ببيت في المطلاع أو جنوب عبدالله المبارك، فرق حدود 80 ألف',
};
/** Arabic operation label per backend `DealType`, shown in search results. */
export const propertyOperationLabel: Record<DealType, string> = {
  SALE: 'بيع',
  RENT: 'إيجار',
  EXCHANGE: 'بدل',
};

/** Price text in the established Astra format; null stays «غير محدد». */
export function formatSnapshotPrice(askingPrice: string | null): string {
  if (!askingPrice) return 'غير محدد';
  const value = Number(askingPrice);
  if (Number.isNaN(value)) return askingPrice;
  return `${Math.round(value).toLocaleString('ar-KW')} د.ك`;
}

/**
 * One compact public line for the search dropdown: code · area · operation ·
 * price. Built ONLY from public listing fields (reference/district/governorate/
 * listingType/askingPrice) — a private contact can never appear in an option.
 */
export function propertySearchOptionLabel(row: {
  reference: string;
  district: string | null;
  governorate: string | null;
  listingType: DealType;
  askingPrice: string | null;
}): string {
  const area = row.district ?? row.governorate ?? 'غير محدد';
  const operation = propertyOperationLabel[row.listingType];
  return `${row.reference} · ${area} · ${operation} · ${formatSnapshotPrice(row.askingPrice)}`;
}

/** The selected-property reminder shown under the search field. */
export function linkedPropertyPreview(
  snapshot: LinkedPropertySnapshot | null | undefined,
): string {
  if (!snapshot) return '';
  const operation = propertyOperationLabel[snapshot.listingType];
  return `${snapshot.reference} · ${snapshot.area} · ${operation} · ${formatSnapshotPrice(snapshot.askingPrice)}`;
}

/**
 * Self-heals drafts saved before the real search existed (or corrupt ones):
 * the id only stays when it matches the snapshot of the same real row.
 */
export function normalizeLinkedProperty(
  linked: LinkedPropertyDraft,
): LinkedPropertyDraft {
  if (!linked.propertyId || linked.property?.id !== linked.propertyId)
    return { ...linked, propertyId: '', property: null };
  return linked;
}

export function initialRequest(): ClientRequestDraft {
  return {
    name: '',
    phone: '',
    notes: '',
    clientType: 'BUYER',
    interest: { hasLinkedProperty: false, hasNewRequest: false },
    linkedProperty: {
      propertyId: '',
      property: null,
      reason: 'استفسار',
      notes: '',
    },
    message: '',
    requestDetails: null,
  };
}

/**
 * The decoded reading of `Client.requestData` — the wizard bundle the backend
 * stores for an existing client (the pack lives only in this directory, and
 * the backend keeps the string opaquely). ANY legacy, null or unparsable
 * value reads as "no structured request recorded yet" — a prefill is never
 * invented: the identity comes from the client columns, the request types and
 * details start EMPTY.
 */
export function parseStoredRequestData(
  raw: string | null | undefined,
): Pick<ClientRequestBundle, 'types' | 'requests'> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return null;
    const doc = parsed as Partial<ClientRequestBundle> & { version?: number };
    if (doc.version !== 1) return null;
    const types = Array.isArray(doc.types)
      ? (doc.types.filter(
          (type): type is ClientType =>
            type === 'BUYER' || type === 'RENTER' || type === 'EXCHANGER',
        ) as ClientType[])
      : [];
    if (!types.length) return null;
    const storedRequests = (doc.requests ?? {}) as Record<
      string,
      ClientRequestDraft | undefined
    >;
    const requests: Record<ClientType, ClientRequestDraft> = {
      BUYER: { ...initialRequest(), clientType: 'BUYER' },
      RENTER: { ...initialRequest(), clientType: 'RENTER' },
      EXCHANGER: { ...initialRequest(), clientType: 'EXCHANGER' },
    };
    for (const type of types) {
      const stored = storedRequests[type];
      // Defensively overlay the stored draft on a healthy skeleton — a
      // corrupt or partial draft can never break the edit mode open.
      requests[type] = stored
        ? { ...initialRequest(), ...stored, clientType: type }
        : { ...initialRequest(), clientType: type };
    }
    return { types, requests };
  } catch {
    return null;
  }
}

function parsePart(text: string, operationType: string): ParsedRequestData {
  const normalized = text.replace(/[٠-٩]/g, (n) =>
    String('٠١٢٣٤٥٦٧٨٩'.indexOf(n)),
  );
  const areas = [
    'جنوب عبدالله المبارك',
    'المطلاع',
    'الجهراء',
    'السالمية',
    'غرناطة',
  ].filter((a) => normalized.includes(a));
  const amount = normalized.match(
    /(?:ميزانية|بحدود|حدود|فرق|ميزانيته)\s*(\d+(?:\.\d+)?)\s*(ألف|الف)?/,
  );
  return {
    governorate: areas.includes('السالمية')
      ? 'حولي'
      : areas.some((a) => ['الجهراء', 'المطلاع'].includes(a))
        ? 'الجهراء'
        : '',
    area: areas.join(' أو '),
    propertyType:
      ['شقة', 'بيت', 'دور', 'أرض'].find((t) => normalized.includes(t)) || '',
    operationType,
    budget: amount ? String(Number(amount[1]) * (amount[2] ? 1000 : 1)) : '',
    size: normalized.match(/(\d+)\s*(?:متر|م²)/)?.[1] || '',
    roomsOrFloor:
      normalized.match(/(?:\d+\s*غرف|غرفتين|دورين|\d+\s*أدوار)/)?.[0] || '',
    duration: '',
    specifications: ['زاوية', 'قريب من الخدمات', 'مصعد', 'قريب من مدرسة']
      .filter((t) => normalized.includes(t))
      .join('، '),
    notes: text.trim(),
  };
}
export function parseRequest(
  message: string,
  type: ClientType,
): NonNullable<ClientRequestDraft['requestDetails']> {
  if (type === 'EXCHANGER') {
    const split = message.search(/(?:وأريد|و أريد|أريد|عاوز|وأبي|وابي)/);
    const current = split >= 0 ? message.slice(0, split) : message;
    const desired = split >= 0 ? message.slice(split) : '';
    return {
      currentProperty: parsePart(current, 'بدل'),
      desiredProperty: parsePart(desired, 'بدل'),
      customFields: [],
    };
  }
  return {
    desiredProperty: parsePart(message, type === 'BUYER' ? 'شراء' : 'إيجار'),
    customFields: [],
  };
}
export function changeClientType(
  draft: ClientRequestDraft,
  clientType: ClientType,
): ClientRequestDraft {
  return { ...draft, clientType, requestDetails: null };
}
export function requestError(d: ClientRequestDraft, step: number): string {
  if (step >= 2 && d.interest.hasNewRequest && d.requestDetails) {
    for (const data of [
      d.requestDetails.currentProperty,
      d.requestDetails.desiredProperty,
    ]) {
      if (!data) continue;
      const values = [data.budget, data.budgetTo || ''];
      if (
        values.some(
          (value) =>
            value.trim() &&
            (!Number.isFinite(Number(value)) || Number(value) < 0),
        )
      )
        return 'أدخل ميزانية صحيحة غير سالبة.';
      if (
        values.every((value) => value.trim()) &&
        Number(data.budgetTo) < Number(data.budget)
      )
        return 'الميزانية «إلى» يجب ألا تقل عن «من».';
    }
  }
  if (!d.name.trim() || !d.phone.trim()) return 'أدخل اسم العميل ورقم الهاتف.';
  if (step === 0) return '';
  if (!d.interest.hasLinkedProperty && !d.interest.hasNewRequest)
    return 'اختر مصدر اهتمام واحدًا على الأقل.';
  if (
    d.interest.hasLinkedProperty &&
    normalizeLinkedProperty(d.linkedProperty).propertyId === ''
  )
    return 'اختر العقار المرتبط.';
  if (d.interest.hasNewRequest && !d.requestDetails)
    return 'اكتب تفاصيل الطلب ثم اضغط تحليل الطلب.';
  if (
    step >= 2 &&
    d.interest.hasNewRequest &&
    d.requestDetails &&
    [d.requestDetails.currentProperty, d.requestDetails.desiredProperty].some(
      (data) =>
        data?.floors?.some(
          (floor) => !floor.name.trim() || !floor.details.trim(),
        ),
    )
  )
    return 'أكمل اسم ومكونات كل دور مضاف، أو احذف الدور غير المطلوب.';
  if (
    step >= 2 &&
    d.interest.hasNewRequest &&
    d.requestDetails?.customFields.some(
      (f) => !f.label.trim() || !f.value.trim(),
    )
  )
    return 'أكمل اسم وقيمة الخانة الإضافية أو احذفها.';
  return '';
}
export function requestSummary(d: ClientRequestDraft): string {
  const lines = [`نوع العميل: ${clientLabels[d.clientType]}`, d.notes];
  const linked = normalizeLinkedProperty(d.linkedProperty);
  if (d.interest.hasLinkedProperty)
    lines.push(
      `العقار المرتبط: ${linked.property?.reference || linked.propertyId}`,
      linked.property ? `منطقة العقار: ${linked.property.area}` : '',
      `سبب الاهتمام: ${d.linkedProperty.reason}`,
      d.linkedProperty.notes,
    );
  if (d.interest.hasNewRequest && d.requestDetails) {
    lines.push(`الرسالة الأصلية: ${d.message}`);
    for (const [title, data] of [
      ['عقار العميل الحالي', d.requestDetails.currentProperty],
      ['العقار المطلوب', d.requestDetails.desiredProperty],
    ] as const) {
      if (data)
        lines.push(
          title,
          ...Object.entries(data)
            .filter(([k, v]) => k !== 'floors' && v)
            .map(
              ([k, v]) => `${k === 'budget' ? (data === d.requestDetails?.desiredProperty ? 'الميزانية من' : 'السعر التقريبي') : fieldLabels[k as keyof typeof fieldLabels]}: ${v}`,
            ),
          ...(data.floors?.length
            ? ['تفاصيل الأدوار:', floorSummary(data.floors)]
            : []),
        );
    }
    lines.push(
      ...d.requestDetails.customFields.map((f) => `${f.label}: ${f.value}`),
    );
  }
  return lines.filter(Boolean).join('\n');
}
export const fieldLabels: Record<
  Exclude<keyof ParsedRequestData, 'floors'>,
  string
> = {
  governorate: 'المحافظة',
  area: 'المنطقة',
  propertyType: 'نوع العقار',
  operationType: 'نوع العملية',
  budget: 'الميزانية',
  budgetTo: 'الميزانية إلى',
  size: 'المساحة',
  roomsOrFloor: 'عدد الغرف أو الدور',
  duration: 'مدة الإيجار',
  specifications: 'مواصفات إضافية',
  notes: 'ملاحظات الطلب',
};
