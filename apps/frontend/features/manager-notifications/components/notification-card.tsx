import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import type { NotificationDto } from '../../../lib/api/notification-types';
import {
  displayDate,
  notificationTypeLabel,
  resolvePropertyCode,
} from '../../notifications/view';
import styles from './notifications.module.css';

export function NotificationCard({
  item,
  onOpen,
}: {
  item: NotificationDto;
  onOpen: () => void;
}) {
  return (
    <Card
      className={`${styles.card} ${!item.read ? styles.unread : ''}`}
      onClick={onOpen}
    >
      <div>
        <h3>{item.title}</h3>
        <p>{resolvePropertyCode(item.message, item.propertyReference)}</p>
        <div className={styles.badges}>
          <span className={styles.badge}>
            {notificationTypeLabel(item.type)}
          </span>
          <span className={styles.badge}>
            {item.read ? 'مقروء' : 'غير مقروء'}
          </span>
        </div>
      </div>
      <div className={styles.meta}>
        <time dateTime={item.createdAt}>{displayDate(item.createdAt)}</time>
        <Button
          aria-label={`تفاصيل: ${item.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          تفاصيل
        </Button>
      </div>
    </Card>
  );
}
