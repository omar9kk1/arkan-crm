import { Toast } from '../../../components/ui/toast';
import { useState } from 'react';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { Button } from '../../../components/ui/button';
import type { NotificationDto } from '../../../lib/api/notification-types';
import { notificationRoute } from '../../notifications/notification-target';
import {
  displayDate,
  notificationTypeLabel,
  resolvePropertyCode,
} from '../../notifications/view';
import styles from './notifications.module.css';

/**
 * The notification detail drawer, rebuilt on the LIVE notification shape.
 *
 * It shows only what the backend actually stores — the type, message, timestamp
 * and read state — plus a real action: opening the linked property through the
 * existing authorized details experience. The mock-only "source", "employee",
 * "person", "suggested action" and priority fields are gone rather than faked.
 */
export function NotificationDetailsDrawer({
  item,
  onClose,
  onRead,
  onOpenRecord,
}: {
  item: NotificationDto;
  onClose: () => void;
  onRead: () => void;
  onOpenRecord: (path: string) => void;
}) {
  return (
    <PropertyOverlay title={item.title} drawer onClose={onClose}>
      <div className={styles.badges}>
        <span className={styles.badge}>
          {notificationTypeLabel(item.type)}
        </span>
        <span className={styles.badge}>
          {item.read ? 'مقروء' : 'غير مقروء'}
        </span>
      </div>
      <p>{resolvePropertyCode(item.message, item.propertyReference)}</p>
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
      <DrawerActions
        item={item}
        onRead={onRead}
        onOpenRecord={onOpenRecord}
        onClose={onClose}
      />
    </PropertyOverlay>
  );
}

function DrawerActions({
  item,
  onRead,
  onOpenRecord,
  onClose,
}: {
  item: NotificationDto;
  onRead: () => void;
  onOpenRecord: (path: string) => void;
  onClose: () => void;
}) {
  const [notice, setNotice] = useState('');
  // Managagers are authorized for every company record, so the row's reference
  // (property / client / contact) decides where the action button lands.
  const target = notificationRoute(item, 'MANAGER');
  return (
    <>
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
          disabled={!target}
          onClick={() => {
            if (target) onOpenRecord(target.path);
          }}
        >
          {item.propertyId ? 'فتح العقار' : 'فتح السجل'}
        </Button>
        <Button onClick={onClose}>إغلاق</Button>
      </div>
      <Toast message={notice} onDismiss={() => setNotice('')} />
    </>
  );
}
