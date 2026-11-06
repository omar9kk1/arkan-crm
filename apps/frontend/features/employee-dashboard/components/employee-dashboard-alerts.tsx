'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../auth/components/auth-provider';
import { useNotifications } from '../../notifications/store';
import { notificationRoute } from '../../notifications/notification-target';
import { Icon } from '../../../components/ui/icon';
import styles from './employee-dashboard.module.css';

export function EmployeeDashboardAlerts() {
  const router = useRouter();
  const { user } = useAuth();
  const { items, markRead } = useNotifications();
  const recent = items.slice(0, 4);

  const handleClick = async (item: (typeof items)[number]) => {
    if (!item.read) void markRead(item.id);
    const target = notificationRoute(item, user?.role);
    if (target) router.push(target.path);
  };

  return (
    <section className={styles.alertsSection}>
      <h2 className={styles.alertsTitle}>تنبيهات الموظف</h2>
      {recent.length === 0 ? (
        <div className={styles.alertsList}>
          <div className={styles.alertCard}>
            <span className={styles.alertIcon} aria-hidden="true">
              <Icon name="bell" width={15} height={15} />
            </span>
            <span className={styles.alertText}>لا توجد تنبيهات حاليًا</span>
          </div>
        </div>
      ) : (
        <div className={styles.alertsList}>
          {recent.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.alertCard} ${
                item.read ? styles.alertRead : styles.alertUnread
              }`}
              onClick={() => void handleClick(item)}
            >
              <span className={styles.alertIcon} aria-hidden="true">
                <Icon name="bell" width={15} height={15} />
              </span>
              <div className={styles.alertContent}>
                <span className={styles.alertText}>{item.title}</span>
                {item.message ? (
                  <span className={styles.alertSub}>{item.message}</span>
                ) : null}
                <span className={styles.alertTime}>
                  {item.createdAt
                    ? new Date(item.createdAt).toLocaleString('ar-KW')
                    : ''}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
