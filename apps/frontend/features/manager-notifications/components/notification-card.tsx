import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import type { NotificationDto } from '../../../lib/api/notification-types';
import {
  displayDate,
  notificationDisplay,
  notificationTypeLabel,
} from '../../notifications/view';
import styles from './notifications.module.css';

export function NotificationCard({
  item,
  onOpen,
}: {
  item: NotificationDto;
  onOpen: () => void;
}) {
  const view = notificationDisplay(item);
  return (
    <Card
      className={`${styles.card} ${!item.read ? styles.unread : ''}`}
      onClick={onOpen}
    >
      <div>
        <h3>{view.title}</h3>
        <p>{view.message}</p>
        {view.details.length > 0 && (
          <div className={styles.duplicateDetails}>
            {view.details.map((detail) => (
              <div key={detail.label} className={styles.duplicateRow}>
                <span className={styles.duplicateLabel}>{detail.label}</span>
                {detail.code ? (
                  <bdi className={styles.duplicateCode}>{detail.value}</bdi>
                ) : (
                  <span>{detail.value}</span>
                )}
              </div>
            ))}
          </div>
        )}
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
