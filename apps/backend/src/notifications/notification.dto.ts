import type { ContactType, NotificationType, PropertyStatus } from '@prisma/client';

/**
 * The exact `Notification` columns the API is allowed to read. Declared
 * explicitly so a response can never grow into a raw Prisma entity or start
 * leaking a recipient id, a relation or a private field.
 */
export interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  readAt: Date | null;
  createdAt: Date;
  propertyId: string | null;
  clientId: string | null;
  contactId: string | null;
  followUpId: string | null;
  /** Deep link to a client review row (the recipient is always authorized). */
  clientReviewId: string | null;
  /**
   * The stored per-recipient dedup key. For `FOLLOWUP_CREATED` rows it is
   * exactly `FOLLOWUP_CREATED:<entryId>` — the authoritative entry id the
   * deep link scrolls/highlights; null on rows without one.
   */
  eventKey: string | null;
  /**
   * Deep link to an employee follow-up subject. `list()` exposes it to the
   * recipient authorized for that subject: the responsible employee, or a
   * manager for monitor-directed rows (creations / escalations).
   */
  followUpSubjectId: string | null;
  /** The linked contact card's type, when the row points at a contact. */
  contactType: ContactType | null;
  /** The CURRENT code of the linked property (the stored body is history). */
  propertyReference: string | null;
}

/**
 * Privacy-safe shape returned to the OWNING user only.
 *
 * `message` is the stored `body`; the recipient (`userId`) is never echoed back
 * because it is always the authenticated caller. `propertyId` is nulled by the
 * serializer when the caller is not authorized to open the linked property, so
 * the UI can never render a link to a record it cannot read.
 */
/**
 * Manager-only, read-time context for a potential-duplicate notification.
 * Resolved from the linked property + latest approval request so BOTH new and
 * already-stored rows render human-readable codes/names (never raw UUIDs).
 * Every field is optional; unavailable data is simply omitted.
 */
export interface NotificationDuplicateContextDto {
  newPropertyReference: string | null;
  existingPropertyReference: string | null;
  employeeName: string | null;
  status: PropertyStatus | null;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  /** Authorized property to open, or null when the reader may not open it. */
  propertyId: string | null;
  /**
   * The CURRENT code of the linked property. A historical notification body may
   * still carry a retired code; the current one is always resolved from the
   * property row, and the stored history is never rewritten.
   */
  propertyReference: string | null;
  /** Authorized record targets for the bell's deep link. Managers receive the
   * record events, and a manager is authorized to open any client/contact. */
  clientId: string | null;
  contactId: string | null;
  contactType: ContactType | null;
  followUpId: string | null;
  /** Client review deep link (requester or manager only, by construction). */
  clientReviewId: string | null;
  /**
   * The stored per-recipient dedup key (`FOLLOWUP_CREATED:<entryId>` on
   * follow-up rows) — the deep link's entry target; null when absent.
   */
  eventKey: string | null;
  /**
   * Employee follow-up subject deep link. Exposed to the recipient that may
   * open it (the responsible employee, or the monitoring manager for the
   * rows addressed to managers) and masked for every other caller.
   */
  followUpSubjectId: string | null;
  /** Manager-only human-readable potential-duplicate context, or null. */
  duplicate: NotificationDuplicateContextDto | null;
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

export function toNotificationDto(
  row: NotificationRow,
  propertyId: string | null,
  followUpSubjectId: string | null = null,
  duplicate: NotificationDuplicateContextDto | null = null,
): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.body,
    propertyId,
    propertyReference: row.propertyReference,
    clientId: row.clientId,
    contactId: row.contactId,
    contactType: row.contactType,
    followUpId: row.followUpId,
    clientReviewId: row.clientReviewId,
    eventKey: row.eventKey,
    followUpSubjectId,
    duplicate,
    read: row.readAt !== null,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
