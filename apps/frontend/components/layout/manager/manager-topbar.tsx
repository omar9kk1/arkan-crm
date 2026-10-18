import { LogoutButton } from '../../../features/auth/components/logout-button';
import { NotificationBell } from '../../../features/notifications/components/notification-bell';
import styles from './manager-shell.module.css';

export function ManagerTopbar() {
  return (
    <header className={styles.topbar}>
      <div className={styles.topbarTitle}>
        <span className={styles.overline}>
          أركان الخليج العقارية / مساحة الإدارة
        </span>
        <strong>نظرة شاملة على أعمالك</strong>
      </div>
      <div className={styles.account}>
        <span className={styles.role}>مدير النظام</span>
        <NotificationBell className={styles.notificationButton} />
        <LogoutButton />
      </div>
    </header>
  );
}
