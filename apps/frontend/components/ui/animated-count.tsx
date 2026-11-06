'use client';
import { useCountUp } from './use-count-up';
import styles from './animated-count.module.css';

/**
 * ONE shared count-up for every meaningful numeric counter outside the
 * statistics cards (tab count badges, result/section totals…). The number
 * seen at rest is ALWAYS the caller's exact value; the presentation runs the
 * adaptive one-cycle count (0 instant, 1 subtle reveal, 2..10 one-by-one
 * ~1.2s/step, 11..30 sequential ~4s, beyond that smooth ~4s) — same system
 * as the statistics cards, never restarted by rerenders or refetches.
 */
export function AnimatedCount({ value }: { value: number }) {
  const shown = useCountUp(value);
  return <span className={styles.count}>{shown}</span>;
}
