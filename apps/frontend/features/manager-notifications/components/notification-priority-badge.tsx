import type { ManagerNotification } from '../notifications-model';
import styles from './notifications.module.css';
export function NotificationPriorityBadge({
  priority,
}: {
  priority: ManagerNotification['priority'];
}) {
  return (
    <span
      className={`${styles.badge} ${priority === 'عاجل' ? styles.urgent : ''}`}
    >
      الأولوية: {priority}
    </span>
  );
}
