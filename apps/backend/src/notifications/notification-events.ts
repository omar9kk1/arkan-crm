import type { ContactType, NotificationType } from '@prisma/client';

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
  /** Reference columns for record events (always null on property events). */
  clientId?: string | null;
  contactId?: string | null;
  followUpId?: string | null;
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
  /**
   * Whether the availability alert announces a NEW property or a property that
   * was edited and approved again. `UPDATED` means the property was already in
   * the program once.
   */
  availabilityKind?: 'NEW' | 'UPDATED';
  /**
   * Whether a MANAGER review request describes an edited property (`UPDATED`)
   * or a property that enters the program for the first time (`NEW`).
   */
  submissionKind?: 'NEW' | 'UPDATED';
  /**
   * The genuinely changed PUBLIC fields of the approved version, already
   * formatted for the body (e.g. `السعر (250,000 ← 300,000)، الوصف`). Never a
   * description text, a contact, a phone number or a review comment.
   */
  changeSummary?: string;
}

/** Exact Arabic copy for every event — one source of truth for the wording. */
export const PROPERTY_EVENT_TITLES = {
  SUBMITTED: 'عقار جديد بانتظار المراجعة',
  CHANGES_REQUESTED: 'مطلوب تعديل بيانات العقار',
  REJECTED: 'تم رفض العقار',
  RESUBMITTED: 'تمت إعادة إرسال عقار للمراجعة',
  RESUBMITTED_UPDATED: 'عقار مُعدّل بانتظار موافقتك',
  APPROVED: 'تمت الموافقة على عقارك',
  AVAILABLE: 'عقار جديد متاح في البرنامج',
  AVAILABLE_UPDATED: 'تم تعديل عقار وأصبح متاحًا',
} as const;

/**
 * Short message shown under the title.
 *
 * Built ONLY from the property reference code, which the UI already shows to the
 * recipient. It deliberately excludes the owner/broker contact, phone numbers,
 * the manager's review reason and every other private field, so a notification
 * can never become a side channel for data the recipient may not read.
 */
export function propertyEventBody(
  reference: string,
  changeSummary?: string,
): string {
  const base = `رقم العقار: ${reference}`;
  return changeSummary ? `${base} — التعديلات: ${changeSummary}` : base;
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
  available: (
    approvalRequestId: string | null,
    propertyId: string,
    version: number,
  ) =>
    // The availability alert belongs to ONE approval round, not to the property
    // itself: a property that is approved again after a reject/resubmit cycle
    // is a genuinely new transition and must reach the employees again. The
    // `approvalRequestId` is that round, so a retried approval of the SAME
    // round still deduplicates.
    `PROPERTY_AVAILABLE:${
      approvalRequestId ?? `${propertyId}:v${version}`
    }`,
} as const;

// ---------------------------------------------------------------------------
// Employee record activity (clients, follow-ups, contacts, property interests)
// ---------------------------------------------------------------------------

/** Employee save events reported to the managers. */
export type EmployeeRecordEvent =
  | 'CLIENT_CREATED'
  | 'CLIENT_UPDATED'
  | 'CLIENT_INTEREST_UPDATED'
  | 'FOLLOWUP_CREATED'
  | 'CONTACT_CREATED'
  | 'CONTACT_UPDATED';

/**
 * Which record the event points at, for the `Notification` reference columns
 * and the bell's deep link. At most one target is set:
 *   - client/follow-up/interest events set `clientId`;
 *   - follow-up events may also set `followUpId`;
 *   - contact events set `contactId` (+ the contact's type for the wording).
 */
export interface RecordEventContext {
  clientId?: string;
  followUpId?: string;
  contactId?: string;
  contactType?: ContactType;
  /** Refined wording for the client-creation event (persisted data only). */
  clientIntent?: ClientIntent;
}

/** Exact Arabic title for every record event — one source of truth. */
export const RECORD_EVENT_TITLES: Record<EmployeeRecordEvent, string> = {
  CLIENT_CREATED: 'عميل جديد',
  CLIENT_UPDATED: 'تحديث بيانات عميل',
  CLIENT_INTEREST_UPDATED: 'استفسار عقاري جديد',
  FOLLOWUP_CREATED: 'متابعة جديدة',
  CONTACT_CREATED: 'جهة اتصال جديدة',
  CONTACT_UPDATED: 'تحديث جهة اتصال',
};

/**
 * Why the new client contacted the bureau.
 *
 * Only `INQUIRY` is ever emitted today: the wizard's `clientType`
 * (BUYER/RENTER/EXCHANGER) lives in the in-memory draft and is NOT part of the
 * validated `POST /clients` payload, so an intent-based title would be a
 * guess from free text. `INQUIRY` is derivable reliably from PERSISTED
 * `ClientPropertyInterest` rows written in the same save. The other kinds are
 * declared for the future, when the creation payload carries a structured
 * request type (owner-approved schema work).
 */
export type ClientIntent = 'BUY' | 'RENT' | 'EXCHANGE' | 'INQUIRY';

const CLIENT_INTENT_TITLES: Record<ClientIntent, string> = {
  BUY: 'عميل جديد — يريد الشراء',
  RENT: 'عميل جديد — يريد الاستئجار',
  EXCHANGE: 'عميل جديد — يريد البدل',
  INQUIRY: 'عميل جديد — استفسار عن عقار',
};

const CLIENT_INTENT_ACTIONS: Record<ClientIntent, string> = {
  BUY: 'عميلًا يبحث عن عقار للشراء',
  RENT: 'عميلًا يبحث عن عقار للإيجار',
  EXCHANGE: 'عميلًا يبحث عن عقار للبدل',
  INQUIRY: 'عميلًا يسأل عن عقار في البرنامج',
};

/** The exact title for one record event, with the client-create variants. */
export function recordEventTitle(
  event: EmployeeRecordEvent,
  clientIntent?: ClientIntent,
): string {
  if (event === 'CLIENT_CREATED' && clientIntent)
    return CLIENT_INTENT_TITLES[clientIntent];
  return RECORD_EVENT_TITLES[event];
}

/**
 * Short, privacy-safe message: employee name + action + record type, and
 * nothing else. It deliberately excludes the client's or contact's phone,
 * notes and description so the bell can never become a side channel.
 */
export function recordEventBody(
  actorName: string,
  event: EmployeeRecordEvent,
  contactType?: ContactType,
  clientIntent?: ClientIntent,
): string {
  const actor = actorName.trim() || 'موظف';
  if (event === 'CLIENT_CREATED') {
    const action = clientIntent ? CLIENT_INTENT_ACTIONS[clientIntent] : 'عميلًا جديدًا';
    return `${actor} — أضاف ${action}`;
  }
  const kind: string = contactType === 'BROKER' ? 'وسيط' : 'مالك';
  switch (event) {
    case 'CLIENT_UPDATED':
      return `${actor} — عدّل بيانات عميل`;
    case 'CLIENT_INTEREST_UPDATED':
      return `${actor} — سجّل استفسارًا عقاريًا لعميل`;
    case 'FOLLOWUP_CREATED':
      return `${actor} — سجّل متابعة لعميل`;
    case 'CONTACT_CREATED':
      return `${actor} — سجّل جهة اتصال (${kind})`;
    case 'CONTACT_UPDATED':
      return `${actor} — عدّل جهة اتصال (${kind})`;
  }
}

/**
 * Per-recipient deduplication keys for record events.
 *
 * Birth events (client created, follow-up created, contact created) key on the
 * immutable row id, so the same record birth can never notify twice. Repeated
 * edits of the SAME row are genuinely new activity, so update events carry an
 * occurrence suffix instead of the row id (each committed save is one
 * occurrence; a rolled-back transaction writes nothing at all).
 */
export const recordEventKeys = {
  birth: (event: EmployeeRecordEvent, entityId: string) =>
    `${event}:${entityId}`,
  occurrence: (event: EmployeeRecordEvent, entityId: string, nonce: string) =>
    `${event}:${entityId}:${nonce}`,
} as const;
