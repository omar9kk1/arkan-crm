'use client';
import type { Property } from '../model';
import type { ContactMode, ContactType } from '../../../lib/contact-registry';

export type EntryMethod = 'SMART_PASTE' | 'MANUAL';
export type ListingOperation = 'بيع' | 'إيجار' | 'بدل';

export interface PropertyImage {
  file: File;
  preview: string;
}

export interface FloorEntry {
  id: string;
  label: string;
  customLabel: string;
  details: string;
  // New optional additions
  hasBasement?: boolean;
  basementDetails?: string;
  hasHalfFloor?: boolean;
  halfFloorDetails?: string;
  hasQuarterFloor?: boolean;
  quarterFloorDetails?: string;
}

export interface RequestedPropertyBudget {
  min: string;
  max: string;
}

export interface RequestedProperty {
  governorate: string;
  district: string;
  block: string;
  plotNumber: string;
  area: string;
  floorRequirements: string;
  notes: string;
  budget: RequestedPropertyBudget;
}

export interface NewPropertyFormV2 {
  entryMethod: EntryMethod;
  pastedText: string;
  parsedInfo?: string;

  operation: ListingOperation;

  // Offered property fields
  governorate: string;
  district: string;
  block: string;
  plotNumber: string;
  // Single unified area field (replaces landArea/unitArea for UI)
  // Backward compatibility: landArea/unitArea are preserved for existing data
  area: string;
  // Legacy fields for backward compatibility with existing properties/drafts
  landArea?: string;
  unitArea?: string;
  floorCount: number;
  floors: FloorEntry[];
  hasBasement?: boolean;
  basementDetails?: string;
  hasHalfFloor?: boolean;
  halfFloorDetails?: string;
  hasQuarterFloor?: boolean;
  quarterFloorDetails?: string;
  price: string;
  negotiable: 'قابل للتفاوض' | 'غير قابل للتفاوض' | 'غير محدد';

  // Requested property (EXCHANGE only)
  requestedProperty: RequestedProperty;

  // Image
  image: PropertyImage | null;

  // Contact (Step 3)
  contactType: ContactType;
  ownerMode: ContactMode;
  brokerMode: ContactMode;
  ownerId: string;
  brokerId: string;
  brokerName: string;
  brokerPhone: string;
  ownerName: string;
  contactPhone: string;
}

export const initialNewPropertyFormV2: NewPropertyFormV2 = {
  entryMethod: 'SMART_PASTE',
  pastedText: '',
  operation: 'بيع',

  governorate: '',
  district: '',
  block: '',
  plotNumber: '',
  area: '',
  floorCount: 0,
  floors: [],
  hasBasement: false,
  basementDetails: '',
  hasHalfFloor: false,
  halfFloorDetails: '',
  hasQuarterFloor: false,
  quarterFloorDetails: '',
  price: '',
  negotiable: 'غير محدد',

  requestedProperty: {
    governorate: '',
    district: '',
    block: '',
    plotNumber: '',
    area: '',
    floorRequirements: '',
    notes: '',
    budget: { min: '', max: '' },
  },

  image: null,

  contactType: 'OWNER',
  ownerMode: 'NEW',
  brokerMode: 'NEW',
  ownerId: '',
  brokerId: '',
  brokerName: '',
  brokerPhone: '',
  ownerName: '',
  contactPhone: '',
};

export function toPropertyFromNewV2(
  form: NewPropertyFormV2,
  manager: boolean,
  previous?: Property,
  owner?: { ownerUserId?: string; responsibleName?: string },
): Property {
  const id = previous?.id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const isBroker = form.contactType === 'BROKER';
  const contactName = isBroker ? form.brokerName.trim() : form.ownerName.trim();
  const contactPhone = isBroker
    ? form.brokerPhone.trim()
    : form.contactPhone.trim();

  const floorLabels = form.floors.map((f) => f.customLabel || f.label).join('، ');
  const roomDesc = floorLabels || (form.floorCount > 0 ? `${form.floorCount} دور` : '');

  const isExchange = form.operation === 'بدل';
  const requestedInfo = isExchange
    ? `\n\n=== العقار المطلوب في البدل ===
المحافظة: ${form.requestedProperty.governorate || '—'}
المنطقة: ${form.requestedProperty.district || '—'}
القطعة: ${form.requestedProperty.block || '—'}
القسيمة: ${form.requestedProperty.plotNumber || '—'}
المساحة: ${form.requestedProperty.area || '—'} م²
متطلبات الأدوار: ${form.requestedProperty.floorRequirements || '—'}
ملاحظات: ${form.requestedProperty.notes || '—'}
الميزانية: من ${form.requestedProperty.budget.min || '—'} إلى ${form.requestedProperty.budget.max || '—'} د.ك`
    : '';

  // Build floor details with basement/half/quarter info for description
  const floorDetails = form.floors.map((f) => {
    let details = f.details || '';
    const extras: string[] = [];
    if (f.hasBasement && f.basementDetails) extras.push(`سرداب: ${f.basementDetails}`);
    if (f.hasHalfFloor && f.halfFloorDetails) extras.push(`نصف دور: ${f.halfFloorDetails}`);
    if (f.hasQuarterFloor && f.quarterFloorDetails) extras.push(`ربع دور: ${f.quarterFloorDetails}`);
    if (extras.length > 0) details += (details ? ' | ' : '') + extras.join(' | ');
    return { label: f.customLabel || f.label, details };
  });
  const floorDesc = floorDetails.map(f => `${f.label}${f.details ? ': ' + f.details : ''}`).join(' | ');

  // Area compatibility: prefer new unified area, fallback to legacy fields
  const areaValue = propertyAreaV2(form);

  // Allowlist of non-sensitive fields for public description serialization.
  // Private contact info (owner/broker name, phone) is stored separately in
  // property.owner, property.phone, property.ownerUserId, property.contactType.
  const publicDescriptionFields = {
    entryMethod: form.entryMethod,
    operation: form.operation,
    governorate: form.governorate,
    district: form.district,
    block: form.block,
    plotNumber: form.plotNumber,
    area: form.area,
    // Keep historical values even when the unified visible area is edited.
    landArea: form.landArea,
    unitArea: form.unitArea,
    hasBasement: form.hasBasement,
    basementDetails: form.basementDetails,
    hasHalfFloor: form.hasHalfFloor,
    halfFloorDetails: form.halfFloorDetails,
    hasQuarterFloor: form.hasQuarterFloor,
    quarterFloorDetails: form.quarterFloorDetails,
    floorCount: form.floorCount,
    floors: form.floors.map((f) => ({
      label: f.label,
      customLabel: f.customLabel,
      details: f.details,
      hasBasement: f.hasBasement,
      basementDetails: f.basementDetails,
      hasHalfFloor: f.hasHalfFloor,
      halfFloorDetails: f.halfFloorDetails,
      hasQuarterFloor: f.hasQuarterFloor,
      quarterFloorDetails: f.quarterFloorDetails,
    })),
    price: form.price,
    negotiable: form.negotiable,
    requestedProperty: form.requestedProperty,
    // Contact type is stored separately in property.contactType
    contactType: form.contactType,
  };

  return {
    ...(previous || {
      id: '',
      code: '',
      title: '',
      owner: '',
      phone: '',
      ownerNotes: '',
      operation: 'بيع',
      region: '',
      address: '',
      area: '',
      rooms: '',
      price: '',
      description: '',
      status: 'بانتظار الموافقة',
      mine: true,
      assignment: '',
      managerNotes: '',
      followers: [],
    }),
    id,
    code: previous?.code || `K-${id.slice(-8)}`,
    title: `${form.operation} · ${form.district || form.governorate || ''}`.trim() || form.operation,
    owner: contactName || 'غير محدد',
    phone: contactPhone,
    operation: form.operation,
    region: form.district || form.governorate || '',
    address: [form.block && `قطعة ${form.block}`, form.plotNumber && `حوض ${form.plotNumber}`, form.district].filter(Boolean).join('، '),
    area: areaValue,
    rooms: floorDesc || roomDesc,
    price: form.price,
    description: JSON.stringify(publicDescriptionFields, null, 2) + requestedInfo,
    status: manager ? 'معتمد' : 'بانتظار الموافقة',
    mine: true,
    contactType: form.contactType,
    imageUrl: form.image?.preview || previous?.imageUrl || '',
    ownerUserId: owner?.ownerUserId ?? previous?.ownerUserId ?? '',
    responsibleName: owner?.responsibleName || previous?.responsibleName || '',
  };
}

// A deliberately cleared unified area must not resurrect a legacy value.
export function propertyAreaV2(form: Partial<NewPropertyFormV2>): string {
  return form.area ?? (form.landArea || form.unitArea || '');
}
