import type { ReactNode } from 'react';
import { Card } from './card';
import { Icon, type IconName } from './icon';
import styles from './stat-card.module.css';
export function StatCard({
  title,
  value,
  hint,
  icon,
}: {
  title: string;
  value: ReactNode;
  hint: string;
  icon: IconName;
}) {
  const displayValue =
    typeof value === 'string'
      ? value
          .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
          .replace(/٬/g, ',')
          .replace(/٫/g, '.')
      : value;
  return (
    <Card className={styles.card} data-stat-card>
      <div className={styles.heading}>
        <h2>{title}</h2>
        <span className={styles.icon}>
          <Icon name={icon} />
        </span>
      </div>
      <strong className={styles.value}>{displayValue}</strong>
      <p>{hint}</p>
    </Card>
  );
}
