import type { ReactNode } from 'react';
import styles from './manager-shell.module.css';
export function ManagerPageShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.pageHeading}>
        <div>
          <span className={styles.overline}>لوحة المدير</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}
