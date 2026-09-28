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
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
