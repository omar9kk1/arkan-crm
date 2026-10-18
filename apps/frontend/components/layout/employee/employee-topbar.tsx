import { LogoutButton } from '../../../features/auth/components/logout-button';
import { NotificationBell } from '../../../features/notifications/components/notification-bell';
import styles from '../manager/manager-shell.module.css';

export function EmployeeTopbar() {
  return (
    <header className={`${styles.topbar} ${styles.employeeTopbar}`}>
      <div className={styles.topbarTitle}>
        <span className={styles.overline}>
          أركان الخليج العقارية / مساحة الموظف
        </span>
        <strong>متابعة أعمالك اليومية</strong>
      </div>
      <div className={styles.account}>
        <span>موظف مبيعات</span>
        <NotificationBell className={styles.notificationButton} />
        <LogoutButton />
      </div>
    </header>
  );
}
