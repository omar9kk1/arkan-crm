import { Prisma, type DealType, type FloorType } from '@prisma/client';

/**
 * The PUBLIC listing snapshot of a property.
 *
 * It holds only fields the program shows to every employee (price, area,
 * location, listing type, rooms, floors, image count) — never the owner/broker
 * contact, a phone number, an internal note or a review comment.
 */
export interface PropertySnapshot {
  title: string;
  area: string;
  address?: string | null;
  governorate: string | null;
  district: string | null;
  block: string | null;
  street: string | null;
  plotNumber: string | null;
  sizeSqm: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floorCount: number | null;
  askingPrice: string | null;
  currency: string;
  negotiable: boolean | null;
  listingType: DealType;
  description: string | null;
  /**
   * The floors, with their identity (type + custom label) and their details.
   * Older snapshots stored a single signature string instead; those are read
   * as "no per-floor detail available" — never as a fabricated change.
   */
  floors?: PropertyFloorSnapshot[] | string;
  /**
   * The image the property shows (its primary image). A staged replacement
   * counts as the new image of the review round, so the change is reported
   * exactly when the image is really replaced.
   */
  primaryImageId?: string | null;
}

/** One floor of a property, as stored in `PropertyFloor`. */
export interface PropertyFloorSnapshot {
  type: FloorType;
  customLabel: string | null;
  details: string | null;
}

/** The Arabic name of every stored floor type. */
const FLOOR_TYPE_LABELS: Record<FloorType, string> = {
  GROUND: 'الدور الأرضي',
  FIRST: 'الدور الأول',
  SECOND: 'الدور الثاني',
  THIRD: 'الدور الثالث',
  FOURTH: 'الدور الرابع',
  FIFTH: 'الدور الخامس',
  SIXTH: 'الدور السادس',
  SEVENTH: 'الدور السابع',
  ROOF: 'السطح',
  MEZZANINE: 'الميزانين',
  BASEMENT: 'السرداب',
  HALF: 'نصف دور',
  QUARTER: 'ربع دور',
  CUSTOM: 'دور مخصص',
};

/** The identity of a floor: its type plus the label the user gave it. */
function floorKey(floor: PropertyFloorSnapshot): string {
  return `${floor.type}|${floor.customLabel ?? ''}`;
}

/** The display name of a floor (its Arabic type plus a custom label). */
function floorLabel(floor: PropertyFloorSnapshot): string {
  const base = FLOOR_TYPE_LABELS[floor.type] ?? 'دور';
  return floor.customLabel ? `${base} (${floor.customLabel})` : base;
}

/** Harmless formatting differences never count as a change. */
function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** A short old → new pair, or a neutral note for a long text. */
function detailPair(
  before: string | null | undefined,
  after: string | null | undefined,
): string {
  const oldValue = normalizeText(before);
  const newValue = normalizeText(after);
  if (!oldValue && !newValue) return 'تم تغيير التفاصيل';
  if (oldValue.length <= 40 && newValue.length <= 40)
    return `${oldValue || '—'} ← ${newValue || '—'}`;
  return 'تم تغيير التفاصيل';
}

/**
 * The floors that genuinely changed, each with its own identity preserved:
 * a basement stays a basement and a first floor stays a first floor.
 */
export function diffFloors(
  before: PropertyFloorSnapshot[] | string | undefined,
  after: PropertyFloorSnapshot[] | string | undefined,
): PropertyChange[] {
  // An older snapshot (a signature string) carries no per-floor detail, so
  // nothing is claimed about the individual floors.
  if (!Array.isArray(before) || !Array.isArray(after)) return [];
  const changes: PropertyChange[] = [];
  const beforeFloors = new Map(before.map((floor) => [floorKey(floor), floor]));
  const afterFloors = new Map(after.map((floor) => [floorKey(floor), floor]));

  for (const [key, floor] of afterFloors) {
    const previous = beforeFloors.get(key);
    if (!previous) {
      changes.push({ label: `تمت إضافة ${floorLabel(floor)}` });
      continue;
    }
    if (normalizeText(previous.details) !== normalizeText(floor.details)) {
      changes.push({
        label: `${floorLabel(floor)} — التفاصيل`,
        detail: detailPair(previous.details, floor.details),
      });
    }
  }
  for (const [key, floor] of beforeFloors) {
    if (!afterFloors.has(key))
      changes.push({ label: `تم حذف ${floorLabel(floor)}` });
  }
  return changes;
}

/** One genuinely changed public field. */
export interface PropertyChange {
  /** The Arabic label shown in the notification. */
  label: string;
  /** A short "before ← after" comparison, when the values are safe to show. */
  detail?: string;
}

const LISTING_TYPE_LABELS: Record<DealType, string> = {
  SALE: 'بيع',
  RENT: 'إيجار',
  EXCHANGE: 'بدل',
};

function decimalToString(value: Prisma.Decimal | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toString();
}

/** `250000` → `250,000` (a compact, locale-free grouping). */
function groupNumber(value: string): string {
  const [whole = '0', fraction] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/**
 * Captures the current public snapshot of a property inside the caller's
 * transaction, so the comparison always sees exactly the row that is being
 * approved.
 */
export async function capturePropertySnapshot(
  tx: Prisma.TransactionClient,
  propertyId: string,
): Promise<PropertySnapshot | null> {
  const property = await tx.property.findUnique({
    where: { id: propertyId },
    include: {
      floors: { orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!property) return null;
  return {
    title: property.title,
    area: property.area,
    address: property.address,
    governorate: property.governorate,
    district: property.district,
    block: property.block,
    street: property.street,
    plotNumber: property.plotNumber,
    sizeSqm: decimalToString(property.sizeSqm),
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    floorCount: property.floorCount,
    askingPrice: decimalToString(property.askingPrice),
    currency: property.currency,
    negotiable: property.negotiable,
    listingType: property.listingType,
    description: property.description,
    floors: property.floors.map((floor) => ({
      type: floor.type,
      customLabel: floor.customLabel,
      details: floor.details,
    })),
    primaryImageId: property.primaryImageId,
  };
}

/**
 * The public snapshot of a property ROW that is already loaded (the state
 * BEFORE a mutation).
 *
 * The floors and the image count are not part of a loaded row, so they stay
 * `undefined` — and a comparison against such a baseline simply skips them
 * instead of claiming a change it cannot verify.
 */
export function snapshotFromPropertyRow(row: {
  title: string;
  area: string;
  address?: string | null;
  governorate: string | null;
  district: string | null;
  block: string | null;
  street: string | null;
  plotNumber: string | null;
  sizeSqm: Prisma.Decimal | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floorCount: number | null;
  askingPrice: Prisma.Decimal | null;
  currency: string;
  negotiable: boolean | null;
  listingType: DealType;
  description: string | null;
}): PropertySnapshot {
  return {
    title: row.title,
    area: row.area,
    address: row.address ?? null,
    governorate: row.governorate,
    district: row.district,
    block: row.block,
    street: row.street,
    plotNumber: row.plotNumber,
    sizeSqm: decimalToString(row.sizeSqm),
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    floorCount: row.floorCount,
    askingPrice: decimalToString(row.askingPrice),
    currency: row.currency,
    negotiable: row.negotiable,
    listingType: row.listingType,
    description: row.description,
  };
}

/**
 * The state of the OPEN review round of a property: the baseline it compares
 * against and the image replacement waiting for the manager's decision.
 *
 * The baseline of the round is the state the program showed before the edit
 * that opened it; the last APPROVED revision is the fallback for a property
 * that was edited before these baselines existed, and the pre-edit row is the
 * last resort.
 */
export async function reviewRoundState(
  tx: Prisma.TransactionClient,
  propertyId: string,
  preEditRow: Parameters<typeof snapshotFromPropertyRow>[0],
): Promise<ReviewRoundState> {
  const round = await tx.propertyRevision.findFirst({
    where: { propertyId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, payload: true },
  });
  if (round?.payload)
    return {
      ...decodeRevisionPayload(round.payload),
      roundRevisionId: round.id,
    };
  const approved = await tx.propertyRevision.findFirst({
    where: { propertyId, status: 'APPROVED' },
    orderBy: { createdAt: 'desc' },
    select: { payload: true },
  });
  if (approved?.payload)
    return {
      ...decodeRevisionPayload(approved.payload),
      roundRevisionId: null,
    };
  return {
    baseline: snapshotFromPropertyRow(preEditRow),
    pendingImageId: null,
    roundRevisionId: null,
  };
}

function changed(before: unknown, after: unknown): boolean {
  return (before ?? null) !== (after ?? null);
}

/**
 * The description keys the diff already reports as their own field.
 *
 * The wizard stores its whole form (location, area, floors, price, …) in the
 * `description` column, so an edit of one of those fields necessarily rewrites
 * that text. Those keys are compared through their own field and must not be
 * reported a second time as a "description" change.
 */
const DESCRIPTION_KEYS_TRACKED_ELSEWHERE = new Set([
  'operation',
  'governorate',
  'district',
  'block',
  'plotNumber',
  'area',
  'landArea',
  'unitArea',
  'floorCount',
  'floors',
  'price',
  'negotiable',
]);

/** The marker the wizard appends after the structured part of a description. */
const REQUESTED_PROPERTY_MARKER = '=== العقار المطلوب في البدل ===';

/**
 * Splits a stored description into its structured envelope (the wizard form)
 * and its plain text part.
 */
function splitDescription(description: string | null): {
  envelope: Record<string, unknown> | null;
  text: string;
} {
  const raw = (description ?? '').trim();
  if (!raw) return { envelope: null, text: '' };
  const markerIndex = raw.indexOf(REQUESTED_PROPERTY_MARKER);
  const head = (markerIndex >= 0 ? raw.slice(0, markerIndex) : raw).trim();
  const text = markerIndex >= 0 ? raw.slice(markerIndex).trim() : '';
  try {
    const parsed: unknown = JSON.parse(head);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return { envelope: parsed as Record<string, unknown>, text };
  } catch {
    /* A free-text description: compared as text below. */
  }
  return { envelope: null, text: raw };
}

/**
 * The comparable content of a description.
 *
 * The FREE TEXT part is what a reader sees as the description. The structured
 * envelope is compared field by field (see `ENVELOPE_FIELDS`), so the fields
 * that are reported on their own are never counted twice and a rewritten
 * envelope never looks like a new description.
 */
export function descriptionSignature(description: string | null): string {
  const { envelope, text } = splitDescription(description);
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  if (!envelope) return normalizedText;
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(envelope)) {
    if (DESCRIPTION_KEYS_TRACKED_ELSEWHERE.has(key)) continue;
    rest[key] = value;
  }
  return `${JSON.stringify(rest)}|${normalizedText}`;
}

/**
 * The comparable FREE TEXT of a description.
 *
 * The structured envelope is compared field by field elsewhere, so only the
 * text a reader actually sees as the description is compared here — without
 * formatting-only differences.
 */
export function descriptionTextSignature(description: string | null): string {
  // For a free-text description this is the whole text; for a structured one
  // it is the part that follows the envelope.
  return splitDescription(description).text.replace(/\s+/g, ' ').trim();
}

/**
 * The wizard fields that live ONLY inside the structured description (they are
 * not columns of the property). They are compared one by one so a change is
 * reported with its own label instead of hiding inside "الوصف".
 *
 * `detail: 'value'` marks the concise ones (numbers) that may show their
 * old → new value; the long texts are reported by name only.
 */
const ENVELOPE_FIELDS: { key: string; label: string; detail?: 'value' }[] = [
  { key: 'landArea', label: 'أرض', detail: 'value' },
  { key: 'unitArea', label: 'وحدة', detail: 'value' },
  { key: 'hasBasement', label: 'سرداب' },
  { key: 'basementDetails', label: 'تفاصيل السرداب' },
  { key: 'hasHalfFloor', label: 'نصف دور' },
  { key: 'halfFloorDetails', label: 'تفاصيل نصف الدور' },
  { key: 'hasQuarterFloor', label: 'ربع دور' },
  { key: 'quarterFloorDetails', label: 'تفاصيل ربع الدور' },
  { key: 'requestedProperty', label: 'العقار المطلوب' },
];

/** The value of one envelope field as a comparable string. */
function envelopeValue(
  envelope: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!envelope) return null;
  const value = envelope[key];
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return JSON.stringify(value);
}

/**
 * The fields that genuinely changed between the last APPROVED snapshot and the
 * version that is being approved now.
 *
 * Every supported PUBLIC listing field is compared on its own and reported
 * with its own accurate Arabic label — the location fields are never lumped
 * together — and the floors are compared one by one, preserving the identity
 * of each floor (a basement stays a basement, a first floor stays a first
 * floor). Only the fields that really moved are reported: a re-submission
 * without an edit changes nothing and therefore reports nothing.
 */
export function diffPropertySnapshots(
  before: PropertySnapshot,
  after: PropertySnapshot,
): PropertyChange[] {
  const changes: PropertyChange[] = [];

  if (changed(before.askingPrice, after.askingPrice)) {
    changes.push({
      label: 'السعر',
      detail: `${groupNumber(before.askingPrice ?? '0')} ← ${groupNumber(
        after.askingPrice ?? '0',
      )} ${after.currency}`,
    });
  }
  if (changed(before.sizeSqm, after.sizeSqm)) {
    changes.push({
      label: 'المساحة',
      detail: `${before.sizeSqm ?? '—'} ← ${after.sizeSqm ?? '—'} م²`,
    });
  }
  if (changed(before.listingType, after.listingType)) {
    changes.push({
      label: 'نوع الصفقة',
      detail: `${LISTING_TYPE_LABELS[before.listingType]} ← ${
        LISTING_TYPE_LABELS[after.listingType]
      }`,
    });
  }
  if (changed(before.bedrooms, after.bedrooms)) {
    changes.push({
      label: 'عدد الغرف',
      detail: `${before.bedrooms ?? '—'} ← ${after.bedrooms ?? '—'}`,
    });
  }
  if (changed(before.bathrooms, after.bathrooms)) {
    changes.push({
      label: 'عدد الحمامات',
      detail: `${before.bathrooms ?? '—'} ← ${after.bathrooms ?? '—'}`,
    });
  }
  if (changed(before.floorCount, after.floorCount)) {
    changes.push({
      label: 'عدد الأدوار',
      detail: `${before.floorCount ?? '—'} ← ${after.floorCount ?? '—'}`,
    });
  }
  // The location fields, each with its own label.
  if (changed(before.governorate, after.governorate)) {
    changes.push({
      label: 'المحافظة',
      detail: `${before.governorate ?? '—'} ← ${after.governorate ?? '—'}`,
    });
  }
  if (changed(before.district, after.district)) {
    changes.push({
      label: 'المنطقة',
      detail: `${before.district ?? '—'} ← ${after.district ?? '—'}`,
    });
  }
  if (changed(before.block, after.block)) {
    changes.push({
      label: 'القطعة',
      detail: `${before.block ?? '—'} ← ${after.block ?? '—'}`,
    });
  }
  if (changed(before.street, after.street)) {
    changes.push({
      label: 'الشارع',
      detail: `${before.street ?? '—'} ← ${after.street ?? '—'}`,
    });
  }
  if (changed(before.plotNumber, after.plotNumber)) {
    changes.push({
      label: 'رقم القسيمة',
      detail: `${before.plotNumber ?? '—'} ← ${after.plotNumber ?? '—'}`,
    });
  }
  if (
    before.address !== undefined &&
    changed(before.address, after.address)
  ) {
    changes.push({ label: 'العنوان' });
  }
  if (changed(before.title, after.title)) {
    changes.push({ label: 'عنوان العقار' });
  }
  if (changed(before.currency, after.currency)) {
    changes.push({
      label: 'العملة',
      detail: `${before.currency} ← ${after.currency}`,
    });
  }
  if (changed(before.negotiable, after.negotiable)) {
    changes.push({ label: 'التفاوض' });
  }
  // The floors, one by one, with their identity preserved.
  changes.push(...diffFloors(before.floors, after.floors));
  // The wizard fields that live inside the structured description are compared
  // one by one, so every genuinely changed listing field is reported with its
  // own label.
  const beforeEnvelope = splitDescription(before.description).envelope;
  const afterEnvelope = splitDescription(after.description).envelope;
  for (const field of ENVELOPE_FIELDS) {
    const oldValue = envelopeValue(beforeEnvelope, field.key);
    const newValue = envelopeValue(afterEnvelope, field.key);
    if (oldValue === newValue) continue;
    changes.push({
      label: field.label,
      ...(field.detail === 'value' && oldValue && newValue
        ? { detail: `${oldValue} ← ${newValue}` }
        : {}),
    });
  }

  // The free text of the description — never its wording in the preview.
  if (descriptionTextSignature(before.description) !==
      descriptionTextSignature(after.description)) {
    changes.push({ label: 'الوصف' });
  }
  // The image itself: reported ONLY when it is really replaced.
  if (
    before.primaryImageId !== undefined &&
    before.primaryImageId !== after.primaryImageId
  ) {
    changes.push({ label: 'الصورة الرئيسية' });
  }
  return changes;
}

/**
 * The stored state of a review round: the baseline it compares against and the
 * image replacement waiting for the manager's decision.
 */
export interface ReviewRoundState {
  baseline: PropertySnapshot | null;
  pendingImageId: string | null;
  /**
   * The row that carries the OPEN round, when one exists. The database allows
   * only one PENDING revision per property (a partial unique index), so an
   * round is REUSED while it is open and CLOSED — its row becomes the approved
   * record or is marked rejected — on the manager's decision.
   */
  roundRevisionId: string | null;
}

/**
 * Reads a stored review-round payload.
 *
 * A current payload holds the baseline and the staged image; an older one
 * holds the plain baseline snapshot (no staged image) — both are read, and
 * nothing is ever invented.
 */
export function decodeRevisionPayload(payload: unknown): ReviewRoundState {
  if (!payload || typeof payload !== 'object')
    return { baseline: null, pendingImageId: null, roundRevisionId: null };
  const record = payload as Record<string, unknown>;
  if (record.baseline && typeof record.baseline === 'object')
    return {
      baseline: record.baseline as unknown as PropertySnapshot,
      pendingImageId:
        typeof record.pendingImageId === 'string' ? record.pendingImageId : null,
      roundRevisionId: null,
    };
  return {
    baseline: record as unknown as PropertySnapshot,
    pendingImageId: null,
    roundRevisionId: null,
  };
}

/**
 * The compact Arabic change list for a notification body, e.g.
 * `السعر (250,000 ← 300,000 KWD)، المساحة (400 ← 450 م²)، الوصف`.
 */
export function formatPropertyChanges(changes: PropertyChange[]): string {
  return changes
    .map((change) =>
      change.detail ? `${change.label} (${change.detail})` : change.label,
    )
    .join('، ');
}
