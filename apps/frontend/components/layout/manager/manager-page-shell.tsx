import type { ReactNode } from 'react';
import styles from './manager-shell.module.css';
export function ManagerPageShell({
  title = '',
  description,
  overline = 'لوحة المدير',
  actions,
  children,
}: {
  title?: string;
  description?: string;
  overline?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.pageHeading}>
        <div>
          {overline ? <span className={styles.overline}>{overline}</span> : null}
          {title ? <h1>{title}</h1> : null}
          {description ? <p>{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}
