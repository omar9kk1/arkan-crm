import { Toast } from '../../../components/ui/toast';
import { useState } from 'react';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { Button } from '../../../components/ui/button';
import { NotificationPriorityBadge } from '../../manager-notifications/components/notification-priority-badge';
import { displayDate } from '../../manager-notifications/notifications-model';
import { NotificationStatusBadge } from './employee-notification-card';
import { labels, type EmployeeNotification } from '../model';
import styles from '../../manager-notifications/components/notifications.module.css';
export function EmployeeNotificationDetailsDrawer({
  item,
  onClose,
  onRead,
}: {
  item: EmployeeNotification;
  onClose: () => void;
  onRead: () => void;
}) {
  const [notice, setNotice] = useState('');
  return (
    <PropertyOverlay title={item.title} drawer onClose={onClose}>
      <div className={styles.badges}>
        <NotificationStatusBadge read={item.read} />
        <NotificationPriorityBadge priority={item.priority} />
      </div>
      <p>{item.description}</p>
      <dl className={styles.facts}>
        {[
          ['النوع', labels[item.category]],
          ['المصدر', item.source],
          ['التاريخ', displayDate(item.date)],
          ['العميل / المالك', item.person || 'غير مرتبط'],
          ['العقار', item.property || 'غير مرتبط'],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <h3>تفاصيل الإشعار</h3>
      <p>{item.detail}</p>
      <h3>الإجراء المقترح</h3>
      <p>{item.action}</p>
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
          onClick={() =>
            setNotice('معاينة المصدر: ' + item.source + ' — الفتح تجريبي فقط')
          }
        >
          فتح المصدر
        </Button>
        <Button onClick={onClose}>إغلاق</Button>
      </div>
      <Toast message={notice} onDismiss={() => setNotice('')} />
    </PropertyOverlay>
  );
}
