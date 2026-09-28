import { LogoutButton } from '../../../features/auth/components/logout-button';
import { Button } from '../../ui/button';
import { Icon } from '../../ui/icon';
import styles from '../manager/manager-shell.module.css';
export function EmployeeTopbar({
  onPreview,
}: {
  onPreview: (label: string) => void;
}) {
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
        <Button
          className={styles.notificationButton}
          aria-label="الإشعارات"
          title="الإشعارات"
          onClick={() => onPreview('الإشعارات')}
        >
          <Icon name="bell" />
        </Button>
        <LogoutButton />
      </div>
    </header>
  );
}
