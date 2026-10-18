import { PropertiesSegmentedTabs as SegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
import type { NotificationDto } from '../../../lib/api/notification-types';
import {
  filterManagerNotifications,
  notificationFilters,
  type ManagerFilter,
} from '../notifications-model';
import styles from './notifications.module.css';

export function NotificationFilters({
  items,
  value,
  onChange,
}: {
  items: readonly NotificationDto[];
  value: ManagerFilter;
  onChange: (value: ManagerFilter) => void;
}) {
  return (
    <div className={styles.filters}>
      <SegmentedTabs
        id="notifications"
        label="فلترة الإشعارات"
        value={value}
        onChange={(value) => onChange(value as ManagerFilter)}
        items={notificationFilters.map((filter) => ({
          ...filter,
          // Real counts: a bucket without backend events is genuinely zero.
          count: filterManagerNotifications(items, filter.id).length,
        }))}
      />
    </div>
  );
}
