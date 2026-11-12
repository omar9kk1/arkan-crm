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
  /** Deep-link column for client review workflow rows. */
  clientReviewId?: string | null;
  /**
   * Deduplication key for one occurrence of one event. Combined with `userId` in
   * a database unique index, so the same event can never notify the same person
   * twice.
   */
  eventKey: string;
  /**
   * Employee follow-up escalation deep link (nullable — every other event type
   * leaves it unset). The recipient is the subject's responsible employee by
   * construction; the inbox masks the column for managers.
   */
  followUpSubjectId?: string | null;
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
  REJECTED: 'تم رفض تسجيل العقار',
  TRASHED: 'تم حذف العقار بقرار مالك النظام',
  RESTORED: 'تم استعادة العقار',
  RESUBMITTED: 'تمت إعادة إرسال عقار للمراجعة',
  RESUBMITTED_UPDATED: 'عقار مُعدّل بانتظار موافقتك',
  EDITED: 'تم تعديل عقار تحت المراجعة',
  DUPLICATE_ATTEMPT: 'محاولة تسجيل عقار مكرر',
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
  /**
   * One employee edit of a PENDING property. The version AFTER the save is the
   * occurrence id: a retried request that changed nothing is rejected by the
   * optimistic-version guard, so the same save can never notify twice, while
   * every genuinely new save gets its own key.
   */
  edited: (propertyId: string, version: number) =>
    `PROPERTY_EDITED:${propertyId}:v${version}`,
  /**
   * One blocked registration attempt against an existing property. The
   * fingerprint covers the real identifying fields, so an identical retry is
   * deduplicated while a materially changed attempt becomes a new event.
   */
  duplicateAttempt: (
    propertyId: string,
    employeeId: string,
    fingerprint: string,
  ) =>
    `DUPLICATE_ATTEMPT:${propertyId}:${employeeId}:${fingerprint}`,
  changesRequested: (approvalRequestId: string | null, propertyId: string) =>
    `PROPERTY_CHANGES_REQUESTED:${approvalRequestId ?? propertyId}`,
  rejected: (approvalRequestId: string | null, propertyId: string) =>
    `PROPERTY_REJECTED:${approvalRequestId ?? propertyId}`,
  trashed: (propertyId: string) => `PROPERTY_TRASHED:${propertyId}`,
  restored: (propertyId: string, trashedAt: Date) =>
    `PROPERTY_RESTORED:${propertyId}:${trashedAt.getTime()}`,
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
  /**
   * The privacy-safe Arabic summary of the changed client fields, built by the
   * writer itself (e.g. `الاسم: من أحمد إلى محمد، تم تغيير رقم الهاتف`).
   * Value contents are shown ONLY for plain identity fields — the phone, the
   * notes and the responsible employee never travel, only the fact that they
   * changed.
   */
  clientChangeSummary?: string;
}

/** Exact Arabic title for every record event — one source of truth. */
export const RECORD_EVENT_TITLES: Record<EmployeeRecordEvent, string> = {
  CLIENT_CREATED: 'عميل جديد',
  CLIENT_UPDATED: 'تم تعديل بيانات عميل',
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
  clientChangeSummary?: string,
): string {
  const actor = actorName.trim() || 'موظف';
  if (event === 'CLIENT_CREATED') {
    const action = clientIntent ? CLIENT_INTENT_ACTIONS[clientIntent] : 'عميلًا جديدًا';
    return `${actor} — أضاف ${action}`;
  }
  const kind: string = contactType === 'BROKER' ? 'وسيط' : 'مالك';
  switch (event) {
    case 'CLIENT_UPDATED':
      // The summary lists the REAL changed field names, with old → new values
      // for the safe concise ones; sensitive fields appear as a fact only.
      return clientChangeSummary
        ? `${actor} — عدّل: ${clientChangeSummary}`
        : `${actor} — عدّل بيانات عميل`;
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

// ---------------------------------------------------------------------------
// Employee follow-up save (the manager fan-out wording)
// ---------------------------------------------------------------------------

/** Follow-up subject categories; plain duplicates of the follow-up store's. */
export type FollowUpEventSubjectKind =
  'PROPERTY_OWNER' | 'CLIENT_REQUEST' | 'INQUIRY' | 'CLIENT';

/** The structured wizard request type that one `CLIENT_REQUEST` subject keys on. */
export type FollowUpEventRequestType = 'BUYER' | 'RENTER' | 'EXCHANGER';

/**
 * What the follow-up writer already knows about ONE committed subject.
 * Everything is authoritative persisted data (the target key's own structure,
 * the related row's fields) — never inferred from free text or a name.
 */
export interface FollowUpEventSubject {
  kind: FollowUpEventSubjectKind;
  requestType?: FollowUpEventRequestType | null;
  /** The person's OWN registry type (owner vs broker contact card). */
  personType?: ContactType | null;
  /** Human name of the actual person the follow-up is WITH (never a phone). */
  personName?: string | null;
  /** The subject's property code (`A-000123`), when one exists. */
  propertyReference?: string | null;
}

/** Neutral wording when the subject carries no classifiable identity at all. */
const FOLLOWUP_CREATED_FALLBACK = 'متابعة جديدة';

const FOLLOWUP_REQUEST_PERSON_ROLES: Record<FollowUpEventRequestType, string> =
  {
    BUYER: 'المشتري',
    RENTER: 'المستأجر',
    EXCHANGER: 'مبدل عقار',
  };

const FOLLOWUP_REQUEST_DETAILS: Record<FollowUpEventRequestType, string> = {
  BUYER: 'طلب شراء',
  RENTER: 'طلب إيجار',
  EXCHANGER: 'طلب بدل',
};

/**
 * The exact body of the employee-follow-up notification: WHICH person the
 * follow-up is with (real role + name from persisted data) and WHICH record it
 * concerns (property code / structured request), never a blanket «عميل».
 *
 * Categories with no reliable identity fall back to the neutral
 * «متابعة جديدة» — a legacy/ambiguous subject is never shoehorned into one
 * wrong category. Phones, notes and review text never travel; the name and
 * property code are already visible to every manager in the authorized feed.
 */
export function followUpCreatedBody(
  actorName: string,
  subject: FollowUpEventSubject,
): string {
  const actor = actorName.trim() || 'موظف';
  const name = subject.personName?.trim() || null;
  const reference = subject.propertyReference?.trim() || null;

  if (
    subject.kind === 'PROPERTY_OWNER' &&
    (subject.personType === 'OWNER' || subject.personType === 'BROKER')
  ) {
    // The person's OWN registry type decides مالك/وسيط; the subject type alone
    // (owner-side property) never does.
    const role = subject.personType === 'BROKER' ? 'الوسيط' : 'المالك';
    const phrase = name ? `${role} ${name}` : role;
    // The owner example carries its property code; the broker sentence stays
    // as specified.
    const detail =
      subject.personType === 'OWNER' && reference
        ? ` بخصوص العقار ${reference}`
        : '';
    return `سجّل ${actor} متابعة مع ${phrase}${detail}.`;
  }

  if (
    subject.kind === 'CLIENT_REQUEST' &&
    subject.requestType &&
    subject.requestType in FOLLOWUP_REQUEST_PERSON_ROLES
  ) {
    const type = subject.requestType;
    const role = FOLLOWUP_REQUEST_PERSON_ROLES[type];
    const phrase = name ? `${role} ${name}` : role;
    return `سجّل ${actor} متابعة مع ${phrase} بخصوص ${FOLLOWUP_REQUEST_DETAILS[type]}.`;
  }

  if (subject.kind === 'INQUIRY') {
    const phrase = name ? `العميل ${name}` : 'العميل';
    const detail = reference
      ? `بخصوص استفسار العقار ${reference}`
      : 'بخصوص استفسار';
    return `سجّل ${actor} متابعة مع ${phrase} ${detail}.`;
  }

  // Legacy `CLIENT` subjects, malformed keys and any unknown shape: the
  // neutral fallback, never a guessed category.
  return name
    ? `سجّل ${actor} ${FOLLOWUP_CREATED_FALLBACK} مع ${name}.`
    : `سجّل ${actor} ${FOLLOWUP_CREATED_FALLBACK}.`;
}

// ---------------------------------------------------------------------------
// Client review workflow (employee submissions awaiting manager approval)
// ---------------------------------------------------------------------------

/** Client review workflow events. */
export type ClientReviewEvent =
  | 'CLIENT_REVIEW_SUBMITTED'
  | 'CLIENT_REVIEW_RESUBMITTED'
  | 'CLIENT_REVIEW_APPROVED'
  | 'CLIENT_REVIEW_REJECTED'
  | 'CLIENT_REVIEW_CHANGES_REQUESTED';

export type ClientReviewDecision = 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';

/** Exact Arabic copy — one source of truth for the wording. */
export const CLIENT_REVIEW_TITLES = {
  SUBMITTED: 'طلب عميل بانتظار المراجعة',
  RESUBMITTED: 'طلب عميل أعيد إرساله للمراجعة',
  APPROVED_CREATION: 'تمت الموافقة على إضافة عميل',
  APPROVED_EDIT: 'تمت الموافقة على تعديل بيانات عميل',
  REJECTED: 'تم رفض طلب العميل',
  CHANGES_REQUESTED: 'مطلوب تعديل طلب العميل',
} as const;

/**
 * The short privacy-safe body of a submission/resubmission event for the
 * managers. It names the requester (already a visible manager fact), states
 * the fact, and may carry the same privacy-consistent change summary the
 * review UI shows — values for safe identity fields only, and NEVER a phone
 * number, a note text or a submission note.
 */
export function clientReviewManagerBody(
  actorName: string,
  event: 'CLIENT_REVIEW_SUBMITTED' | 'CLIENT_REVIEW_RESUBMITTED',
  kind: 'CREATION' | 'EDIT',
  changeSummary?: string,
): string {
  const actor = actorName.trim() || 'موظف';
  const action =
    event === 'CLIENT_REVIEW_RESUBMITTED'
      ? kind === 'CREATION'
        ? 'أعد إرسال طلب عميل للمراجعة'
        : 'أعد إرسال تعديلات عميل للمراجعة'
      : kind === 'CREATION'
        ? 'أرسل طلب إضافة عميل جديد'
        : 'أرسل تعديلات على بيانات عميل';
  return changeSummary ? `${actor} — ${action} — ${changeSummary}` : `${actor} — ${action}`;
}

/**
 * The short body of a decision event for the requesting employee: the FACT of
 * the decision only — never the reviewer's name, never a replay of the data.
 */
export function clientReviewDecisionBody(
  decision: ClientReviewDecision,
  kind: 'CREATION' | 'EDIT',
): string {
  switch (decision) {
    case 'APPROVED':
      return kind === 'CREATION'
        ? 'وافقت الإدارة على طلب إضافة العميل.'
        : 'وافقت الإدارة على تعديلات بيانات العميل.';
    case 'REJECTED':
      return 'رُفض طلب العميل. راجع ملاحظات المراجعة.';
    case 'CHANGES_REQUESTED':
      return 'مطلوب تعديل طلب العميل قبل اعتماده.';
  }
}

/** Deduplication keys of the review events (per real occurrence). */
export const clientReviewEventKeys = {
  submission: (
    event: 'CLIENT_REVIEW_SUBMITTED' | 'CLIENT_REVIEW_RESUBMITTED',
    reviewId: string,
    nonce: string,
  ) => `${event}:${reviewId}:${nonce}`,
  decision: (
    decision: ClientReviewDecision,
    reviewId: string,
  ) => `CLIENT_REVIEW_DECIDED:${reviewId}:${decision}`,
} as const;

// ---------------------------------------------------------------------------
// Employee follow-ups late escalations (background scheduler)
// ---------------------------------------------------------------------------

/** Follow-up escalation events (task §7). */
export type FollowUpLateEvent = 'FOLLOWUP_EMPLOYEE_LATE' | 'FOLLOWUP_MANAGER_ESCALATION';

/** Exact Arabic copy — one source of truth for the wording. */
export const FOLLOWUP_EVENT_TITLES: Record<FollowUpLateEvent, string> = {
  FOLLOWUP_EMPLOYEE_LATE: 'متابعة متأخرة',
  FOLLOWUP_MANAGER_ESCALATION: 'تأخر متابعة موظف',
};

/**
 * The employee's own warning body: WHICH person/property/request needs the
 * follow-up and for how long it is late (task §7). The recipient is the
 * subject's responsible employee — the person already authorized to read that
 * exact subject — so naming the person/property here is not a side channel.
 */
export function followUpEmployeeBody(
  label: string,
  overdueDuration: string,
): string {
  return `${label} — متابعة متأخرة ${overdueDuration} عن موعدها.`;
}

/**
 * The manager escalation body: responsible employee, authorized subject
 * identity, due date (Kuwait day) and lateness duration (task §7). Recipients
 * are the active managers, who are authorized for company records by design.
 */
export function followUpManagerBody(input: {
  employeeName: string;
  label: string;
  dueDay: string;
  overdueDuration: string;
}): string {
  const employee = input.employeeName.trim() || 'موظف';
  return `${employee} — متابعة متأخرة: ${input.label}، استحقت ${input.dueDay}، متأخر ${input.overdueDuration}.`;
}

/**
 * Per-recipient deduplication keys: one key per SUBJECT per CYCLE. The cycle
 * counter only advances when a genuinely new follow-up note is saved, so the
 * same threshold can never notify twice within a cycle — retries, duplicate
 * jobs and restarts all collapse into the same `(userId, eventKey)` unique.
 */
export const followUpEventKeys = {
  employeeLate: (subjectId: string, cycle: number) =>
    `FOLLOWUP_EMPLOYEE_LATE:${subjectId}:${cycle}`,
  managerEscalation: (subjectId: string, cycle: number) =>
    `FOLLOWUP_MANAGER_ESCALATION:${subjectId}:${cycle}`,
} as const;

// ---------------------------------------------------------------------------
// Manual manager reminder of ONE overdue employee follow-up
// ---------------------------------------------------------------------------

/** Exact Arabic title of the manual reminder event. */
export const FOLLOWUP_REMINDER_TITLE = 'تذكير من الإدارة' as const;

/**
 * The reminder body: WHO is reminding (the actual manager), WHICH subject and
 * for how long it has been overdue (task §6: identity + duration, never a
 * fabricated conversation). The recipient is the subject's responsible
 * employee — the only person authorized for the subject — so the wording is
 * not a side channel for anyone else's data.
 */
export function followUpReminderBody(input: {
  managerName: string;
  hint: string;
  overdueDuration: string;
}): string {
  const manager = input.managerName.trim() || 'الإدارة';
  return `${manager} يذكّرك بمتابعة متأخرة: ${input.hint} — متأخرة ${input.overdueDuration} عن موعدها.`;
}

/**
 * The reminder's cooldown-window dedup keys — one key per SUBJECT per window,
 * shared by the `FollowUpReminder` audit row and the `Notification` row. Two
 * concurrent clicks land on ONE window, and the database unique keys collapse
 * them into a single sent reminder (persistent server-side throttling §6).
 */
export function followUpReminderEventKey(subjectId: string, window: number): string {
  return `FOLLOWUP_EMPLOYEE_REMINDER:${subjectId}:${window}`;
}
