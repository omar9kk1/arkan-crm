import { Role, type AuthUser } from '@arkan/shared';
import type {
  ApprovalStatusApi,
  ContactSummaryDto,
  CreatePropertyPayload,
  DealType,
  FloorTypeApi,
  NewContactPayload,
  PropertyFloorDto,
  PropertyFloorPayload,
  PropertyStatusApi,
  PropertyViewDto,
  PrivatePropertyDto,
  RequestedPropertyPayload,
  ResponsibleRoleApi,
  UpdatePropertyPayload,
} from './api/property-types';
import { hasPrivateContact, isPrivatePropertyDto } from './api/property-types';
import type { Property } from '../features/employee-properties/model';
import type { PreviewProperty } from '../features/manager-properties/preview-data';
import { mapPropertyDetails } from './property-details';

/**
 * Pure, side-effect-free mapping between the three-step wizard's form state,
 * the backend's JSON contract, and the two existing display models.
 *
 * Nothing here talks to the network or to React, so it can be exercised
 * directly by the API tests. The wizard keeps its exact shape; only the
 * handler layer changes.
 */

/** Wizard step labels → backend `FloorType` records. */
export const FLOOR_TYPE_BY_LABEL: Record<string, FloorTypeApi> = {
  'الأرضي': 'GROUND',
  'الأول': 'FIRST',
  'الثاني': 'SECOND',
  'الثالث': 'THIRD',
  'الرابع': 'FOURTH',
  'الخامس': 'FIFTH',
  'السادس': 'SIXTH',
  'السابع': 'SEVENTH',
  'السطح': 'ROOF',
  'القبو': 'BASEMENT',
  'الميزانين': 'MEZZANINE',
  'أخرى': 'CUSTOM',
};

/** Inverse label map used to render floors back in the approved wording. */
export const FLOOR_LABEL_BY_TYPE: Record<FloorTypeApi, string> = {
  GROUND: 'الأرضي',
  FIRST: 'الأول',
  SECOND: 'الثاني',
  THIRD: 'الثالث',
  FOURTH: 'الرابع',
  FIFTH: 'الخامس',
  SIXTH: 'السادس',
  SEVENTH: 'السابع',
  ROOF: 'السطح',
  // Approved wording for the property details and the floor summaries; the
  // wizard's own selector keeps its «القبو» option, which maps to this type.
  BASEMENT: 'السرداب',
  MEZZANINE: 'الميزانين',
  HALF: 'نصف دور',
  QUARTER: 'ربع دور',
  CUSTOM: 'أخرى',
};

export const OPERATION_BY_DEAL: Record<DealType, string> = {
  SALE: 'بيع',
  RENT: 'إيجار',
  EXCHANGE: 'بدل',
};

export const DEAL_BY_OPERATION: Record<string, DealType> = {
  'بيع': 'SALE',
  'إيجار': 'RENT',
  'بدل': 'EXCHANGE',
};

/** Backend status → the wording already used by the approved cards/badges. */
export const STATUS_LABEL: Record<PropertyStatusApi, string> = {
  PENDING: 'بانتظار الموافقة',
  AVAILABLE: 'معتمد',
  REJECTED: 'مرفوض',
  SOLD: 'تم البيع',
  RENTED: 'تم التأجير',
  ARCHIVED: 'مؤرشف',
};

/** Wording for a PENDING row whose manager asked for corrections. */
export const CHANGES_REQUESTED_LABEL = 'مطلوب تعديل';

/** Latest review state of an authorized (private) response, or null. */
export function reviewStatusOf(
  dto: PropertyViewDto,
): ApprovalStatusApi | null {
  return isPrivatePropertyDto(dto) ? (dto.reviewStatus ?? null) : null;
}

/**
 * THE single status-display helper — used by every property card pill, details
 * drawer header and review surface. Priority, highest first:
 *
 *   1. REJECTED                            → «مرفوض»
 *   2. PENDING + review CHANGES_REQUESTED  → «مطلوب تعديل»
 *   3. PENDING                             → «بانتظار الموافقة»
 *   4. AVAILABLE                           → «معتمد»
 *   (SOLD / RENTED / ARCHIVED keep their wording.)
 *
 * A rejection is therefore never rendered as «مطلوب تعديل»: that wording is
 * reachable only while the row is still PENDING. Rows without the backend enum
 * (local preview rows) fall back to their own stored wording instead of
 * inventing one.
 */
export function statusLabel(property: {
  apiStatus?: PropertyStatusApi | null;
  reviewStatus?: ApprovalStatusApi | null;
  status?: string;
}): string {
  if (property.apiStatus === 'REJECTED') return STATUS_LABEL.REJECTED;
  if (property.apiStatus === 'PENDING')
    return property.reviewStatus === 'CHANGES_REQUESTED'
      ? CHANGES_REQUESTED_LABEL
      : STATUS_LABEL.PENDING;
  if (property.apiStatus) return STATUS_LABEL[property.apiStatus];
  return property.status?.trim() || 'الحالة غير محددة';
}

/**
 * Displayed status of a backend response: a thin DTO wrapper over
 * `statusLabel`. The DTO carries the review state only on an authorized
 * (private) response, which is exactly when CHANGES_REQUESTED can apply.
 */
export function displayStatus(dto: PropertyViewDto): string {
  if ((dto as { deletedAt?: string | null }).deletedAt) {
    return 'محذوف بقرار المدير';
  }
  return statusLabel({
    apiStatus: dto.status,
    reviewStatus: reviewStatusOf(dto),
  });
}

/**
 * After a PATCH, whether an explicit resubmission is required. Correcting alone
 * must never publish a listing: a REJECTED row, or a still-PENDING row whose
 * latest review is CHANGES_REQUESTED, only returns to review via `/resubmit`.
 */
export function needsResubmitAfterCorrection(dto: PropertyViewDto): boolean {
  if (dto.status === 'REJECTED') return true;
  return dto.status === 'PENDING' && reviewStatusOf(dto) === 'CHANGES_REQUESTED';
}

/**
 * Model-level twin of `needsResubmitAfterCorrection` for the display models:
 * true only for a row the employee must correct and resubmit — REJECTED
 * outright, or still PENDING with CHANGES_REQUESTED. Ordinary PENDING and
 * approved rows return false, so a rejection is never mistaken for an open
 * correction request (and vice versa).
 */
export function awaitingCorrection(property: {
  apiStatus?: PropertyStatusApi | null;
  reviewStatus?: ApprovalStatusApi | null;
}): boolean {
  if (property.apiStatus === 'REJECTED') return true;
  return (
    property.apiStatus === 'PENDING' &&
    property.reviewStatus === 'CHANGES_REQUESTED'
  );
}

/**
 * Model-level gate for the details-drawer edit action. True only for a row the
 * viewer created (`Viewer.mine`, which the server derives from
 * `createdByUserId` — never a client value or a name match) that is in a state
 * the backend accepts an edit for: a rejected/needs-correction row, or an
 * approved row (which returns to review on save). `mine` alone is not enough —
 * a manager-visible AVAILABLE row created by another employee stays read-only.
 */
export function editableByViewer(property: {
  apiStatus?: PropertyStatusApi | null;
  reviewStatus?: ApprovalStatusApi | null;
  mine?: boolean;
}): boolean {
  if (property.mine !== true) return false;
  if (awaitingCorrection(property)) return true;
  return property.apiStatus === 'PENDING' || property.apiStatus === 'AVAILABLE';
}

/**
 * Structural view of the wizard form. Declared locally (instead of importing
 * `NewPropertyFormV2`) so this module has no runtime dependency on React or on
 * the registry; the wizard's form object satisfies it structurally at the call
 * site, so a drift in the form is still caught by the type-checker there.
 */
export interface PropertyFormInput {
  entryMethod: string;
  operation: string;
  governorate: string;
  district: string;
  block: string;
  plotNumber: string;
  area: string;
  landArea?: string;
  unitArea?: string;
  floorCount: number;
  floors: readonly {
    label: string;
    customLabel: string;
    details: string;
    hasBasement?: boolean;
    basementDetails?: string;
    hasHalfFloor?: boolean;
    halfFloorDetails?: string;
    hasQuarterFloor?: boolean;
    quarterFloorDetails?: string;
  }[];
  hasBasement?: boolean;
  basementDetails?: string;
  hasHalfFloor?: boolean;
  halfFloorDetails?: string;
  hasQuarterFloor?: boolean;
  quarterFloorDetails?: string;
  price: string;
  negotiable: string;
  requestedProperty: {
    governorate: string;
    district: string;
    block: string;
    plotNumber: string;
    area: string;
    floorRequirements: string;
    notes: string;
    budget: { min: string; max: string };
  };
  contactType: string;
  ownerMode: string;
  brokerMode: string;
  ownerId: string;
  brokerId: string;
  brokerName: string;
  brokerPhone: string;
  ownerName: string;
  contactPhone: string;
}

export interface PropertyFormOptions {
  /** Governorate derived from the district, when the field itself is empty. */
  derivedGovernorate?: string;
}

/** `DECIMAL_STRING_PATTERN` equivalent: non-negative, at most 2 fraction digits. */
export function toDecimalString(value: string | undefined | null): string | undefined {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return undefined;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return undefined;
  if (Number(trimmed) <= 0) return undefined;
  return trimmed;
}

/** Renders an exact stored decimal without the trailing zeros a DB write adds. */
export function formatDecimal(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  return trimmed.includes('.') ? trimmed.replace(/\.?0+$/, '') : trimmed;
}

/** Mirrors `propertyAreaV2` so a legacy draft keeps its area. */
function formArea(form: PropertyFormInput): string {
  return form.area ?? (form.landArea || form.unitArea || '');
}

/**
 * One record per full floor, plus separate BASEMENT/HALF/QUARTER records for
 * the optional-floor flags (they are enum values on the backend, not flags).
 * An enabled optional floor is persisted even when its notes are empty, so the
 * user's selection survives a save/reload and its section still renders in the
 * drawer; a disabled flag is skipped, so notes left behind in the form after
 * unchecking never resurrect a floor the user removed. Notes are never dropped:
 * per-floor extras stay inside that floor's `details`, and a flag whose type
 * already exists merges into that record.
 */
export function mapFloors(
  form: PropertyFormInput,
): PropertyFloorPayload[] | undefined {
  const records: PropertyFloorPayload[] = [];
  form.floors.forEach((floor, index) => {
    const extras: string[] = [];
    if (floor.hasBasement && floor.basementDetails)
      extras.push(`سرداب: ${floor.basementDetails}`);
    if (floor.hasHalfFloor && floor.halfFloorDetails)
      extras.push(`نصف دور: ${floor.halfFloorDetails}`);
    if (floor.hasQuarterFloor && floor.quarterFloorDetails)
      extras.push(`ربع دور: ${floor.quarterFloorDetails}`);
    const details = [floor.details.trim(), ...extras].filter(Boolean).join(' | ');
    const type = FLOOR_TYPE_BY_LABEL[floor.label] ?? 'CUSTOM';
    const record: PropertyFloorPayload = { type, sortOrder: index };
    if (type === 'CUSTOM' && floor.customLabel.trim())
      record.customLabel = floor.customLabel.trim();
    if (details) record.details = details;
    records.push(record);
  });

  const appendFlag = (
    type: FloorTypeApi,
    enabled: boolean | undefined,
    details: string | undefined,
    sortOrder: number,
  ) => {
    const text = (details ?? '').trim();
    const existing = records.find((record) => record.type === type);
    // The flag drives persistence, never the text: an enabled optional floor is
    // kept with or without notes, and a disabled one is only kept when the
    // wizard has an explicit row for that type.
    if (!enabled && !existing) return;
    if (existing) {
      if (text)
        existing.details = existing.details ? `${existing.details} | ${text}` : text;
      return;
    }
    const record: PropertyFloorPayload = { type, sortOrder };
    if (text) record.details = text;
    records.push(record);
  };

  appendFlag('BASEMENT', form.hasBasement, form.basementDetails, form.floors.length);
  appendFlag('HALF', form.hasHalfFloor, form.halfFloorDetails, form.floors.length + 1);
  appendFlag(
    'QUARTER',
    form.hasQuarterFloor,
    form.quarterFloorDetails,
    form.floors.length + 2,
  );

  return records.length ? records : undefined;
}

/** EXCHANGE-only requested property; empty budgets and fields are omitted. */
export function mapRequestedProperty(
  form: PropertyFormInput,
): RequestedPropertyPayload | undefined {
  if (form.operation !== 'بدل') return undefined;
  const requested = form.requestedProperty;
  const payload: RequestedPropertyPayload = {};
  const assign = (key: keyof RequestedPropertyPayload, value: string) => {
    const trimmed = value.trim();
    if (trimmed) payload[key] = trimmed;
  };
  assign('governorate', requested.governorate);
  assign('district', requested.district);
  assign('block', requested.block);
  assign('plotNumber', requested.plotNumber);
  assign('sizeSqm', requested.area);
  assign('floorRequirements', requested.floorRequirements);
  assign('notes', requested.notes);
  assign('budgetMin', requested.budget.min);
  assign('budgetMax', requested.budget.max);
  return Object.keys(payload).length ? payload : undefined;
}

/**
 * Builds the structured description the wizard already stores in
 * `description` so the form can be restored when editing. It is an explicit
 * allowlist that never contains the owner/broker name or phone, so the raw
 * WhatsApp paste is never submitted as a public description and the backend's
 * private-contact check passes.
 */
export function buildDescription(form: PropertyFormInput): string {
  const publicDescriptionFields = {
    entryMethod: form.entryMethod,
    operation: form.operation,
    governorate: form.governorate,
    district: form.district,
    block: form.block,
    plotNumber: form.plotNumber,
    area: form.area,
    landArea: form.landArea,
    unitArea: form.unitArea,
    hasBasement: form.hasBasement,
    basementDetails: form.basementDetails,
    hasHalfFloor: form.hasHalfFloor,
    halfFloorDetails: form.halfFloorDetails,
    hasQuarterFloor: form.hasQuarterFloor,
    quarterFloorDetails: form.quarterFloorDetails,
    floorCount: form.floorCount,
    floors: form.floors.map((floor) => ({
      label: floor.label,
      customLabel: floor.customLabel,
      details: floor.details,
      hasBasement: floor.hasBasement,
      basementDetails: floor.basementDetails,
      hasHalfFloor: floor.hasHalfFloor,
      halfFloorDetails: floor.halfFloorDetails,
      hasQuarterFloor: floor.hasQuarterFloor,
      quarterFloorDetails: floor.quarterFloorDetails,
    })),
    price: form.price,
    negotiable: form.negotiable,
    requestedProperty: form.requestedProperty,
    contactType: form.contactType,
  };
  let description = JSON.stringify(publicDescriptionFields, null, 2);
  if (form.operation === 'بدل') {
    const requested = form.requestedProperty;
    description += `\n\n=== العقار المطلوب في البدل ===
المحافظة: ${requested.governorate || '—'}
المنطقة: ${requested.district || '—'}
القطعة: ${requested.block || '—'}
القسيمة: ${requested.plotNumber || '—'}
المساحة: ${requested.area || '—'} م²
متطلبات الأدوار: ${requested.floorRequirements || '—'}
ملاحظات: ${requested.notes || '—'}
الميزانية: من ${requested.budget.min || '—'} إلى ${requested.budget.max || '—'} د.ك`;
  }
  return description;
}

/** Maximum the backend accepts for `description`; enforced before submitting. */
export const MAX_DESCRIPTION_LENGTH = 4000;

/**
 * The contact already linked to the row being edited, when the authorized
 * response carried it. `contactId` is authoritative: it is present exactly when
 * the backend decided this viewer may read that contact (manager, or the
 * creator who owns it). An empty id means "no linked contact" and must keep the
 * wizard on its explicit NEW flow — the draft is never silently switched to an
 * existing contact we did not actually receive.
 */
export function existingContactSelection(payload: {
  contactId: string | null;
  contact: ContactSummaryDto | null;
}): Pick<
  PropertyFormInput,
  'contactType' | 'ownerMode' | 'brokerMode' | 'ownerId' | 'brokerId' | 'ownerName' | 'brokerName' | 'contactPhone' | 'brokerPhone'
> | null {
  if (!payload.contactId) return null;
  const contact = payload.contact;
  const name = contact?.name ?? '';
  const phone = contact?.phone ?? '';
  return contact?.type === 'BROKER'
    ? {
        contactType: 'BROKER',
        brokerMode: 'EXISTING',
        brokerId: payload.contactId,
        brokerName: name,
        brokerPhone: phone,
        ownerMode: 'NEW',
        ownerId: '',
        ownerName: '',
        contactPhone: '',
      }
    : {
        contactType: 'OWNER',
        ownerMode: 'EXISTING',
        ownerId: payload.contactId,
        ownerName: name,
        contactPhone: phone,
        brokerMode: 'NEW',
        brokerId: '',
        brokerName: '',
        brokerPhone: '',
      };
}

/** True while the wizard still targets the contact the row was loaded with. */
export function keepsExistingContact(
  form: PropertyFormInput,
  payload: { contactId: string | null },
): boolean {
  if (!payload.contactId) return false;
  const id = (form.contactType === 'BROKER' ? form.brokerId : form.ownerId).trim();
  return !!id && id === payload.contactId;
}

function sharedPayload(
  form: PropertyFormInput,
  options: PropertyFormOptions,
): Omit<CreatePropertyPayload, 'contactId' | 'newContact' | 'version'> {
  const listingType = DEAL_BY_OPERATION[form.operation] ?? 'SALE';
  const payload: Omit<
    CreatePropertyPayload,
    'contactId' | 'newContact' | 'version'
  > = { listingType };

  const governorate =
    form.governorate.trim() || (options.derivedGovernorate ?? '').trim();
  if (governorate) payload.governorate = governorate;
  const district = form.district.trim();
  if (district) payload.district = district;
  const block = form.block.trim();
  if (block) payload.block = block;
  const plotNumber = form.plotNumber.trim();
  if (plotNumber) payload.plotNumber = plotNumber;

  const sizeSqm = toDecimalString(formArea(form));
  if (sizeSqm) payload.sizeSqm = sizeSqm;

  const floors = mapFloors(form);
  if (floors) {
    payload.floors = floors;
    payload.floorCount = form.floors.length;
  }

  const askingPrice = toDecimalString(form.price);
  if (askingPrice) payload.askingPrice = askingPrice;

  if (form.negotiable === 'قابل للتفاوض') payload.negotiable = true;
  else if (form.negotiable === 'غير قابل للتفاوض') payload.negotiable = false;

  payload.description = buildDescription(form);

  const requestedProperty = mapRequestedProperty(form);
  if (requestedProperty) payload.requestedProperty = requestedProperty;

  return payload;
}

/** The existing (already registered) contact, chosen in wizard step 3. */
function selectedContactId(form: PropertyFormInput): string | undefined {
  const existing =
    form.contactType === 'BROKER' ? form.brokerMode === 'EXISTING' : form.ownerMode === 'EXISTING';
  if (!existing) return undefined;
  const id = (form.contactType === 'BROKER' ? form.brokerId : form.ownerId).trim();
  return id || undefined;
}

function newContactFrom(form: PropertyFormInput): NewContactPayload | undefined {
  const isBroker = form.contactType === 'BROKER';
  if (selectedContactId(form)) return undefined;
  const name = (isBroker ? form.brokerName : form.ownerName).trim();
  const phone = (isBroker ? form.brokerPhone : form.contactPhone).trim();
  if (!name || !phone) return undefined;
  return {
    type: isBroker ? 'BROKER' : 'OWNER',
    name,
    phone,
  };
}

/**
 * `contactId` and `newContact` are mutually exclusive: the backend rejects a
 * body carrying both, so exactly one is emitted.
 */
function resolveContact(
  form: PropertyFormInput,
): Pick<CreatePropertyPayload, 'contactId' | 'newContact'> {
  const contactId = selectedContactId(form);
  if (contactId) return { contactId };
  const newContact = newContactFrom(form);
  if (newContact) return { newContact };
  return {};
}

/** Body of the multipart `POST /properties`. */
export function toCreatePropertyPayload(
  form: PropertyFormInput,
  options: PropertyFormOptions = {},
): CreatePropertyPayload {
  return { ...sharedPayload(form, options), ...resolveContact(form) };
}

/**
 * Body of `PATCH /properties/:id`; `version` is mandatory.
 *
 * Unlike creation, an EMPTY field on an edit is an explicit instruction to
 * clear the stored value. The shared builder omits empty values (correct for a
 * fresh row), so the clearable columns are sent as `null` here — otherwise a
 * cleared plot/district/area would be silently kept by the server.
 */
export function toUpdatePropertyPayload(
  form: PropertyFormInput,
  version: number,
  options: PropertyFormOptions = {},
): UpdatePropertyPayload {
  const payload: UpdatePropertyPayload = {
    ...sharedPayload(form, options),
    ...resolveContact(form),
    version,
  };
  // The wire type keeps the create-oriented `string | undefined` fields; the
  // PATCH DTO explicitly accepts null and treats it as "clear this column".
  const clearable = payload as unknown as Record<string, unknown>;
  const governorate =
    form.governorate.trim() || (options.derivedGovernorate ?? '').trim();
  clearable.governorate = governorate || null;
  clearable.district = form.district.trim() || null;
  clearable.block = form.block.trim() || null;
  clearable.plotNumber = form.plotNumber.trim() || null;
  clearable.sizeSqm = toDecimalString(formArea(form)) || null;
  clearable.askingPrice = toDecimalString(form.price) || null;
  return payload;
}

/** Optional floors: additions to a building, never part of its storey count. */
const OPTIONAL_FLOOR_TYPES: readonly FloorTypeApi[] = [
  'BASEMENT',
  'HALF',
  'QUARTER',
];

/**
 * The order the floors are displayed in: the basement first when it was
 * actually selected, then the normal floors in their stored order, then the
 * half floor and the quarter floor. Only the rendered order changes — the
 * persisted `sortOrder` values stay exactly as saved.
 */
export function orderedFloors(floors: PropertyFloorDto[]): PropertyFloorDto[] {
  const rank = (type: FloorTypeApi) =>
    type === 'BASEMENT' ? 0 : type === 'HALF' ? 2 : type === 'QUARTER' ? 3 : 1;
  return [...floors].sort((a, b) => {
    const byRank = rank(a.type) - rank(b.type);
    return byRank || a.sortOrder - b.sortOrder;
  });
}

/**
 * «السرداب + 3 أدوار + نصف دور», built only from the floors persisted for the
 * property, so a floor the user never selected can never show up in it. The
 * number counts normal floors alone — basement, half and quarter are appended
 * as labels instead of being folded into it — and a selected floor with empty
 * notes still counts, because it is a real stored selection.
 */
export function floorSummary(
  floors: PropertyFloorDto[],
  floorCount: number | null | undefined,
): string | null {
  const has = (type: FloorTypeApi) => floors.some((floor) => floor.type === type);
  const normalCount = floors.filter(
    (floor) => !OPTIONAL_FLOOR_TYPES.includes(floor.type),
  ).length;
  // Rows without stored floor records still report their stored floor count.
  const count = floors.length ? normalCount : (floorCount ?? null);

  const optional = OPTIONAL_FLOOR_TYPES.some(has);
  if (!optional) return count == null ? null : String(count);

  const parts: string[] = [];
  if (has('BASEMENT')) parts.push(FLOOR_LABEL_BY_TYPE.BASEMENT);
  if (count) parts.push(`${count} أدوار`);
  if (has('HALF')) parts.push(FLOOR_LABEL_BY_TYPE.HALF);
  if (has('QUARTER')) parts.push(FLOOR_LABEL_BY_TYPE.QUARTER);
  return parts.join(' + ');
}

/** Rooms/levels summary rendered by the cards, in the approved wording. */
function roomsFromFloors(floors: PropertyFloorDto[]): string {
  return orderedFloors(floors)
    .map((floor) => {
      const label = floor.customLabel || FLOOR_LABEL_BY_TYPE[floor.type] || floor.type;
      return floor.details ? `${label}: ${floor.details}` : label;
    })
    .join(' | ');
}

function addressOf(dto: PropertyViewDto): string {
  if (dto.address?.trim()) return dto.address.trim();
  return [
    dto.block && `قطعة ${dto.block}`,
    dto.plotNumber && `حوض ${dto.plotNumber}`,
    dto.district,
  ]
    .filter(Boolean)
    .join('، ');
}

/**
 * Legacy fallback for the "is this row mine?" question. The authoritative answer
 * is now the server-computed `dto.isMine`; this is used only if a response does
 * not carry that flag. It deliberately answers "no" for AVAILABLE rows (the
 * contract never exposed creator identity for them), so it can never wrongly mark
 * another employee's approved property as the viewer's own.
 */
export function deriveMine(
  viewer: AuthUser | null,
  status: PropertyStatusApi,
): boolean {
  if (!viewer || viewer.role !== Role.EMPLOYEE) return false;
  return status === 'PENDING' || status === 'REJECTED';
}

function contactFields(
  dto: PropertyViewDto,
): Pick<
  Property,
  'owner' | 'phone' | 'contactType' | 'hasPrivateContact' | 'linkedContactId'
> {
  const privateDto = isPrivatePropertyDto(dto)
    ? (dto as PrivatePropertyDto)
    : null;
  const official: ContactSummaryDto | null = hasPrivateContact(dto)
    ? (dto as PrivatePropertyDto).contact
    : null;
  // A pending employee submission has no official Contact yet; its provisional
  // owner IS the owner the reviewer must see.
  const provisional = privateDto?.proposedOwner ?? null;
  const contact = official ?? provisional;
  if (!contact)
    return {
      owner: '',
      phone: '',
      contactType: undefined,
      hasPrivateContact: false,
      // The backend only fills `contactId` when this viewer is authorized for
      // that contact; otherwise it is null and the wizard keeps its NEW flow.
      linkedContactId: null,
    };
  return {
    owner: contact.name,
    phone: contact.phone,
    contactType: contact.type,
    hasPrivateContact: true,
    linkedContactId:
      privateDto?.contactId ?? (official ? official.id : null),
  };
}

/**
 * Label of the top-left responsible-person pill on a property card.
 *
 * It is derived ONLY from the server-provided creator fields: «مدير» when a
 * manager created the row, the creator's display name when an employee did,
 * and `''` (→ no pill) when the creator is unknown — never a guessed name or
 * role, and never the owner/broker contact.
 */
export function responsibleLabel(property: {
  responsibleName?: string | null;
  responsibleRole?: ResponsibleRoleApi | null;
}): string {
  if (property.responsibleRole === 'MANAGER') return 'مدير';
  if (property.responsibleRole !== 'EMPLOYEE') return '';
  return (property.responsibleName ?? '').trim();
}

/**
 * `PropertyViewDto` → the existing employee display model.
 *
 * `mine` now comes from the server-computed `isMine` (so an approved property the
 * employee created stays in "My Properties"); `deriveMine` remains only as a
 * defensive fallback for a response that predates the flag.
 */
export function mapPropertyFromApi(
  dto: PropertyViewDto,
  viewer: AuthUser | null,
): Property {
  const contact = contactFields(dto);
  const mine =
    typeof dto.isMine === 'boolean'
      ? dto.isMine
      : deriveMine(viewer, dto.status);
  return {
    ...contact,
    details: mapPropertyDetails(dto),
    id: dto.id,
    code: dto.reference,
    title: dto.title,
    ownerNotes: '',
    operation: OPERATION_BY_DEAL[dto.listingType],
    region: dto.district ?? dto.governorate ?? '',
    address: addressOf(dto),
    area: formatDecimal(dto.sizeSqm),
    rooms: roomsFromFloors(dto.floors),
    price: formatDecimal(dto.askingPrice),
    description: dto.description ?? '',
    status: displayStatus(dto),
    mine,
    assignment: '',
    // Review instructions are shown whenever the authorized response carried
    // them — for a CHANGES_REQUESTED row as well as a rejected one.
    managerNotes: isPrivatePropertyDto(dto) ? (dto.reviewNotes ?? '') : '',
    followers: [],
    apiStatus: dto.status,
    reviewStatus: reviewStatusOf(dto),
    version: dto.version,
    primaryImageUrl: dto.primaryImageUrl,
    responsibleName: dto.responsibleName ?? '',
    responsibleRole: dto.responsibleRole ?? null,
    deletedAt: (dto as { deletedAt?: string | null }).deletedAt ?? null,
    deletionReason:
      (dto as { deletionReason?: string | null }).deletionReason ?? null,
  };
}

/** `PropertyViewDto` → the existing manager display model. */
export function mapPreviewFromApi(
  dto: PropertyViewDto,
  viewer: AuthUser | null,
): PreviewProperty {
  const property = mapPropertyFromApi(dto, viewer);
  return {
    code: property.code,
    details: property.details,
    title: property.title,
    region: property.region,
    price: property.price ? `${property.price} د.ك` : 'غير محدد',
    area: Number(dto.sizeSqm ?? 0),
    rooms: property.rooms,
    status: property.status as PreviewProperty['status'],
    owner: property.owner,
    description: property.description,
    employees: [],
    primaryImageUrl: dto.primaryImageUrl,
    responsibleName: property.responsibleName,
    responsibleRole: property.responsibleRole,
    contactType: property.contactType,
    hasPrivateContact: property.hasPrivateContact,
    apiStatus: dto.status,
    reviewStatus: property.reviewStatus,
    version: dto.version,
    id: dto.id,
    governorate: dto.governorate,
    district: dto.district,
    block: dto.block,
    plotNumber: dto.plotNumber,
    address: dto.address,
    duplicateCandidateIds: (dto as { duplicateCandidateIds?: string[] | null })
      .duplicateCandidateIds,
    deletedAt: (dto as { deletedAt?: string | null }).deletedAt ?? null,
    deletedByName: (dto as { deletedByName?: string | null }).deletedByName ?? null,
    deletionReason: (dto as { deletionReason?: string | null }).deletionReason ?? null,
  };
}
