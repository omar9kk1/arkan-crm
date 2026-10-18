import { PropertiesSegmentedTabs as SegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
import type { NotificationDto } from '../../../lib/api/notification-types';
import { tabs, filterNotifications, type EmployeeFilter } from '../model';
import styles from '../../manager-notifications/components/notifications.module.css';

export function EmployeeNotificationFilters({
  items,
  value,
  onChange,
}: {
  items: readonly NotificationDto[];
  value: EmployeeFilter;
  onChange: (value: EmployeeFilter) => void;
}) {
  return (
    <div className={styles.filters}>
      <SegmentedTabs
        id="employee-notifications"
        label="فلترة الإشعارات"
        value={value}
        onChange={(value) => onChange(value as EmployeeFilter)}
        items={tabs.map((tab) => ({
          ...tab,
          // Real counts: a bucket without backend events is genuinely zero.
          count: filterNotifications(items, tab.id).length,
        }))}
      />
    </div>
  );
}
