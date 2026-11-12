'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Toast } from '../../../components/ui/toast';
import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
import type { NotificationDto } from '../../../lib/api/notification-types';
import { useAuth } from '../../auth/components/auth-provider';
import { useNotifications } from '../../notifications/store';
import {
  filterManagerNotifications,
  notificationFilters,
  type ManagerFilter,
} from '../notifications-model';
import { NotificationCard } from './notification-card';
import { NotificationFilters } from './notification-filters';
import { NotificationDetailsDrawer } from './notification-details-drawer';
import { SystemLogPanel } from './system-log-panel';
import styles from './notifications.module.css';

/**
 * The manager Notifications page. Every row, count and empty state comes from
 * the shared notification store (the same 15s poll as the header bell), so it
 * shows exactly the signed-in manager's real notifications — never a mock list.
 */
export function NotificationsPage() {
  const router = useRouter();
  const { user } = useAuth();
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
  const [filter, setFilter] = useState<ManagerFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [view, setView] = useState<'inbox' | 'system'>('inbox');
  const isOwner = user?.role === 'OWNER';
  const showInbox = !isOwner || view === 'inbox';

  const selected = items.find((item) => item.id === selectedId) ?? null;

  const openNotification = (item: NotificationDto) => {
    setSelectedId(item.id);
    if (!item.read) void markRead(item.id);
  };

  // The action button in the details drawer deep-links the notification's exact
  // authorized record (property, client or contact drawer).
  const openRecord = (path: string) => {
    setSelectedId(null);
    router.push(path);
  };

  const markAll = () => {
    void markAllRead();
    setNotice('تم تعليم كل الإشعارات كمقروءة');
  };

  const visible = filterManagerNotifications(items, filter);
  const firstLoad = status !== 'ready' && items.length === 0;

  return (
    <ManagerPageShell
      title="الإشعارات"
      description="متابعة تنبيهات المدير المهمة: العقارات بانتظار الموافقة، المتابعات المتأخرة، الصفقات، العمولات، والحضور."
      actions={
        showInbox ? (
          <Button onClick={markAll}>تعليم الكل كمقروء</Button>
        ) : undefined
      }
    >
      <div className={styles.scope}>
        {isOwner && (
          <div className={styles.ownerTabs}>
            <SegmentedTabs
              id="owner-notifications"
              label="أقسام صفحة الإشعارات"
              value={view}
              onChange={(value) => {
                setSelectedId(null);
                setView(value === 'system' ? 'system' : 'inbox');
              }}
              items={[
                { id: 'inbox', label: 'الإشعارات' },
                { id: 'system', label: 'سجل النظام' },
              ]}
            />
          </div>
        )}
        {showInbox ? (
          <>
            <NotificationFilters
              items={items}
              value={filter}
              onChange={setFilter}
            />
            <p className={styles.muted}>
              قراءة الإشعار لا تعني إنهاء المراجعة المطلوبة.
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
          </>
        ) : (
          <SystemLogPanel />
        )}
        {showInbox && selected && (
          <NotificationDetailsDrawer
            key={selected.id}
            item={selected}
            onClose={() => setSelectedId(null)}
            onRead={() => void markRead(selected.id)}
            onOpenRecord={openRecord}
          />
        )}
        <Toast message={notice} onDismiss={() => setNotice('')} />
      </div>
    </ManagerPageShell>
  );
}
