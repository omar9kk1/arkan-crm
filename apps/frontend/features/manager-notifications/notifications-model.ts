import type { NotificationDto } from '../../lib/api/notification-types';
import { isPropertyNotification } from '../notifications/view';

/**
 * The manager Notifications page reads the REAL notification store. There is no
 * local mock array any more: every row comes from `GET /notifications` for the
 * signed-in manager.
 *
 * `ManagerFilter` keeps the original filter bar intact. Only the `property`
 * bucket currently maps to backend events a manager receives (a submission or a
 * resubmission awaiting review); the other buckets have no supported events, so
 * they render as genuinely empty rather than with invented content.
 */
export type ManagerFilter =
  | 'all'
  | 'unread'
  | 'property'
  | 'followup'
  | 'deal'
  | 'attendance';

/** The manager filter bar, preserved from the original design. */
export const notificationFilters: { id: ManagerFilter; label: string }[] = [
  { id: 'all', label: 'الكل' },
  { id: 'unread', label: 'غير مقروء' },
  { id: 'property', label: 'عقارات' },
  { id: 'followup', label: 'متابعات' },
  { id: 'deal', label: 'صفقات وعمولات' },
  { id: 'attendance', label: 'حضور وانصراف' },
];

/** Whether one stored notification belongs in the given manager tab. */
export function matchesManagerFilter(
  item: NotificationDto,
  filter: ManagerFilter,
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'unread':
      return !item.read;
    case 'property':
      return isPropertyNotification(item.type);
    case 'followup':
      // The real backend follow-up activity of the employees.
      return item.type === 'FOLLOWUP_CREATED';
    default:
      // Deals/commissions and attendance have no backend events.
      return false;
  }
}

export function filterManagerNotifications(
  items: readonly NotificationDto[],
  filter: ManagerFilter,
): NotificationDto[] {
  return items.filter((item) => matchesManagerFilter(item, filter));
}

/** Properties still awaiting this manager's review — the real review-queue count. */
export function awaitingReviewCount(items: readonly NotificationDto[]): number {
  return items.filter(
    (item) =>
      !item.read &&
      (item.type === 'PROPERTY_SUBMITTED' ||
        item.type === 'PROPERTY_RESUBMITTED'),
  ).length;
}
