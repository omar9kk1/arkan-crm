import type { NotificationTypeApi } from '../../lib/api/notification-types';

/**
 * Presentation helpers for the notification PAGES.
 *
 * They describe the REAL backend notifications only: the six property events and
 * `SYSTEM`. Nothing here invents a category, a priority or a message the backend
 * never produced — a page simply renders the stored title, message, type,
 * timestamp and read state.
 */
export const NOTIFICATION_TYPE_LABELS: Record<NotificationTypeApi, string> = {
  PROPERTY_SUBMITTED: 'عقار جديد بانتظار المراجعة',
  PROPERTY_CHANGES_REQUESTED: 'مطلوب تعديل بيانات العقار',
  PROPERTY_REJECTED: 'تم رفض العقار',
  PROPERTY_RESUBMITTED: 'تمت إعادة إرسال عقار للمراجعة',
  PROPERTY_APPROVED: 'تمت الموافقة على العقار',
  PROPERTY_AVAILABLE: 'عقار متاح في البرنامج',
  SYSTEM: 'إشعار النظام',
  CLIENT_CREATED: 'نشاط موظفين',
  CLIENT_UPDATED: 'نشاط موظفين',
  CLIENT_INTEREST_UPDATED: 'نشاط موظفين',
  FOLLOWUP_CREATED: 'نشاط موظفين',
  CONTACT_CREATED: 'نشاط موظفين',
  CONTACT_UPDATED: 'نشاط موظفين',
  FOLLOWUP_EMPLOYEE_LATE: 'متابعة متأخرة',
  FOLLOWUP_MANAGER_ESCALATION: 'تأخر متابعة موظف',
  CLIENT_REVIEW_SUBMITTED: 'طلب عميل جديد',
  CLIENT_REVIEW_RESUBMITTED: 'طلب عميل أعيد إرساله',
  CLIENT_REVIEW_APPROVED: 'تمت موافقة طلب العميل',
  CLIENT_REVIEW_REJECTED: 'رُفض طلب العميل',
  CLIENT_REVIEW_CHANGES_REQUESTED: 'مطلوب تعديل طلب العميل',
};

/** Human label for a stored notification type. */
export function notificationTypeLabel(type: NotificationTypeApi): string {
  return NOTIFICATION_TYPE_LABELS[type] ?? 'إشعار';
}

/** The property event family — the only events the backend currently persists. */
export function isPropertyNotification(type: NotificationTypeApi): boolean {
  return type.startsWith('PROPERTY_');
}

/**
 * A property code inside a stored notification body: the retired
 * `AK-<date>-<hex>` format and the current `A-000001` one.
 */
const PROPERTY_CODE_PATTERN = /\b(?:AK-\d{6}-[0-9A-Fa-f]{10}|A-\d{6}|P-\d{6})\b/g;

/**
 * Shows the CURRENT code of a property in a historical notification.
 *
 * The stored body is immutable history: it may still carry a retired code
 * after the one-time renumbering. The current code is resolved from the
 * property row by the API, so the text is corrected for display only — the
 * stored row is never rewritten.
 */
export function resolvePropertyCode(
  message: string,
  currentReference: string | null | undefined,
): string {
  if (!currentReference) return message;
  return message.replace(PROPERTY_CODE_PATTERN, currentReference);
}

/**
 * Potential-duplicate alerts are identified by their stable event key, so both
 * new and already-stored rows are rendered with the same human-readable copy.
 */
export const DUPLICATE_NOTIFICATION_TITLE = 'عقار مشابه يحتاج إلى مراجعة';
export const DUPLICATE_NOTIFICATION_MESSAGE =
  'تم اكتشاف تشابه محتمل بين عقارين في النظام. يُرجى مراجعة البيانات قبل اتخاذ القرار.';

/** A rejection / manager-deletion decision notification. */
export function isDecisionNotification(item: { eventKey: string | null }): boolean {
  return Boolean(
    item.eventKey?.startsWith('PROPERTY_REJECTED:') ||
      item.eventKey?.startsWith('PROPERTY_TRASHED:'),
  );
}

/**
 * Whether a notification means the property lists may have changed for the
 * recipient. Property-linked rows count even when their type is SYSTEM (the
 * Manager soft-delete decision is exactly that case).
 */
export function notificationAffectsPropertyLists(item: {
  propertyId: string | null;
  type: string;
}): boolean {
  return item.propertyId !== null || item.type.startsWith('PROPERTY_');
}

export function isPotentialDuplicateNotification(
  item: { eventKey: string | null },
): boolean {
  return Boolean(item.eventKey?.startsWith('POTENTIAL_DUPLICATE:'));
}

/** Strips raw UUIDs / technical identifiers from any legacy stored message. */
export function stripInternalIds(message: string): string {
  return message
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      '',
    )
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export interface DuplicateNotificationDetail {
  label: string;
  value: string;
  /** Official property codes render LTR-isolated. */
  code?: boolean;
}

/** Manager-only compact details for a potential-duplicate notification. */
export function duplicateNotificationDetails(item: {
  propertyReference: string | null;
  duplicate?: {
    newPropertyReference: string | null;
    existingPropertyReference: string | null;
    employeeName: string | null;
    status: string | null;
  } | null;
}): DuplicateNotificationDetail[] {
  const details: DuplicateNotificationDetail[] = [];
  const newCode = item.duplicate?.newPropertyReference ?? item.propertyReference;
  if (newCode) details.push({ label: 'العقار الجديد', value: newCode, code: true });
  if (item.duplicate?.existingPropertyReference)
    details.push({
      label: 'العقار المشابه',
      value: item.duplicate.existingPropertyReference,
      code: true,
    });
  if (item.duplicate?.employeeName)
    details.push({ label: 'الموظف', value: item.duplicate.employeeName });
  if (item.duplicate?.status === 'PENDING')
    details.push({ label: 'الحالة', value: 'بانتظار المراجعة' });
  return details;
}

/**
 * One display projection used by every notification surface (bell, manager
 * page/drawer, employee page/drawer). Potential-duplicate rows always render
 * the canonical human-readable copy + compact details; every other row renders
 * its stored message with any raw internal id stripped.
 */
export function notificationDisplay(item: {
  title: string;
  message: string;
  propertyReference: string | null;
  eventKey: string | null;
  duplicate?: {
    newPropertyReference: string | null;
    existingPropertyReference: string | null;
    employeeName: string | null;
    status: string | null;
  } | null;
}): {
  isDuplicate: boolean;
  title: string;
  message: string;
  details: DuplicateNotificationDetail[];
} {
  const isDuplicate = isPotentialDuplicateNotification(item);
  return {
    isDuplicate,
    title: isDuplicate ? DUPLICATE_NOTIFICATION_TITLE : item.title,
    message: isDuplicate
      ? DUPLICATE_NOTIFICATION_MESSAGE
      : stripInternalIds(
          resolvePropertyCode(item.message, item.propertyReference),
        ),
    details: isDuplicate ? duplicateNotificationDetails(item) : [],
  };
}

/**
 * The employee record-activity family — the events managers receive when an
 * employee saves a client, contact, follow-up or property interest. The bell
 * publishes a clients-list refresh exactly for these.
 */
export function isRecordNotification(type: NotificationTypeApi): boolean {
  return (
    type === 'CLIENT_CREATED' ||
    type === 'CLIENT_UPDATED' ||
    type === 'CLIENT_INTEREST_UPDATED' ||
    type === 'FOLLOWUP_CREATED' ||
    type === 'CONTACT_CREATED' ||
    type === 'CONTACT_UPDATED'
  );
}

/** Absolute, locale-aware timestamps for the list rows and drawers. */
export function displayDate(iso: string): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return '';
  return new Intl.DateTimeFormat('ar-KW', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}
