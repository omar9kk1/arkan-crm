import { StatCard } from '../../../components/ui/stat-card';
import { dashboardPreview } from '../dashboard-preview';
import styles from './dashboard.module.css';
export function DashboardStats() {
  return (
    <div className={styles.stats} aria-label="إحصائيات تجريبية">
      {dashboardPreview.stats.map((stat) => (
        <StatCard key={stat.title} {...stat} />
      ))}
    </div>
  );
}
