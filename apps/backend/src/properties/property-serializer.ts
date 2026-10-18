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
  createdByUser: { select: { id: true, name: true, role: true } },
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
  createdByUser: { id: string; name: string; role: Role } | null;
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
    reference: source.reference,
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
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
    version: source.version,
    // Viewer-derived ownership flag. `contact` access below stays independent.
    isMine: viewer.id === source.createdByUserId,
  };
}

/**
 * Builds the authorized view for a caller.
 *
 * Private contact data is attached ONLY when:
 *   - the caller is a MANAGER; or
 *   - the caller is the property creator AND the linked contact is owned by them.
 * Ambiguous/unverified ownership defaults to denial, so an employee can never read a
 * contact they do not own — not through the property relation, names or phone match.
 */
export function serializeProperty(
  source: PropertySerializationSource,
  viewer: AuthUser,
): PropertyViewDto {
  const base = toPublicPropertyDto(source, viewer);
  const isManager = viewer.role === Role.MANAGER;
  const isCreator = source.createdByUserId === viewer.id;
  if (!isManager && !isCreator) return base;

  const contact = source.contact;
  const ownsContact =
    contact !== null && contact.responsibleUserId === viewer.id;
  const canSeeContact = isManager || (isCreator && ownsContact);

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
  };
  return privateDto;
}
