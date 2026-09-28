import type { ReactNode } from 'react';
import styles from './section-header.module.css';
export function SectionHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children}
    </header>
  );
}
