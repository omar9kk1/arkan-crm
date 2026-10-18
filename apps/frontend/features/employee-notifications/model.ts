import type { NotificationDto } from '../../lib/api/notification-types';

/**
 * The employee Notifications page reads the REAL notification store — there is
 * no local `samples` array any more. `tabs` keeps the original filter bar; each
 * tab maps to persisted backend events where they exist, and renders as a
 * genuine empty set where they do not (follow-ups and manager messages have no
 * backend events yet).
 */
export type EmployeeFilter =
  | 'all'
  | 'unread'
  | 'followups'
  | 'properties'
  | 'manager'
  | 'reviews';

export const tabs: { id: EmployeeFilter; label: string }[] = [
  { id: 'all', label: 'الكل' },
  { id: 'unread', label: 'غير مقروء' },
  { id: 'followups', label: 'متابعات' },
  { id: 'properties', label: 'عقارات' },
  { id: 'manager', label: 'رسائل المدير' },
  { id: 'reviews', label: 'مراجعات العقارات' },
];

/** Whether one stored notification belongs in the given employee tab. */
export function matchesEmployeeFilter(
  item: NotificationDto,
  tab: EmployeeFilter,
): boolean {
  switch (tab) {
    case 'all':
      return true;
    case 'unread':
      return !item.read;
    case 'properties':
      // A property made available to browse in the program.
      return item.type === 'PROPERTY_AVAILABLE';
    case 'reviews':
      // The review outcome of a property this employee submitted.
      return (
        item.type === 'PROPERTY_APPROVED' ||
        item.type === 'PROPERTY_REJECTED' ||
        item.type === 'PROPERTY_CHANGES_REQUESTED'
      );
    default:
      // Follow-ups and manager messages have no backend events.
      return false;
  }
}

export function filterNotifications(
  items: readonly NotificationDto[],
  tab: EmployeeFilter,
): NotificationDto[] {
  return items.filter((item) => matchesEmployeeFilter(item, tab));
}
