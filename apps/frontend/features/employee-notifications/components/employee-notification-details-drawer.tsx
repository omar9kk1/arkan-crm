import { Toast } from '../../../components/ui/toast';
import { useState } from 'react';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { Button } from '../../../components/ui/button';
import type { NotificationDto } from '../../../lib/api/notification-types';
import {
  displayDate,
  isDecisionNotification,
  notificationDisplay,
  notificationTypeLabel,
} from '../../notifications/view';
import styles from '../../manager-notifications/components/notifications.module.css';

/**
 * The employee notification drawer, rebuilt on the LIVE notification shape. It
 * shows the stored type, message, timestamp and read state plus the one real
 * action — opening the linked property — instead of the removed mock fields.
 */
export function EmployeeNotificationDetailsDrawer({
  item,
  onClose,
  onRead,
  onOpenProperty,
}: {
  item: NotificationDto;
  onClose: () => void;
  onRead: () => void;
  onOpenProperty: (propertyId: string) => void;
}) {
  const [notice, setNotice] = useState('');
  const view = notificationDisplay(item);
  return (
    <PropertyOverlay title={view.title} drawer onClose={onClose}>
      <div className={styles.badges}>
        <span className={styles.badge}>
          {notificationTypeLabel(item.type)}
        </span>
        <span className={styles.badge}>
          {item.read ? 'مقروء' : 'غير مقروء'}
        </span>
      </div>
      <p className={styles.messageBody}>{view.message}</p>
      {isDecisionNotification(item) && !item.propertyId && (
        <p className={styles.decisionUnavailable} role="status">
          تفاصيل العقار لم تعد متاحة بعد الحذف النهائي.
        </p>
      )}
      <dl className={styles.facts}>
        {(
          [
            ['النوع', notificationTypeLabel(item.type)],
            ['التاريخ', displayDate(item.createdAt)],
            ['الحالة', item.read ? 'مقروء' : 'غير مقروء'],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.actions}>
        <Button
          disabled={item.read}
          onClick={() => {
            onRead();
            setNotice('تم تعليم الإشعار كمقروء');
          }}
        >
          تعليم كمقروء
        </Button>
        <Button
          disabled={!item.propertyId}
          onClick={() => {
            if (item.propertyId) onOpenProperty(item.propertyId);
          }}
        >
          فتح العقار
        </Button>
        <Button onClick={onClose}>إغلاق</Button>
      </div>
      <Toast message={notice} onDismiss={() => setNotice('')} />
    </PropertyOverlay>
  );
}
