import {
  ContactType,
  DealType,
  FloorType,
  ApprovalStatus,
  PropertyStatus,
  Role,
} from '@prisma/client';

export interface PropertyFloorDto {
  id: string;
  type: FloorType;
  customLabel: string | null;
  details: string | null;
  sortOrder: number;
}

export interface RequestedPropertyDto {
  governorate: string | null;
  district: string | null;
  block: string | null;
  plotNumber: string | null;
  sizeSqm: string | null;
  floorRequirements: string | null;
  notes: string | null;
  budgetMin: string | null;
  budgetMax: string | null;
}

export interface ContactSummaryDto {
  id: string;
  type: ContactType;
  name: string;
  phone: string;
  notes: string | null;
}

/** The privacy-safe shape returned to any authorized viewer. */
export interface PublicPropertyDto {
  id: string;
  /** The ACTIVE display code: A-code when approved, P-code while pending. */
  reference: string;
  /** The original submission code (P-000001) kept for history/traceability. */
  submissionReference: string;
  /** The official A-code, or null while no approval has happened. */
  approvedReference: string | null;
  title: string;
  listingType: DealType;
  status: PropertyStatus;
  governorate: string | null;
  district: string | null;
  block: string | null;
  plotNumber: string | null;
  address: string | null;
  sizeSqm: string | null;
  floorCount: number | null;
  askingPrice: string | null;
  currency: string;
  negotiable: boolean | null;
  description: string | null;
  floors: PropertyFloorDto[];
  requestedProperty: RequestedPropertyDto | null;
  primaryImageUrl: string | null;
  responsibleName: string | null;
  /**
   * Server-derived role of the property CREATOR (`Property.createdByUser.role`),
   * so the cards can label a manager-created row «مدير» instead of exposing the
   * manager's personal name. Null when no creator is recorded — the UI then
   * shows no pill rather than guessing from status, names or the owner/broker
   * contact (which this DTO never carries to an unauthorised viewer anyway).
   */
  responsibleRole: Role | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  /**
   * Viewer-specific: computed by the server as
   * `property.createdByUserId === authenticatedUser.id`. Never trusted from the
   * client and never used to grant contact access (that stays a separate,
   * authoritative check). Lets the employee "My Properties" tab keep showing a
   * row after the manager approves it.
   */
  isMine: boolean;
  /** Public within the sales team: name of the current priority holder, if any. */
  priorityHolderName: string | null;
  /** Soft-delete markers (null on active rows). OWNER Trash only. */
  deletedAt: string | null;
  deletedByName: string | null;
  deletionReason: string | null;
}

/**
 * The private shape returned only to the manager or the responsible employee. The
 * `contact` / `contactId` / `reviewNotes` / `reviewStatus` keys are absent from
 * `PublicPropertyDto`, so a public response can never carry (or accidentally
 * leak) private contact or review data.
 */
export interface PrivatePropertyDto extends PublicPropertyDto {
  contactId: string | null;
  contact: ContactSummaryDto | null;
  /** Instructions/reason of the latest review request, or null. */
  reviewNotes: string | null;
  /**
   * Status of the LATEST creation approval request, or null when the row has no
   * approval history (e.g. a manager-created property). Lets the UI tell an
   * ordinary PENDING row apart from a PENDING row whose manager requested
   * changes (`Property.status` alone cannot express this).
   */
  reviewStatus: ApprovalStatus | null;
  /** Manager-only: possible duplicate candidate property IDs from latest approval. */
  duplicateCandidateIds: string[] | null;
  /** Provisional owner staged by an employee submission (promoted on approval). */
  proposedOwner: {
    type: ContactType;
    name: string;
    phone: string;
    notes: string | null;
  } | null;
}

export type PropertyViewDto = PublicPropertyDto | PrivatePropertyDto;

export interface PropertyPageDto {
  items: PropertyViewDto[];
  nextCursor: string | null;
}

export interface PropertyApprovalSummary {
  status: ApprovalStatus;
  notes: string | null;
}
