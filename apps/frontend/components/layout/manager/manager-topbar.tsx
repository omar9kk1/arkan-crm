'use client';
import { usePathname } from 'next/navigation';
import { LogoutButton } from '../../../features/auth/components/logout-button';
import { NotificationBell } from '../../../features/notifications/components/notification-bell';
import styles from './manager-shell.module.css';

/**
 * Shared Manager topbar. ROUTE-SPECIFIC presentation (owner request): the
 * title block «أركان الخليج العقارية / مساحة الإدارة» + «نظرة شاملة على
 * أعمالك» is hidden ONLY on the Clients page (/manager/clients) — every
 * other Manager page keeps it. The actions (role, notifications, logout)
 * are always rendered; with the title hidden the account group is pushed to
 * the container's inline-end edge (`.topbarEnd`) so it stays exactly where
 * it was when the title occupied the leading space.
 */
export function ManagerTopbar() {
  const pathname = usePathname();
  const minimal = pathname?.startsWith('/manager/clients') ?? false;
  return (
    <header
      className={
        minimal ? `${styles.topbar} ${styles.topbarEnd}` : styles.topbar
      }
    >
      {!minimal && (
        <div className={styles.topbarTitle}>
          <span className={styles.overline}>
            أركان الخليج العقارية / مساحة الإدارة
          </span>
          <strong>نظرة شاملة على أعمالك</strong>
        </div>
      )}
      <div className={styles.account}>
        <span className={styles.role}>مدير النظام</span>
        <NotificationBell className={styles.notificationButton} />
        <LogoutButton iconOnly className={styles.notificationButton} />
      </div>
    </header>
  );
}
