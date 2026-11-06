import { StatCard } from '../../../components/ui/stat-card';
import type { IconName } from '../../../components/ui/icon';
import styles from './dashboard.module.css';

export function DashboardStats({
  items,
}: {
  items: readonly {
    title: string;
    value: number;
    hint: string;
    icon: IconName;
  }[];
}) {
  return (
    <div className={styles.stats} aria-label="إحصائيات لوحة المدير">
      {items.map((stat) => (
        <StatCard key={stat.title} {...stat} />
      ))}
    </div>
  );
}
