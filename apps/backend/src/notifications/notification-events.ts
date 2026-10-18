import type { NotificationType } from '@prisma/client';

/**
 * A single notification ready to be written inside the caller's transaction.
 *
 * The field names intentionally mirror the `Notification` columns minus the
 * recipient relation, so a draft can be inserted verbatim with `createMany`.
 */
export interface NotificationDraft {
  userId: string;
  type: NotificationType;
  title: string;
  /** Short, privacy-safe message (never a name, phone, note or review text). */
  body: string;
  propertyId: string | null;
  /**
   * Deduplication key for one occurrence of one event. Combined with `userId` in
   * a database unique index, so the same event can never notify the same person
   * twice.
   */
  eventKey: string;
}

/**
 * The context a property state transition hands to the notification builders.
 * `approvalRequestId` identifies the specific review round so the deduplication
 * keys of two different rounds never collide.
 */
export interface PropertyEventContext {
  propertyId: string;
  /** Property reference code (`AK-...`) — already visible in the UI, never private. */
  reference: string;
  /** `Property.createdByUserId` — the employee who submitted the property. */
  creatorId: string | null;
  /** The approval-request row this decision belongs to, when one exists. */
  approvalRequestId: string | null;
  /** The property version AFTER the transition (fallback key ingredient). */
  version: number;
}

/** Exact Arabic copy for every event — one source of truth for the wording. */
export const PROPERTY_EVENT_TITLES = {
  SUBMITTED: 'عقار جديد بانتظار المراجعة',
  CHANGES_REQUESTED: 'مطلوب تعديل بيانات العقار',
  REJECTED: 'تم رفض العقار',
  RESUBMITTED: 'تمت إعادة إرسال عقار للمراجعة',
  APPROVED: 'تمت الموافقة على عقارك',
  AVAILABLE: 'عقار جديد متاح في البرنامج',
} as const;

/**
 * Short message shown under the title.
 *
 * Built ONLY from the property reference code, which the UI already shows to the
 * recipient. It deliberately excludes the owner/broker contact, phone numbers,
 * the manager's review reason and every other private field, so a notification
 * can never become a side channel for data the recipient may not read.
 */
export function propertyEventBody(reference: string): string {
  return `رقم العقار: ${reference}`;
}

/**
 * Per-recipient deduplication keys — one key per event occurrence.
 *
 * The `approvalRequestId` is the review round, so a second rejection or a second
 * change request for the same property is a genuinely new event and is kept,
 * while a retried/duplicated transition of the same round deduplicates. The
 * `propertyId`/`version` fallback only applies to the (unreachable in practice)
 * case of an approval with no approval-request row.
 */
export const notificationEventKeys = {
  submitted: (propertyId: string) => `PROPERTY_SUBMITTED:${propertyId}`,
  resubmitted: (approvalRequestId: string | null, propertyId: string) =>
    `PROPERTY_RESUBMITTED:${approvalRequestId ?? propertyId}`,
  changesRequested: (approvalRequestId: string | null, propertyId: string) =>
    `PROPERTY_CHANGES_REQUESTED:${approvalRequestId ?? propertyId}`,
  rejected: (approvalRequestId: string | null, propertyId: string) =>
    `PROPERTY_REJECTED:${approvalRequestId ?? propertyId}`,
  approved: (
    approvalRequestId: string | null,
    propertyId: string,
    version: number,
  ) =>
    `PROPERTY_APPROVED:${
      approvalRequestId ?? `${propertyId}:v${version}`
    }`,
  available: (propertyId: string) => `PROPERTY_AVAILABLE:${propertyId}`,
} as const;
