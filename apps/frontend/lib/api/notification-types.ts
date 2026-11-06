/**
 * Wire shapes for the in-app notification bell.
 *
 * Mirrors the backend `NotificationDto` exactly. It deliberately carries NO
 * recipient id and no contact field values: the API only ever returns the
 * caller's own, already-privacy-filtered rows, and the record references are
 * only ever populated for the manager's own authorized rows.
 */
import type { PropertyStatusApi } from './property-types';

export type NotificationTypeApi =
  | 'PROPERTY_SUBMITTED'
  | 'PROPERTY_CHANGES_REQUESTED'
  | 'PROPERTY_REJECTED'
  | 'PROPERTY_RESUBMITTED'
  | 'PROPERTY_APPROVED'
  | 'PROPERTY_AVAILABLE'
  | 'CLIENT_CREATED'
  | 'CLIENT_UPDATED'
  | 'CLIENT_INTEREST_UPDATED'
  | 'FOLLOWUP_CREATED'
  | 'CONTACT_CREATED'
  | 'CONTACT_UPDATED'
  | 'FOLLOWUP_EMPLOYEE_LATE'
  | 'FOLLOWUP_MANAGER_ESCALATION'
  | 'CLIENT_REVIEW_SUBMITTED'
  | 'CLIENT_REVIEW_RESUBMITTED'
  | 'CLIENT_REVIEW_APPROVED'
  | 'CLIENT_REVIEW_REJECTED'
  | 'CLIENT_REVIEW_CHANGES_REQUESTED'
  | 'SYSTEM';

export interface NotificationDto {
  id: string;
  type: NotificationTypeApi;
  title: string;
  message: string;
  /** Authorized property to open, or null when the reader may not open it. */
  propertyId: string | null;
  /**
   * The CURRENT code of the linked property. A historical body may still carry
   * a retired code, so the surfaces show this one instead.
   */
  propertyReference: string | null;
  /** Authorized record targets of the shared activity events (manager rows). */
  clientId: string | null;
  contactId: string | null;
  /** The linked contact card's kind — where the manager tab has to land. */
  contactType: 'OWNER' | 'BROKER' | null;
  followUpId: string | null;
  /**
   * The stored per-recipient dedup key. On `FOLLOWUP_CREATED` rows it is
   * exactly `FOLLOWUP_CREATED:<entryId>` — the authoritative entry the deep
   * link scrolls/highlights; null on older rows.
   */
  eventKey: string | null;
  /**
   * The staged client review the row belongs to (submissions to managers,
   * decisions to the requesting employee); null on every other row.
   */
  clientReviewId: string | null;
  /**
   * The employee follow-up subject deep link, exposed ONLY to the responsible
   * employee (manager copies are masked server-side); null on every other row.
   */
  followUpSubjectId: string | null;
  /** Manager-only human-readable potential-duplicate context. */
  duplicate?: {
    newPropertyReference: string | null;
    existingPropertyReference: string | null;
    employeeName: string | null;
    status: PropertyStatusApi | null;
  } | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPageDto {
  items: NotificationDto[];
  nextCursor: string | null;
}

export interface UnreadCountDto {
  count: number;
}
