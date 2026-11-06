/**
 * Response shapes of the client review endpoints. Deliberately flat and
 * narrow: a review proposal is visible ONLY to its requester and to a
 * manager (both are authorized for the underlying data), while list rows
 * stay summary-level and value details live behind `GET /client-reviews/:id`.
 */

export interface ClientReviewSummaryDto {
  id: string;
  kind: 'CREATION' | 'EDIT';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';
  /** The proposed client (CREATION) or the approved client id (EDIT). */
  clientId: string | null;
  /** The proposed/client name for the card — requester or manager only. */
  clientName: string;
  requesterId: string;
  requesterName: string;
  /** Who changed what fact — privacy-safe wording only (no phone/notes). */
  submissionSummary: string | null;
  /** Whether the requester left a note for the reviewer. */
  hasSubmissionNote: boolean;
  createdAt: string;
  reviewedAt: string | null;
  reviewNotes: string | null;
}

export interface ClientReviewInterestDto {
  propertyId: string;
  reference: string | null;
  title: string | null;
  reason: string | null;
  notes: string | null;
}

export interface ClientReviewDetailDto {
  id: string;
  kind: 'CREATION' | 'EDIT';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';
  clientId: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewNotes: string | null;
  requesterId: string;
  requesterName: string;
  submissionNote: string | null;
  /** The COMPLETE proposed state. */
  proposed: {
    name: string;
    phone: string;
    notes: string | null;
    requestData: string | null;
    addInterests: ClientReviewInterestDto[];
    removeInterests: ClientReviewInterestDto[];
  };
  /** EDIT only: the approved state the proposal was based on. */
  current: {
    name: string;
    phone: string;
    notes: string | null;
    requestData: string | null;
    interests: ClientReviewInterestDto[];
  } | null;
  /** Privacy-safe Arabic diff items between `current` and `proposed`. */
  diff: string[];
}

export interface ClientReviewListDto {
  items: ClientReviewSummaryDto[];
}

/** The «تحت المراجعة» badge counter: exactly what awaits a Manager decision. */
export interface ClientReviewCountDto {
  pending: number;
}
