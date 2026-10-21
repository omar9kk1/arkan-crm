'use client';
import type { Property } from '../model';
import type { ContactMode, ContactType } from '../../../lib/contact-registry';
import { keepsExistingContact } from '../../../lib/property-adapter';

export type EntryMethod = 'SMART_PASTE' | 'MANUAL';
export type ListingOperation = 'بيع' | 'إيجار' | 'بدل';

export interface PropertyImage {
  file: File;
  preview: string;
}

/**
 * The images a property ALREADY has in the program.
 *
 * They live on the property row (the API exposes the authorized image through
 * `primaryImageUrl`), never in the wizard's draft: the wizard form only holds
 * a file the employee picked on this device. An edit therefore keeps the
 * stored image, and the wizard shows it instead of pretending it is missing.
 */
export function storedPropertyImages(
  property?: { id?: string; primaryImageUrl?: string | null } | null,
): string[] {
  if (!property?.id || !property.primaryImageUrl) return [];
  return [property.primaryImageUrl];
}

/**
 * The image the wizard surfaces show: a chosen replacement first, otherwise
 * the image the property already stores.
 *
 * Both steps of the wizard use it, so they can never disagree about whether
 * the property HAS an image — the saved image is a real image and satisfies the
 * mandatory-image rule, exactly like a freshly picked file.
 */
export function effectiveImageUrl(input: {
  localPreview?: string | null;
  storedUrl?: string | null;
}): string | null {
  return input.localPreview || input.storedUrl || null;
}

/**
 * The mandatory-image rule of the wizard.
 *
 * A stored image of the property being edited satisfies it — the employee is
 * NOT asked to upload the same picture again — and a freshly picked file
 * satisfies it for a new property. Only a property that has no image at all
 * (a genuinely new one) is blocked.
 */
export function satisfiesImageRequirement(input: {
  newImage: unknown | null;
  storedImages: readonly string[];
  editingExisting: boolean;
}): boolean {
  return (
    Boolean(input.newImage) ||
    input.storedImages.length > 0 ||
    input.editingExisting
  );
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

/**
 * The linked contact of the property being edited, resolved against the current
 * form: `undefined` when the row has no authorized linked contact, the contact
 * id while the form still targets it (or the user re-selects it), and `null`
 * once the user explicitly switches to entering a new person.
 */
export function linkedContactSelection(
  property: Property | undefined,
  form: NewPropertyFormV2,
): string | null | undefined {
  const linked = property?.linkedContactId;
  if (!linked) return undefined;
  if (form.contactType === 'BROKER') {
    return form.brokerMode === 'EXISTING' && form.brokerId === linked
      ? linked
      : null;
  }
  return form.ownerMode === 'EXISTING' && form.ownerId === linked
    ? linked
    : null;
}

/**
 * Seeds the contact step of the edit draft from the row's LINKED contact.
 *
 * The structured description carries no contact data, so the stored
 * owner/broker values are restored separately — and when the authorized
 * response also carried the linked `Contact.id`, the draft opens on EXISTING
 * targeting that exact record. This is what stops an untouched edit/resubmit
 * from sending `newContact` and creating a duplicate person on every save.
 *
 * Returns the form untouched when there is no authorized linked contact: the
 * wizard then keeps its explicit NEW flow and never invents a selection.
 */
export function applyLinkedContact(
  form: NewPropertyFormV2,
  property: Property | undefined,
): NewPropertyFormV2 {
  const linked = property?.linkedContactId;
  if (!linked) return form;
  const isBroker = form.contactType === 'BROKER';
  return isBroker
    ? {
        ...form,
        brokerMode: 'EXISTING',
        brokerId: linked,
      }
    : {
        ...form,
        ownerMode: 'EXISTING',
        ownerId: linked,
      };
}

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
    linkedContactId: keepsExistingContact(form, {
      contactId: previous?.linkedContactId ?? null,
    })
      ? (previous?.linkedContactId ?? null)
      : null,
  };
}

// A deliberately cleared unified area must not resurrect a legacy value.
export function propertyAreaV2(form: Partial<NewPropertyFormV2>): string {
  return form.area ?? (form.landArea || form.unitArea || '');
}
