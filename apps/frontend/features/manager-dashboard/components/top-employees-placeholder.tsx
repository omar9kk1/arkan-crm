import { dashboardPreview } from '../dashboard-preview';
import { DashboardPanel } from './dashboard-panel';
import styles from './dashboard.module.css';
export function TopEmployeesPlaceholder() {
  return (
    <DashboardPanel
      title="أفضل الموظفين"
      description="التقييم مقسّم حسب نوع الأداء عشان يبقى عادل وواضح."
      badge="الشهر الحالي"
    >
      <ul className={styles.leaders}>
        {dashboardPreview.leaders.map((item) => (
          <li key={item.label}>
            <small>{item.label}</small>
            <strong>{item.name}</strong>
            <span>{item.value}</span>
          </li>
        ))}
      </ul>
    </DashboardPanel>
  );
}
