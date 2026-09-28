import { Button } from '../../ui/button';
import { Icon } from '../../ui/icon';
import { LogoutButton } from '../../../features/auth/components/logout-button';
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
        <Button
          className={styles.notificationButton}
          disabled
          aria-label="الإشعارات — قريبًا"
          title="الإشعارات — قريبًا"
        >
          <Icon name="bell" />
        </Button>
        <LogoutButton />
      </div>
    </header>
  );
}
