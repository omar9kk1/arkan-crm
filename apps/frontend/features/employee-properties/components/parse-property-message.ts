import type {
  ParsedPropertyData,
  PropertyOfferType,
  PropertyRequestDraft,
} from './property-request-model';
const labels: Record<PropertyOfferType, string> = {
  SALE: 'بيع',
  RENT: 'إيجار',
  EXCHANGE: 'بدل',
};
function normalize(text: string) {
  return text
    .replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))
    .replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)))
    .replace(/[أإآ]/g, 'ا')
    .replace(/[\u064B-\u065Fـ]/g, '')
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');
}
const number = '(\\d+(?:,\\d{3})*(?:\\.\\d+)?)';
function part(text: string, operationType: string): ParsedPropertyData {
  const n = normalize(text);
  const areas = [
    'المطلاع',
    'غرناطة',
    'السالمية',
    'الجهراء',
    'جنوب عبدالله المبارك',
  ].filter((a) => n.includes(a));
  const money =
    n.match(new RegExp(number + '\\s*(الف|دينار|د\\s*\\.\\s*ك)')) ||
    n.match(
      new RegExp(
        '(?:السعر|سعر|ايجار|فرق(?:\\s+حدود)?|بحدود)\\s*[:：]?\\s*' +
          number +
          '(?![\\d,])',
      ),
    );
  const price = money
    ? Number(money[1]!.replaceAll(',', '')) * (money[2] === 'الف' ? 1000 : 1)
    : undefined;
  const size = n.match(new RegExp(number + '\\s*(?:متر|م²)'));
  const specs = [
    'زاوية',
    'شارع واحد',
    'شارع رئيسي',
    'قريب من الخدمات',
    'مصعد',
    'سرداب',
    'تشطيب ممتاز',
  ].filter((s) => n.includes(s));
  return {
    governorate: n.includes('محافظة حولي')
      ? 'حولي'
      : n.includes('محافظة الجهراء')
        ? 'الجهراء'
        : n.includes('محافظة العاصمة')
          ? 'العاصمة'
          : n.includes('محافظة الفروانية')
            ? 'الفروانية'
            : '',
    area: areas.join(' أو '),
    propertyType:
      n
        .match(/(?:^|[\s،,])(?:ال|ب)?(بيت|شقة|فيلا|ارض|دور)(?=$|[\s،,.])/)?.[1]
        ?.replace('ارض', 'أرض') || '',
    operationType,
    price: price !== undefined && Number.isFinite(price) ? String(price) : '',
    size: size?.[1]?.replaceAll(',', '') || '',
    roomsOrFloor: (
      n.match(/(?:غرفتين|\d+\s*غرف|دورين|دور\s+(?:اول|ثاني|ثالث|رابع|\d+))/g) ||
      []
    ).join('، '),
    block: n.match(/قطعة\s*(\d+)/)?.[1] || '',
    street: n.match(/شارع\s*(\d+|واحد|رئيسي)/)?.[1] || '',
    frontage: n.includes('زاوية') ? 'زاوية' : '',
    duration: n.match(/(?:مدة|لمدة)\s+([^،.]+)/)?.[1] || '',
    description: specs.join('، '),
    notes: '',
  };
}
/** Local keyword extraction only; unknown fields stay empty. No I/O. */
export function parsePropertyMessage(
  message: string,
  selectedType?: PropertyOfferType,
): {
  offerType: PropertyOfferType | null;
  parsed: NonNullable<PropertyRequestDraft['parsed']>;
} {
  const text = normalize(message);
  const detected: PropertyOfferType[] = [];
  if (/بيع|يبيع/.test(text)) detected.push('SALE');
  if (/ايجار|تاجير|ياجر|يوجر/.test(text)) detected.push('RENT');
  if (/بدل|ابدله|مبادلة/.test(text)) detected.push('EXCHANGE');
  const offerType =
    detected.length === 1
      ? detected[0]!
      : selectedType && detected.includes(selectedType)
        ? selectedType
        : detected.includes('EXCHANGE')
          ? 'EXCHANGE'
          : detected[0] || selectedType || null;
  const operation = offerType ? labels[offerType] : '';
  if (offerType === 'EXCHANGE') {
    // Split at the desired-property phrase, not an initial "أريد أبدل بيتي".
    const marker =
      /(?:وا?ريد|وعاوز|وابي|ابحث عن)\s*(?:ان\s*)?(?:ابدله?|بدله?|مبادلته)?\s*(?:ببيت|بشقة|بفيلا|بارض|عقار|بيت|شقة|فيلا|ارض)/;
    let split = text.search(marker);
    if (split < 0) {
      const match = /(?:ابدله?|بدله?|مبادلته)\s*(ب(?:بيت|شقة|فيلا|ارض))/.exec(
        text,
      );
      if (match) split = match.index + match[0].indexOf(match[1]!);
    }
    return {
      offerType,
      parsed: {
        currentProperty: part(
          split < 0 ? text : text.slice(0, split),
          operation,
        ),
        desiredProperty: part(split < 0 ? '' : text.slice(split), operation),
        customFields: [],
      },
    };
  }
  return {
    offerType,
    parsed: { currentProperty: part(text, operation), customFields: [] },
  };
}
