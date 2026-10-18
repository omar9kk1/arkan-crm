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
};

/** Human label for a stored notification type. */
export function notificationTypeLabel(type: NotificationTypeApi): string {
  return NOTIFICATION_TYPE_LABELS[type] ?? 'إشعار';
}

/** The property event family — the only events the backend currently persists. */
export function isPropertyNotification(type: NotificationTypeApi): boolean {
  return type.startsWith('PROPERTY_');
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
