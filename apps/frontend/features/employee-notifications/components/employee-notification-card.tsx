import type { NotificationDto } from '../../../lib/api/notification-types';
import {
  displayDate,
  notificationTypeLabel,
  resolvePropertyCode,
} from '../../notifications/view';
import styles from './employee-notifications.module.css';

export function EmployeeNotificationCard({
  item,
  onOpen,
}: {
  item: NotificationDto;
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
        <span className={styles.description}>
          {resolvePropertyCode(item.message, item.propertyReference)}
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
