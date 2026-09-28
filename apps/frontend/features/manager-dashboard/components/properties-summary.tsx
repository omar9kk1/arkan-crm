import { dashboardPreview } from '../dashboard-preview';
import { DashboardPanel } from './dashboard-panel';
import { SummaryMetrics } from './summary-metrics';
import styles from './dashboard.module.css';

export function PropertiesSummary() {
  const total = dashboardPreview.properties.reduce(
    (sum, item) => sum + item.value,
    0,
  );
  return (
    <DashboardPanel
      title="قسم العقارات"
      description="توزيع حالة العقارات داخل النظام حسب الفترة المختارة."
    >
      <SummaryMetrics items={dashboardPreview.properties} />
      <div className={styles.statusBars}>
        {dashboardPreview.properties.map((item) => (
          <label key={item.label}>
            <span>{item.label}</span>
            <progress
              max={total}
              value={item.value}
              aria-label={`${item.label}: ${item.value} من ${total}`}
            />
          </label>
        ))}
      </div>
    </DashboardPanel>
  );
}
