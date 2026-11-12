'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Toast } from '../../../components/ui/toast';
import { EmployeePageShell } from '../../../components/layout/employee/employee-page-shell';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import type { NotificationDto } from '../../../lib/api/notification-types';
import { requestOpenProperty } from '../../notifications/open-property';
import { useNotifications } from '../../notifications/store';
import { tabs, filterNotifications, type EmployeeFilter } from '../model';
import { NotificationCard } from '../../manager-notifications/components/notification-card';
import { EmployeeNotificationFilters } from './employee-notification-filters';
import { EmployeeNotificationDetailsDrawer } from './employee-notification-details-drawer';
import styles from '../../manager-notifications/components/notifications.module.css';

/**
 * The employee Notifications page. Like the manager page it renders the shared
 * notification store (the same 15s poll as the bell), so it shows only the
 * signed-in employee's real notifications and never a mock list.
 */
export function EmployeeNotificationsPage() {
  const router = useRouter();
  const {
    items,
    status,
    refresh,
    markRead,
    markAllRead,
    loadMore,
    loadingMore,
    nextCursor,
  } = useNotifications();
  const [tab, setTab] = useState<EmployeeFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const visible = filterNotifications(items, tab);
  const firstLoad = status !== 'ready' && items.length === 0;

  const openNotification = (item: NotificationDto) => {
    setSelectedId(item.id);
    if (!item.read) void markRead(item.id);
  };

  const openProperty = (propertyId: string) => {
    setSelectedId(null);
    requestOpenProperty(propertyId);
    router.push('/employee/properties');
  };

  const markAll = () => {
    void markAllRead();
    setNotice('تم تعليم كل الإشعارات كمقروءة');
  };

  return (
    <EmployeePageShell
      title="الإشعارات"
      description="متابعة تنبيهاتك اليومية: المتابعات المتأخرة، العقارات المناسبة، رسائل المدير، وحالة العقارات المرسلة للمراجعة."
      actions={
        <Button onClick={markAll}>تعليم الكل كمقروء</Button>
      }
    >
      <div className={styles.scope}>
        <EmployeeNotificationFilters
          items={items}
          value={tab}
          onChange={setTab}
        />
        <p className={styles.muted}>قراءة الإشعار لا تنفذ إجراءً على العقار.</p>
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
              <div className={styles.list}>
                {firstLoad ? (
                  <Card>
                    {status === 'error' ? (
                      <>
                        تعذّر تحميل الإشعارات.{' '}
                        <Button onClick={() => void refresh()}>
                          إعادة المحاولة
                        </Button>
                      </>
                    ) : (
                      'جارٍ تحميل الإشعارات…'
                    )}
                  </Card>
                ) : visible.length === 0 ? (
                  <Card>لا توجد إشعارات في هذا التصنيف.</Card>
                ) : (
                  visible.map((item) => (
                    <NotificationCard
                      key={item.id}
                      item={item}
                      onOpen={() => openNotification(item)}
                    />
                  ))
                )}
                {!firstLoad && nextCursor && (
                  <div className={styles.pagination}>
                    <Button
                      disabled={loadingMore}
                      onClick={() => void loadMore()}
                    >
                      {loadingMore ? 'جارٍ التحميل…' : 'تحميل المزيد'}
                    </Button>
                  </div>
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
            onRead={() => void markRead(selected.id)}
            onOpenProperty={openProperty}
          />
        )}
        <Toast message={notice} onDismiss={() => setNotice('')} />
      </div>
    </EmployeePageShell>
  );
}
