import type { ReactNode } from 'react';
import styles from '../manager/manager-shell.module.css';
export function EmployeePageShell({
  children,
  title = 'مرحبًا بك، أحمد محمد',
  description = 'متابعة العملاء، العقارات المخصصة، المتابعات، والتنبيهات اليومية.',
  actions,
}: {
  children: ReactNode;
  title?: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.pageHeading}>
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}
