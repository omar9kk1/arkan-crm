'use client';
import type { ReactNode } from 'react';
import { Card } from './card';
import { Icon, type IconName } from './icon';
import { useCountUp } from './use-count-up';
import styles from './stat-card.module.css';
export function StatCard({
  title,
  value,
  hint,
  icon,
  countUp = true,
}: {
  title: string;
  value: ReactNode;
  hint: string;
  icon: IconName;
  /** ONE shared count-up for NUMERIC values (adaptive per the value: 0 →
   * instant, 1 → subtle reveal, 2..10 → every integer held ~1.2s, 11..30 →
   * sequential ~4s, >30 → smooth ~4s). STRING values (money, formatted
   * previews) never animate — they are passed through verbatim. Only ONE
   * cycle runs per presentation; refetches never restart it. */
  countUp?: boolean;
}) {
  // The hook is always called (a plain numeric passthrough keeps the rules
  // of hooks); it animates ONLY when `countUp` and a real number arrive.
  const animated = useCountUp(countUp && typeof value === 'number' ? value : 0);
  const displayValue =
    countUp && typeof value === 'number'
      ? animated
      : typeof value === 'string'
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
