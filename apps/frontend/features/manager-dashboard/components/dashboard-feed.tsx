import { DashboardPanel } from './dashboard-panel';
import styles from './dashboard.module.css';

export function DashboardFeed({
  title,
  description,
  badge,
  items,
}: {
  title: string;
  description: string;
  badge?: string;
  items: readonly { title: string; detail: string; warning?: boolean }[];
}) {
  return (
    <DashboardPanel
      title={title}
      description={description}
      badge={badge}
      className={styles.feedPanel}
    >
      <ul className={styles.feed}>
        {items.map((item, index) => (
          <li
            // Two real actions may legitimately share a title (e.g. two blocked
            // duplicates); the index keeps the list key unique without changing
            // any visible content or styling.
            key={`${item.title}:${index}`}
            className={item.warning ? styles.warning : undefined}
          >
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
          </li>
        ))}
      </ul>
    </DashboardPanel>
  );
}
