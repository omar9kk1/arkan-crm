import { displayDate } from '../../manager-notifications/notifications-model';
import { labels, type EmployeeNotification } from '../model';
import shared from '../../manager-notifications/components/notifications.module.css';
import styles from './employee-notifications.module.css';
export function NotificationStatusBadge({ read }: { read: boolean }) {
  return <span className={shared.badge}>{read ? 'مقروء' : 'غير مقروء'}</span>;
}
export function EmployeeNotificationCard({
  item,
  onOpen,
}: {
  item: EmployeeNotification;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.row}
      onClick={onOpen}
      aria-label={
        'تفاصيل ' + item.title + '، ' + (item.read ? 'مقروء' : 'غير مقروء')
      }
    >
      <span
        className={styles.indicator}
        data-unread={!item.read}
        aria-hidden="true"
      />
      <span className={styles.body}>
        <span className={styles.title}>{item.title}</span>
        <span className={styles.description}>{item.description}</span>
        <span className={styles.category}>
          {labels[item.category]}
          {item.priority === 'عاجل' && (
            <span className={styles.urgent}>عاجل</span>
          )}
        </span>
      </span>
      <time className={styles.date} dateTime={item.date}>
        {displayDate(item.date)}
      </time>
    </button>
  );
}
