import type { ReactNode } from 'react';
import styles from '../manager/manager-shell.module.css';
import { TypewriterText } from '../../ui/typewriter-text';
export function EmployeePageShell({
  children,
  title = 'مرحبًا بك، أحمد محمد',
  description = '',
  actions,
  typewriter = false,
}: {
  children: ReactNode;
  title?: string;
  description?: string;
  actions?: ReactNode;
  typewriter?: boolean;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.pageHeading}>
        <div>
          <h1>
            {typewriter ? <TypewriterText text={title} speed={80} /> : title}
          </h1>
          {description ? <p>{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}
