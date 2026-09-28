import { PropertiesSegmentedTabs as SegmentedTabs } from '../../manager-properties/components/properties-segmented-tabs';
import { tabs, filterNotifications, type EmployeeNotification } from '../model';
import styles from '../../manager-notifications/components/notifications.module.css';
export function EmployeeNotificationFilters({
  items,
  value,
  onChange,
}: {
  items: EmployeeNotification[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={styles.filters}>
      <SegmentedTabs
        id="employee-notifications"
        label="فلترة الإشعارات"
        value={value}
        onChange={onChange}
        items={tabs.map((tab) => ({
          ...tab,
          count: filterNotifications(items, tab.id).length,
        }))}
      />
    </div>
  );
}
