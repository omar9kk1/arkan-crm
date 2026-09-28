'use client';
import { Toast } from '../../../components/ui/toast';

import { useState } from 'react';
import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { StatCard } from '../../../components/ui/stat-card';
import {
  filterNotifications,
  markRead,
  mockNotifications,
  type NotificationFilter,
} from '../notifications-model';
import { NotificationCard } from './notification-card';
import {
  NotificationFilters,
  notificationFilters,
} from './notification-filters';
import { NotificationDetailsDrawer } from './notification-details-drawer';
import styles from './notifications.module.css';
export function NotificationsPage() {
  const [items, setItems] = useState(mockNotifications);
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const selected = items.find((item) => item.id === selectedId);
  const counts = [
    ['إشعارات جديدة', items.filter((item) => !item.read).length],
    [
      'عقارات بانتظار الموافقة',
      items.filter((item) => item.category === 'property' && item.needsReview)
        .length,
    ],
    [
      'متابعات متأخرة',
      items.filter((item) => item.category === 'followup' && item.needsReview)
        .length,
    ],
    [
      'صفقات/عمولات تحتاج مراجعة',
      items.filter((item) => item.category === 'deal' && item.needsReview)
        .length,
    ],
  ];
  return (
    <ManagerPageShell
      title="الإشعارات"
      description="متابعة تنبيهات المدير المهمة: العقارات بانتظار الموافقة، المتابعات المتأخرة، الصفقات، العمولات، والحضور."
      actions={
        <Button
          onClick={() => {
            setItems((previous) => markRead(previous));
            setNotice('تم تعليم كل الإشعارات كمقروءة');
          }}
        >
          تعليم الكل كمقروء
        </Button>
      }
    >
      <div className={styles.scope}>
        <div className={styles.stats}>
          {counts.map(([title, value]) => (
            <StatCard
              key={title}
              title={String(title)}
              value={value}
              hint="ضمن العينة التجريبية"
              icon="bell"
            />
          ))}
        </div>
        <NotificationFilters
          items={items}
          value={filter}
          onChange={setFilter}
        />
        <p className={styles.muted}>
          إشعارات تجريبية مستقلة عن الصفحات الأخرى. قراءة الإشعار لا تعني إنهاء
          المراجعة المطلوبة.
        </p>
        {notificationFilters.map((tab) => (
          <section
            key={tab.id}
            id={`notifications-panel-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`notifications-tab-${tab.id}`}
            hidden={filter !== tab.id}
            tabIndex={0}
          >
            {filter === tab.id && (
              <div className={styles.list}>
                {filterNotifications(items, filter).map((item) => (
                  <NotificationCard
                    key={item.id}
                    item={item}
                    onOpen={() => setSelectedId(item.id)}
                  />
                ))}
                {!filterNotifications(items, filter).length && (
                  <Card>لا توجد إشعارات في هذا التصنيف.</Card>
                )}
              </div>
            )}
          </section>
        ))}
        {selected && (
          <NotificationDetailsDrawer
            key={selected.id}
            item={selected}
            onClose={() => setSelectedId(null)}
            onRead={() =>
              setItems((previous) => markRead(previous, selected.id))
            }
          />
        )}
        <Toast message={notice} onDismiss={() => setNotice('')} />
      </div>
    </ManagerPageShell>
  );
}
