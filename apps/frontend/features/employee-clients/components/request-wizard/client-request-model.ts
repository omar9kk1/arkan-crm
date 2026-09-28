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
  linkedProperty: { propertyId: string; reason: string; notes: string };
  message: string;
  requestDetails: null | {
    desiredProperty: ParsedRequestData;
    currentProperty?: ParsedRequestData;
    customFields: CustomField[];
  };
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
export const properties = [
  {
    id: 'K027',
    name: 'بيت المطلاع K027',
    area: 'مدينة المطلاع',
    price: '290,000 د.ك',
    type: 'بيت',
    status: 'متاح للبيع',
  },
  {
    id: 'K0331',
    name: 'دور غرناطة K0331',
    area: 'غرناطة',
    price: '2,000 د.ك / شهر',
    type: 'دور',
    status: 'متاح للإيجار',
  },
];
export function initialRequest(): ClientRequestDraft {
  return {
    name: '',
    phone: '',
    notes: '',
    clientType: 'BUYER',
    interest: { hasLinkedProperty: false, hasNewRequest: false },
    linkedProperty: { propertyId: '', reason: 'استفسار', notes: '' },
    message: '',
    requestDetails: null,
  };
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
    !properties.some((p) => p.id === d.linkedProperty.propertyId)
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
  if (d.interest.hasLinkedProperty)
    lines.push(
      `العقار المرتبط: ${d.linkedProperty.propertyId}`,
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
