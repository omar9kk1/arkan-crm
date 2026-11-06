import type { NotificationDto } from '../../../lib/api/notification-types';
import {
  displayDate,
  notificationDisplay,
  notificationTypeLabel,
} from '../../notifications/view';
import styles from './employee-notifications.module.css';

export function EmployeeNotificationCard({
  item,
  onOpen,
}: {
  item: NotificationDto;
  onOpen: () => void;
}) {
  const view = notificationDisplay(item);
  return (
    <button
      type="button"
      className={styles.row}
      onClick={onOpen}
      aria-label={
        'تفاصيل ' + view.title + '، ' + (item.read ? 'مقروء' : 'غير مقروء')
      }
    >
      <span
        className={styles.indicator}
        data-unread={!item.read}
        aria-hidden="true"
      />
      <span className={styles.body}>
        <span className={styles.title}>{view.title}</span>
        <span className={styles.description}>
          {view.message}
        </span>
        <span className={styles.category}>
          {notificationTypeLabel(item.type)}
        </span>
      </span>
      <time className={styles.date} dateTime={item.createdAt}>
        {displayDate(item.createdAt)}
      </time>
    </button>
  );
}
