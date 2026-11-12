import { authorizedRequest } from './authorized';

/**
 * Wire shapes of the staged client review workflow (`/client-reviews`).
 *
 * An EMPLOYEE never calls `POST/PATCH /clients` — every wizard save is staged
 * here as a review the manager approves. A MANAGER reads the feed, decides,
 * and keeps the direct save paths for their own edits.
 */

export type ClientReviewKind = 'CREATION' | 'EDIT';

export type ClientReviewStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CHANGES_REQUESTED';

export interface ClientReviewInterestPayload {
  propertyId: string;
  reason?: string | null;
  notes?: string | null;
}

export interface ClientReviewInterestDto {
  propertyId: string;
  reference: string | null;
  title: string | null;
  reason: string | null;
  notes: string | null;
}

/** The wizard save, staged for manager approval. */
export interface SubmitClientReviewPayload {
  kind: ClientReviewKind;
  /** The approved client being changed (EDIT only). */
  clientId?: string;
  name: string;
  phone: string;
  notes?: string | null;
  /** Opaque structured wizard document (null clears it). */
  requestData?: string | null;
  addInterests?: ClientReviewInterestPayload[];
  /** Property ids of recorded interests being removed (EDIT only). */
  removeInterests?: string[];
  /** The requester's note for the reviewer. */
  submissionNote?: string | null;
  /**
   * Requester-scoped idempotency key of THE wizard session (a stable UUID):
   * an accidental repeat with the SAME key + content resolves to the SAME
   * review instead of a duplicate; different content answers 409.
   */
  idempotencyKey?: string;
}

export interface ClientReviewNotePayload {
  reviewNotes?: string | null;
}

/** A list card — summary level only; values live in the detail. */
export interface ClientReviewSummaryDto {
  id: string;
  kind: ClientReviewKind;
  status: ClientReviewStatus;
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

export interface ClientReviewDetailDto {
  id: string;
  kind: ClientReviewKind;
  status: ClientReviewStatus;
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
  /** Privacy-safe Arabic diff items; empty when identical. */
  diff: string[];
}

export interface ClientReviewListDto {
  items: ClientReviewSummaryDto[];
}

/** The «تحت المراجعة» badge counter: ONLY the reviews awaiting a Manager
 *  decision (PENDING). Scoped by the backend per role — an employee counts
 *  only their own rows. */
export interface ClientReviewCountDto {
  pending: number;
}

const BASE = '/client-reviews';

/** `GET /client-reviews/count` — the exact badge number (accurate even
 *  beyond any list window). */
export function getClientReviewCount(): Promise<ClientReviewCountDto> {
  return authorizedRequest<ClientReviewCountDto>(`${BASE}/count`);
}

/** `POST /client-reviews` — stage a CREATION/EDIT proposal. */
export function submitClientReview(
  payload: SubmitClientReviewPayload,
): Promise<ClientReviewDetailDto> {
  return authorizedRequest<ClientReviewDetailDto>(BASE, {
    method: 'POST',
    body: payload,
  });
}

/** `GET /client-reviews` — the authorised feed, newest first. */
export function listClientReviews(): Promise<ClientReviewListDto> {
  return authorizedRequest<ClientReviewListDto>(BASE);
}

/** `GET /client-reviews/:id` — the full proposal detail (authorised readers). */
export function getClientReview(id: string): Promise<ClientReviewDetailDto> {
  return authorizedRequest<ClientReviewDetailDto>(`${BASE}/${id}`);
}

/**
 * `GET /client-reviews/:id/owner-detail` — OWNER-only read-through used by the
 * System Log. It can read a managed employee's request without adding it to the
 * OWNER's actionable review queue.
 */
export function getOwnerClientReview(
  id: string,
): Promise<ClientReviewDetailDto> {
  return authorizedRequest<ClientReviewDetailDto>(
    `${BASE}/${id}/owner-detail`,
  );
}

/** `PATCH /client-reviews/:id` — the requester's EXPLICIT refreshed proposal. */
export function resubmitClientReview(
  id: string,
  payload: SubmitClientReviewPayload,
): Promise<ClientReviewDetailDto> {
  return authorizedRequest<ClientReviewDetailDto>(`${BASE}/${id}`, {
    method: 'PATCH',
    body: payload,
  });
}

/** `POST /client-reviews/:id/approve` — MANAGER only, applies atomically. */
export function approveClientReview(
  id: string,
  payload: ClientReviewNotePayload = {},
): Promise<ClientReviewSummaryDto> {
  return authorizedRequest<ClientReviewSummaryDto>(`${BASE}/${id}/approve`, {
    method: 'POST',
    body: payload,
  });
}

/** `POST /client-reviews/:id/reject` — MANAGER only. */
export function rejectClientReview(
  id: string,
  payload: ClientReviewNotePayload = {},
): Promise<ClientReviewSummaryDto> {
  return authorizedRequest<ClientReviewSummaryDto>(`${BASE}/${id}/reject`, {
    method: 'POST',
    body: payload,
  });
}

/** `POST /client-reviews/:id/request-changes` — MANAGER only. */
export function requestChangesOnClientReview(
  id: string,
  payload: ClientReviewNotePayload = {},
): Promise<ClientReviewSummaryDto> {
  return authorizedRequest<ClientReviewSummaryDto>(
    `${BASE}/${id}/request-changes`,
    { method: 'POST', body: payload },
  );
}
