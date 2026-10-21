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
const PROPERTY_CODE_PATTERN = /\b(?:AK-\d{6}-[0-9A-Fa-f]{10}|A-\d{6})\b/g;

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
