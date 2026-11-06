'use client';
import { useRouter } from 'next/navigation';
import { Icon } from '../../../components/ui/icon';
import styles from './employee-dashboard.module.css';

export function EmployeeQuickActions() {
  const router = useRouter();
  return (
    <div className={styles.quickActionsRow}>
      <button
        type="button"
        className={styles.quickPill}
        onClick={() => router.push('/employee/clients?new=1')}
      >
        <Icon name="users" width={13} height={13} />
        <span>إضافة عميل</span>
      </button>
      <button
        type="button"
        className={styles.quickPill}
        onClick={() => router.push('/employee/properties?new=1')}
      >
        <Icon name="building" width={13} height={13} />
        <span>إضافة عقار</span>
      </button>
      <button
        type="button"
        className={styles.quickPill}
        onClick={() => router.push('/employee/followups')}
      >
        <Icon name="deals" width={13} height={13} />
        <span>المتابعات</span>
      </button>
    </div>
  );
}
