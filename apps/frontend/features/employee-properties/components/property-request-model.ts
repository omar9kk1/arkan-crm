import {
  floorSummary,
  type RequestFloor,
} from '../../employee-clients/components/request-wizard/client-request-model';
import { parsePropertyMessage } from './parse-property-message';
import { empty, owners, samples, type Property } from '../model';
export type PropertyOfferType = 'SALE' | 'RENT' | 'EXCHANGE';
export type OwnerMode = 'NEW_OWNER' | 'EXISTING_OWNER';
export interface ParsedPropertyData {
  floors?: RequestFloor[];
  governorate: string;
  area: string;
  propertyType: string;
  operationType: string;
  price: string;
  size: string;
  roomsOrFloor: string;
  block: string;
  street: string;
  frontage: string;
  duration: string;
  description: string;
  notes: string;
}
export interface PropertyRequestDraft {
  owner: {
    mode: OwnerMode;
    ownerId: string;
    name: string;
    phone: string;
    notes: string;
  };
  offerType: PropertyOfferType;
  message: string;
  parsed: null | {
    currentProperty: ParsedPropertyData;
    desiredProperty?: ParsedPropertyData;
    customFields: { label: string; value: string }[];
  };
}
export const offerLabels: Record<PropertyOfferType, string> = {
  SALE: 'بيع',
  RENT: 'إيجار',
  EXCHANGE: 'بدل',
};
export const placeholders: Record<PropertyOfferType, string> = {
  SALE: 'مالك يريد بيع بيت في المطلاع، مساحة 400 متر، دورين، شارع واحد، السعر 300 ألف، قريب من الخدمات',
  RENT: 'مالك يريد تأجير شقة في السالمية، غرفتين، دور ثالث، إيجار 450 دينار، تشطيب ممتاز',
  EXCHANGE:
    'عندي بيت في الجهراء 400 متر وأريد أبدله ببيت في المطلاع أو جنوب عبدالله المبارك، فرق حدود 80 ألف',
};
export const ownerOptions = owners.map((owner, index) => ({
  ...owner,
  id: `owner-${index}`,
  count: samples.filter((p) => p.owner === owner.name).length,
  lastFollowUp:
    samples.find((p) => p.owner === owner.name)?.followers[0]?.entries[0]
      ?.date || 'لا توجد متابعة',
}));
export const fieldLabels: Record<
  Exclude<keyof ParsedPropertyData, 'floors'>,
  string
> = {
  governorate: 'المحافظة',
  area: 'المنطقة',
  propertyType: 'نوع العقار',
  operationType: 'نوع العملية',
  price: 'السعر المطلوب',
  size: 'المساحة',
  roomsOrFloor: 'عدد الغرف أو الدور',
  block: 'القطعة',
  street: 'الشارع',
  frontage: 'الواجهة',
  duration: 'مدة الإيجار',
  description: 'الوصف',
  notes: 'ملاحظات',
};
export function analyzeProperty(
  message: string,
  offerType: PropertyOfferType,
): NonNullable<PropertyRequestDraft['parsed']> {
  return parsePropertyMessage(message, offerType).parsed;
}
export function initialPropertyRequest(
  property?: Property,
): PropertyRequestDraft {
  if (property?.requestDraft) return property.requestDraft;
  return {
    owner: {
      mode: 'NEW_OWNER',
      ownerId: '',
      name: property?.owner || '',
      phone: property?.phone || '',
      notes: property?.ownerNotes || '',
    },
    offerType:
      property?.operation === 'إيجار'
        ? 'RENT'
        : property?.operation === 'بدل'
          ? 'EXCHANGE'
          : 'SALE',
    message: property
      ? [
          property.description,
          `المنطقة ${property.region}، السعر ${property.price}، ${property.area} متر، ${property.rooms}، ${property.address}`,
        ].join('\n')
      : '',
    parsed: null,
  };
}
export function changeOffer(
  d: PropertyRequestDraft,
  offerType: PropertyOfferType,
): PropertyRequestDraft {
  return { ...d, offerType, parsed: null };
}
export function validateRequest(d: PropertyRequestDraft, step: number): string {
  if (!d.owner.name.trim() || !d.owner.phone.trim())
    return 'أدخل اسم المالك ورقم الهاتف.';
  if (
    d.owner.mode === 'EXISTING_OWNER' &&
    !ownerOptions.some((o) => o.id === d.owner.ownerId)
  )
    return 'اختر مالكًا موجودًا.';
  if (step >= 2 && !d.parsed) return 'اكتب تفاصيل العقار ثم اضغط تحليل العقار.';
  if (step >= 3 && d.parsed) {
    if (
      [d.parsed.currentProperty, d.parsed.desiredProperty].some((data) =>
        data?.floors?.some(
          (floor) => !floor.name.trim() || !floor.details.trim(),
        ),
      )
    )
      return 'أكمل اسم ومكونات كل دور مضاف، أو احذف الدور غير المطلوب.';
    const current = d.parsed.currentProperty;
    if (!current.area.trim() || !current.propertyType.trim())
      return 'أكمل المنطقة ونوع العقار الحالي.';
    const amounts = [
      current.price,
      current.size,
      d.parsed.desiredProperty?.price,
      d.parsed.desiredProperty?.size,
    ];
    if (
      amounts.some(
        (v) => v?.trim() && (!Number.isFinite(Number(v)) || Number(v) < 0),
      )
    )
      return 'أدخل أرقامًا صحيحة غير سالبة للسعر والمساحة.';
    if (
      d.offerType !== 'EXCHANGE' &&
      (!current.price.trim() || Number(current.price) <= 0)
    )
      return 'أدخل السعر أو الإيجار الشهري أكبر من صفر.';
    if (
      d.offerType === 'EXCHANGE' &&
      (!d.parsed.desiredProperty?.area.trim() ||
        !d.parsed.desiredProperty?.propertyType.trim())
    )
      return 'أكمل المنطقة ونوع العقار المطلوب للبدل.';
    if (d.parsed.customFields.some((f) => !f.label.trim() || !f.value.trim()))
      return 'أكمل اسم وقيمة الخانة الإضافية أو احذفها.';
  }
  return '';
}
export function propertySummary(d: PropertyRequestDraft): string {
  const lines = [
    `المالك: ${d.owner.name}`,
    `الهاتف: ${d.owner.phone}`,
    d.owner.notes,
    `نوع العرض: ${offerLabels[d.offerType]}`,
  ];
  if (d.parsed) {
    for (const [title, data] of [
      [
        d.offerType === 'EXCHANGE'
          ? 'بيانات عقار المالك الحالي'
          : `بيانات العقار المعروض ${d.offerType === 'SALE' ? 'للبيع' : 'للإيجار'}`,
        d.parsed.currentProperty,
      ],
      ['بيانات العقار المطلوب للبدل', d.parsed.desiredProperty],
    ] as const) {
      if (data)
        lines.push(
          title,
          ...Object.entries(data)
            .filter(
              ([k, v]) =>
                k !== 'floors' &&
                (k !== 'roomsOrFloor' || !data.floors?.length) &&
                v,
            )
            .map(
              ([k, v]) =>
                `${k === 'price' ? (title.includes('المطلوب للبدل') ? 'فرق البدل المتوقع' : d.offerType === 'RENT' ? 'الإيجار الشهري' : d.offerType === 'EXCHANGE' ? 'السعر التقريبي' : 'السعر المطلوب') : fieldLabels[k as keyof typeof fieldLabels]}: ${v}`,
            ),
          ...(data.floors?.length
            ? ['تفاصيل الأدوار:', floorSummary(data.floors)]
            : []),
        );
    }
    lines.push(...d.parsed.customFields.map((f) => `${f.label}: ${f.value}`));
  }
  return lines.filter(Boolean).join('\n');
}
export function toProperty(
  d: PropertyRequestDraft,
  manager: boolean,
  previous?: Property,
): Property {
  if (!d.parsed) throw new Error('Analyze the property before saving.');
  const p = d.parsed.currentProperty;
  const id =
    previous?.id ||
    `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    ...(previous || empty),
    id,
    code: previous?.code || `K-${id.slice(-8)}`,
    title: `${p.propertyType} ${p.area}`,
    owner: d.owner.name.trim(),
    phone: d.owner.phone.trim(),
    ownerNotes: d.owner.notes,
    operation: offerLabels[d.offerType],
    region: p.area,
    address: [p.block && `قطعة ${p.block}`, p.street && `شارع ${p.street}`]
      .filter(Boolean)
      .join('، '),
    area: p.size,
    rooms: p.floors?.length ? floorSummary(p.floors) : p.roomsOrFloor,
    price: p.price,
    description: propertySummary(d),
    status: manager ? 'معتمد' : 'بانتظار الموافقة',
    mine: true,
    requestDraft: d,
  };
}
