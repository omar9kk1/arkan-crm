import type { ReactNode } from 'react';
import { Card } from '../../../components/ui/card';
import styles from './dashboard.module.css';

export function DashboardPanel({
  title,
  description,
  badge,
  className = '',
  children,
}: {
  title: string;
  description: string;
  badge?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={`${styles.panel} ${className}`} aria-label={title}>
      <header className={styles.panelHeading}>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {badge && <span className={styles.tag}>{badge}</span>}
      </header>
      {children}
    </Card>
  );
}
