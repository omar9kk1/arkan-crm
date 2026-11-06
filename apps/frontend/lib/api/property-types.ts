/**
 * Types mirroring the backend responses of `GET/POST/PATCH /properties`,
 * `/properties/:id/{approve,reject,resubmit}` and `/contacts`.
 *
 * They are declared here rather than imported from the backend app so the
 * frontend keeps a hard boundary: nothing outside these shapes may be read, and
 * private contact fields are only present on `PrivatePropertyDto` when the
 * backend authorises the viewer to see them.
 */

export type DealType = 'SALE' | 'RENT' | 'EXCHANGE';
export type PropertyStatusApi =
  | 'PENDING'
  | 'AVAILABLE'
  | 'REJECTED'
  | 'SOLD'
  | 'RENTED'
  | 'ARCHIVED';
export type ContactTypeApi = 'OWNER' | 'BROKER';
/**
 * Status of a creation approval request. Distinct from `PropertyStatusApi`: a
 * property can stay `PENDING` while its latest approval is `CHANGES_REQUESTED`.
 */
export type ApprovalStatusApi =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CHANGES_REQUESTED';
/**
 * Role of the property CREATOR, derived server-side from `User.role`. Lets the
 * cards label a manager-created row «مدير» without exposing the manager's
 * personal name, and never has to be inferred from status or names.
 */
export type ResponsibleRoleApi = 'MANAGER' | 'EMPLOYEE';
export type FloorTypeApi =
  | 'GROUND'
  | 'FIRST'
  | 'SECOND'
  | 'THIRD'
  | 'FOURTH'
  | 'FIFTH'
  | 'SIXTH'
  | 'SEVENTH'
  | 'ROOF'
  | 'MEZZANINE'
  | 'BASEMENT'
  | 'HALF'
  | 'QUARTER'
  | 'CUSTOM';

export interface PropertyFloorDto {
  id: string;
  type: FloorTypeApi;
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
  type: ContactTypeApi;
  name: string;
  phone: string;
  notes: string | null;
}

/** Returned to every authorised viewer. Contains no private contact data. */
export interface PublicPropertyDto {
  id: string;
  /** Active display code: A when approved, P while pending. */
  reference: string;
  /** Original submission P-code, for traceability. */
  submissionReference?: string;
  /** Official A-code, or null before approval. */
  approvedReference?: string | null;
  title: string;
  listingType: DealType;
  status: PropertyStatusApi;
  governorate: string | null;
  district: string | null;
  block: string | null;
  plotNumber: string | null;
  address: string | null;
  sizeSqm: string | null;
  floorCount: number | null;
  floors: PropertyFloorDto[];
  askingPrice: string | null;
  negotiable: boolean | null;
  description: string | null;
  requestedProperty: RequestedPropertyDto | null;
  responsibleName: string | null;
  /**
   * Server-derived role of the property creator, or null when no creator is
   * recorded. Together with `responsibleName` (the creator's display name) it
   * drives the top-left responsible pill — never the owner/broker contact.
   */
  responsibleRole: ResponsibleRoleApi | null;
  primaryImageUrl: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  /**
   * Server-computed: true when the authenticated user is the property creator.
   * Viewer-specific but never private — it only tells the viewer about their own
   * ownership and never grants contact access (that stays server-authoritative).
   */
  isMine: boolean;
  /** Soft-delete markers (null/undefined on active rows). Manager Trash only. */
  deletedAt?: string | null;
  deletedByName?: string | null;
  deletionReason?: string | null;
}

/**
 * Returned only to the manager and to the employee who registered the contact:
 * carries the private owner/broker contact, the latest review notes and the
 * latest review status. For any other viewer of an AVAILABLE property the
 * backend returns `PublicPropertyDto`.
 */
export interface PrivatePropertyDto extends PublicPropertyDto {
  contactId: string | null;
  contact: ContactSummaryDto | null;
  reviewNotes: string | null;
  reviewStatus: ApprovalStatusApi | null;
  /** Manager-only: potential duplicate candidate property IDs (null/undefined when none). */
  duplicateCandidateIds?: string[] | null;
  /** Provisional owner staged by an employee submission (promoted on approval). */
  proposedOwner?: {
    type: ContactTypeApi;
    name: string;
    phone: string;
    notes: string | null;
  } | null;
}

export type PropertyViewDto = PublicPropertyDto | PrivatePropertyDto;

/** Narrowing helper: private fields exist only when the backend sent them. */
export function hasPrivateContact(
  dto: PropertyViewDto,
): dto is PrivatePropertyDto {
  return (
    (dto as PrivatePropertyDto).contact !== undefined &&
    (dto as PrivatePropertyDto).contact !== null
  );
}

/**
 * Narrowing helper for the whole private projection. Unlike `hasPrivateContact`
 * this also matches when the private contact is present-but-empty (e.g. the
 * creator linked a contact owned by someone else), so `reviewNotes` /
 * `reviewStatus` are still read for the manager and the creator.
 */
export function isPrivatePropertyDto(
  dto: PropertyViewDto,
): dto is PrivatePropertyDto {
  return 'contact' in dto;
}

export interface PropertyPageDto {
  items: PropertyViewDto[];
  nextCursor: string | null;
}

export interface ContactPropertyRefDto {
  id: string;
  reference: string;
  /** Real transaction type of the linked property (`Property.listingType`). */
  listingType: DealType;
}

export interface ContactDto {
  id: string;
  type: ContactTypeApi;
  name: string;
  phone: string;
  notes: string | null;
  responsibleUserId: string | null;
  /** Display name of the responsible employee from `User.name`; null when unassigned. */
  responsibleEmployeeName: string | null;
  /** Linked properties (`Property.contactId`) the viewer is authorized to see. */
  properties: ContactPropertyRefDto[];
  createdAt: string;
  updatedAt: string;
}

export interface ContactPageDto {
  items: ContactDto[];
  nextCursor: string | null;
}

/** Body of the JSON `payload` field of a multipart `POST /properties`. */
export interface NewContactPayload {
  type: ContactTypeApi;
  name: string;
  phone: string;
  notes?: string;
}

export interface PropertyFloorPayload {
  type: FloorTypeApi;
  customLabel?: string;
  details?: string;
  sortOrder?: number;
}

export interface RequestedPropertyPayload {
  governorate?: string;
  district?: string;
  block?: string;
  plotNumber?: string;
  sizeSqm?: string;
  floorRequirements?: string;
  notes?: string;
  budgetMin?: string;
  budgetMax?: string;
}

/** Create body; `contactId` and `newContact` are mutually exclusive. */
export interface CreatePropertyPayload {
  listingType: DealType;
  title?: string;
  governorate?: string;
  district?: string;
  block?: string;
  plotNumber?: string;
  address?: string;
  sizeSqm?: string;
  floorCount?: number;
  floors?: PropertyFloorPayload[];
  askingPrice?: string;
  negotiable?: boolean;
  description?: string;
  contactId?: string;
  newContact?: NewContactPayload;
  requestedProperty?: RequestedPropertyPayload;
}

/** Update body; `version` is mandatory (optimistic concurrency, stale → 409). */
export interface UpdatePropertyPayload extends CreatePropertyPayload {
  version: number;
}

export interface CreateContactPayload {
  type: ContactTypeApi;
  name: string;
  phone: string;
  notes?: string;
}

export interface UpdateContactPayload {
  type?: ContactTypeApi;
  name?: string;
  phone?: string;
  notes?: string | null;
}
