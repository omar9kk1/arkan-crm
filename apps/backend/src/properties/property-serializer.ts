import {
  ApprovalStatus,
  ContactType,
  DealType,
  FloorType,
  Prisma,
  PropertyStatus,
} from '@prisma/client';
import { Role, type AuthUser } from '@arkan/shared';
import type {
  ContactSummaryDto,
  PropertyFloorDto,
  PropertyViewDto,
  PublicPropertyDto,
  PrivatePropertyDto,
  RequestedPropertyDto,
} from './property.dto';

/** Relations loaded for every detail/list response. */
export const propertyDetailInclude = {
  contact: true,
  createdByUser: {
    select: {
      id: true,
      name: true,
      role: true,
      employee: { select: { managerUserId: true } },
    },
  },
  deletedBy: { select: { id: true, name: true } },
  priorityHolder: { select: { id: true, name: true } },
  registrants: { select: { employeeUserId: true, status: true } },
  floors: { orderBy: { sortOrder: 'asc' } },
  requestedProperty: true,
  approvals: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.PropertyInclude;

/**
 * Structural view of everything the serializer reads. Declared explicitly so the
 * serializer can never reach into an unexpected Prisma field.
 */
export interface PropertySerializationSource {
  id: string;
  reference: string;
  approvedReference: string | null;
  title: string;
  area: string;
  address: string | null;
  governorate: string | null;
  district: string | null;
  block: string | null;
  plotNumber: string | null;
  sizeSqm: Prisma.Decimal | null;
  floorCount: number | null;
  askingPrice: Prisma.Decimal | null;
  negotiable: boolean | null;
  currency: string;
  status: PropertyStatus;
  listingType: DealType;
  version: number;
  description: string | null;
  contactId: string | null;
  createdByUserId: string | null;
  primaryImageId: string | null;
  deletedAt: Date | null;
  deletionReason: string | null;
  proposedOwner: Prisma.JsonValue | null;
  deletedBy: { id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
  contact: {
    id: string;
    type: ContactType;
    name: string;
    phone: string;
    notes: string | null;
    responsibleUserId: string | null;
  } | null;
  createdByUser: {
    id: string;
    name: string;
    role: Role;
    employee?: { managerUserId: string | null } | null;
  } | null;
  priorityHolderUserId: string | null;
  priorityHolder: { id: string; name: string } | null;
  priorityDeadline: Date | null;
  priorityLocked: boolean;
  registrants: { employeeUserId: string; status: string }[];
  floors: {
    id: string;
    type: FloorType;
    customLabel: string | null;
    details: string | null;
    sortOrder: number;
  }[];
  requestedProperty: {
    governorate: string | null;
    district: string | null;
    block: string | null;
    plotNumber: string | null;
    sizeSqm: Prisma.Decimal | null;
    floorRequirements: string | null;
    notes: string | null;
    budgetMin: Prisma.Decimal | null;
    budgetMax: Prisma.Decimal | null;
  } | null;
  approvals: {
    status: ApprovalStatus;
    notes: string | null;
    createdAt: Date;
    reviewedAt: Date | null;
    duplicateCandidateIds: unknown;
  }[];
}

const decimalToString = (value: Prisma.Decimal | null): string | null =>
  value === null ? null : value.toString();

function toFloorDto(floor: PropertySerializationSource['floors'][number]): PropertyFloorDto {
  return {
    id: floor.id,
    type: floor.type,
    customLabel: floor.customLabel,
    details: floor.details,
    sortOrder: floor.sortOrder,
  };
}

function toRequestedPropertyDto(
  requested: NonNullable<PropertySerializationSource['requestedProperty']>,
): RequestedPropertyDto {
  return {
    governorate: requested.governorate,
    district: requested.district,
    block: requested.block,
    plotNumber: requested.plotNumber,
    sizeSqm: decimalToString(requested.sizeSqm),
    floorRequirements: requested.floorRequirements,
    notes: requested.notes,
    budgetMin: decimalToString(requested.budgetMin),
    budgetMax: decimalToString(requested.budgetMax),
  };
}

function latestReviewNotes(
  source: PropertySerializationSource,
): string | null {
  return source.approvals[0]?.notes ?? null;
}

/**
 * The current review state, derived from the LATEST creation approval request
 * (`approvals` are loaded newest-first). This is what distinguishes an ordinary
 * PENDING row from a PENDING row whose manager requested changes, and it is the
 * only review metadata exposed — never the raw approval records.
 */
function latestReviewStatus(
  source: PropertySerializationSource,
): ApprovalStatus | null {
  return source.approvals[0]?.status ?? null;
}

/**
 * Builds the public projection. It NEVER includes a Contact/Owner, a phone number,
 * a storage key/path, or any raw Prisma model.
 */
export function toPublicPropertyDto(
  source: PropertySerializationSource,
  viewer: AuthUser,
): PublicPropertyDto {
  return {
    id: source.id,
    reference: source.approvedReference ?? source.reference,
    submissionReference: source.reference,
    approvedReference: source.approvedReference,
    title: source.title,
    listingType: source.listingType,
    status: source.status,
    governorate: source.governorate,
    district: source.district,
    block: source.block,
    plotNumber: source.plotNumber,
    address: source.address,
    sizeSqm: decimalToString(source.sizeSqm),
    floorCount: source.floorCount,
    askingPrice: decimalToString(source.askingPrice),
    currency: source.currency,
    negotiable: source.negotiable,
    description: source.description,
    floors: source.floors.map(toFloorDto),
    requestedProperty: source.requestedProperty
      ? toRequestedPropertyDto(source.requestedProperty)
      : null,
    primaryImageUrl: source.primaryImageId
      ? `/properties/${source.id}/image`
      : null,
    responsibleName: source.createdByUser?.name ?? null,
    responsibleRole: source.createdByUser?.role ?? null,
    priorityHolderName: null,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
    version: source.version,
    deletedAt: source.deletedAt?.toISOString() ?? null,
    deletedByName:
      viewer.role === Role.MANAGER || viewer.role === Role.OWNER
        ? (source.deletedBy?.name ?? null)
        : null,
    deletionReason: source.deletionReason,
    // Viewer-derived ownership flag.
    isMine: viewer.id === source.createdByUserId,
  };
}

function proposedOwnerDto(
  value: Prisma.JsonValue | null,
): { type: ContactType; name: string; phone: string; notes: string | null } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== 'string' || typeof v.phone !== 'string') return null;
  return {
    type: v.type === 'BROKER' ? ContactType.BROKER : ContactType.OWNER,
    name: v.name,
    phone: v.phone,
    notes: typeof v.notes === 'string' ? v.notes : null,
  };
}

/**
 * Builds the authorized view for a caller.
 *
 * Private contact/review data is attached ONLY when:
 *   - the caller is the OWNER;
 *   - the caller is the property creator; or
 *   - the caller is a MANAGER for the creator's current team (or an OWNER-created
 *     row).
 * An unrelated MANAGER can still open the approved public listing after
 * company-wide visibility, but receives the public projection only: no contact,
 * contact id, provisional owner, review notes or duplicate metadata. Ambiguous
 * ownership defaults to denial.
 */
export function serializeProperty(
  source: PropertySerializationSource,
  viewer: AuthUser,
): PropertyViewDto {
  const base = toPublicPropertyDto(source, viewer);
  const isOwner = viewer.role === Role.OWNER;
  const isManager = viewer.role === Role.MANAGER;
  const isCreator = source.createdByUserId === viewer.id;

  // Another team's approved property is publicly visible, but its private
  // contact, review notes, provisional owner and duplicate metadata are not.
  const managerTeamScope =
    isManager &&
    (isCreator ||
      source.createdByUser?.employee?.managerUserId === viewer.id ||
      source.createdByUser?.role === Role.OWNER);
  if (!isOwner && !isCreator && !managerTeamScope) return base;

  const contact = source.contact;
  const ownsContact =
    contact !== null && contact.responsibleUserId === viewer.id;
  const canSeeContact =
    isOwner || managerTeamScope || (isCreator && ownsContact);

  const contactDto: ContactSummaryDto | null =
    canSeeContact && contact
      ? {
          id: contact.id,
          type: contact.type,
          name: contact.name,
          phone: contact.phone,
          notes: contact.notes,
        }
      : null;

  const privateDto: PrivatePropertyDto = {
    ...base,
    contactId: canSeeContact ? source.contactId : null,
    contact: contactDto,
    reviewNotes: latestReviewNotes(source),
    reviewStatus: latestReviewStatus(source),
    proposedOwner:
      isManager || isCreator ? proposedOwnerDto(source.proposedOwner) : null,
    duplicateCandidateIds: isManager && source.approvals.length > 0
      ? (source.approvals[0]?.duplicateCandidateIds as string[] | null) ?? null
      : null,
  };
  return privateDto;
}
