import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import {
  categories,
  displayDate,
  type ManagerNotification,
} from '../notifications-model';
import { NotificationPriorityBadge } from './notification-priority-badge';
import styles from './notifications.module.css';
export function NotificationCard({
  item,
  onOpen,
}: {
  item: ManagerNotification;
  onOpen: () => void;
}) {
  return (
    <Card
      className={`${styles.card} ${!item.read ? styles.unread : ''}`}
      onClick={onOpen}
    >
      <div>
        <h3>{item.title}</h3>
        <p>{item.description}</p>
        <div className={styles.badges}>
          <span className={styles.badge}>{categories[item.category]}</span>
          <span className={styles.badge}>
            {item.read ? 'مقروء' : 'غير مقروء'}
          </span>
          <NotificationPriorityBadge priority={item.priority} />
        </div>
      </div>
      <div className={styles.meta}>
        <time dateTime={item.date}>{displayDate(item.date)}</time>
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
