import { PropertiesSegmentedTabs as SegmentedTabs } from '../../manager-properties/components/properties-segmented-tabs';
import {
  filterNotifications,
  type ManagerNotification,
  type NotificationFilter,
} from '../notifications-model';
import styles from './notifications.module.css';
export const notificationFilters: { id: NotificationFilter; label: string }[] =
  [
    { id: 'all', label: 'الكل' },
    { id: 'unread', label: 'غير مقروء' },
    { id: 'property', label: 'عقارات' },
    { id: 'followup', label: 'متابعات' },
    { id: 'deal', label: 'صفقات وعمولات' },
    { id: 'attendance', label: 'حضور وانصراف' },
  ];
export function NotificationFilters({
  items,
  value,
  onChange,
}: {
  items: readonly ManagerNotification[];
  value: NotificationFilter;
  onChange: (value: NotificationFilter) => void;
}) {
  return (
    <div className={styles.filters}>
      <SegmentedTabs
        id="notifications"
        label="فلترة الإشعارات"
        value={value}
        onChange={(value) => onChange(value as NotificationFilter)}
        items={notificationFilters.map((filter) => ({
          ...filter,
          count: filterNotifications(items, filter.id).length,
        }))}
      />
    </div>
  );
}
