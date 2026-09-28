import { Toast } from '../../../components/ui/toast';
import { useState } from 'react';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { Button } from '../../../components/ui/button';
import {
  categories,
  displayDate,
  type ManagerNotification,
} from '../notifications-model';
import { NotificationPriorityBadge } from './notification-priority-badge';
import styles from './notifications.module.css';
export function NotificationDetailsDrawer({
  item,
  onClose,
  onRead,
}: {
  item: ManagerNotification;
  onClose: () => void;
  onRead: () => void;
}) {
  return (
    <PropertyOverlay title={item.title} drawer onClose={onClose}>
      <NotificationPriorityBadge priority={item.priority} />
      <p>{item.description}</p>
      <dl className={styles.facts}>
        {[
          ['النوع', categories[item.category]],
          ['المصدر', item.source],
          ['التاريخ', displayDate(item.date)],
          ['الحالة', item.read ? 'مقروء' : 'غير مقروء'],
          ['الموظف', item.employee || 'غير مرتبط'],
          ['العقار', item.property || 'غير مرتبط'],
          ['العميل / المالك', item.person || 'غير مرتبط'],
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
      <DrawerActions
        read={item.read}
        source={item.source}
        onRead={onRead}
        onClose={onClose}
      />
    </PropertyOverlay>
  );
}
function DrawerActions({
  read,
  source,
  onRead,
  onClose,
}: {
  read: boolean;
  source: string;
  onRead: () => void;
  onClose: () => void;
}) {
  const [notice, setNotice] = useState('');
  return (
    <>
      <div className={styles.actions}>
        <Button
          disabled={read}
          onClick={() => {
            onRead();
            setNotice('تم تعليم الإشعار كمقروء');
          }}
        >
          تعليم كمقروء
        </Button>
        <Button
          onClick={() =>
            setNotice(`معاينة المصدر: ${source} — الفتح تجريبي فقط`)
          }
        >
          فتح المصدر
        </Button>
        <Button onClick={onClose}>إغلاق</Button>
      </div>
      <Toast message={notice} onDismiss={() => setNotice('')} />
    </>
  );
}
