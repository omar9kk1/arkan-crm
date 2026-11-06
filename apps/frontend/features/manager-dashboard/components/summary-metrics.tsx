import { AnimatedCount } from '../../../components/ui/animated-count';
import styles from './dashboard.module.css';

export function SummaryMetrics({
  items,
  className = '',
}: {
  items: readonly {
    label: string;
    value: number | string;
    warning?: boolean;
  }[];
  className?: string;
}) {
  return (
    <dl className={`${styles.metrics} ${className}`}>
      {items.map((item) => (
        <div
          key={item.label}
          className={item.warning ? styles.warning : undefined}
        >
          <dt>{item.label}</dt>
          {/* The SAME shared counter as every other page — numeric values are
              real counts (property/people/deal tallies); string values are
              formatted money/unit facts and pass through verbatim. */}
          <dd>
            {typeof item.value === 'number' ? (
              <AnimatedCount value={item.value} />
            ) : (
              item.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
