'use client';
import { Toast } from '../../../components/ui/toast';

import { useState } from 'react';
import { EmployeePageShell } from '../../../components/layout/employee/employee-page-shell';
import { Button } from '../../../components/ui/button';
import local from './employee-notifications.module.css';
import { samples, tabs, filterNotifications, markRead } from '../model';
import { EmployeeNotificationCard } from './employee-notification-card';
import { EmployeeNotificationFilters } from './employee-notification-filters';
import { EmployeeNotificationDetailsDrawer } from './employee-notification-details-drawer';
import styles from '../../manager-notifications/components/notifications.module.css';
export function EmployeeNotificationsPage() {
  const [items, setItems] = useState(samples),
    [tab, setTab] = useState('all'),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [notice, setNotice] = useState('');
  const selected = items.find((item) => item.id === selectedId);
  return (
    <EmployeePageShell
      title="الإشعارات"
      description="متابعة تنبيهاتك اليومية: المتابعات المتأخرة، العقارات المناسبة، رسائل المدير، وحالة العقارات المرسلة للمراجعة."
      actions={
        <Button
          className={local.markAll}
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
        <EmployeeNotificationFilters
          items={items}
          value={tab}
          onChange={setTab}
        />
        <p className={styles.muted}>
          إشعارات تجريبية مستقلة. تعليم الإشعار كمقروء لا ينفذ الإجراء المرتبط
          به.
        </p>
        {tabs.map((t) => (
          <section
            key={t.id}
            role="tabpanel"
            id={'employee-notifications-panel-' + t.id}
            aria-labelledby={'employee-notifications-tab-' + t.id}
            hidden={tab !== t.id}
            tabIndex={0}
          >
            {tab === t.id && (
              <div className={local.list}>
                {filterNotifications(items, tab).map((item) => (
                  <EmployeeNotificationCard
                    key={item.id}
                    item={item}
                    onOpen={() => setSelectedId(item.id)}
                  />
                ))}
                {!filterNotifications(items, tab).length && (
                  <p className={local.empty}>لا توجد إشعارات في هذا التصنيف.</p>
                )}
              </div>
            )}
          </section>
        ))}
        {selected && (
          <EmployeeNotificationDetailsDrawer
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
    </EmployeePageShell>
  );
}
