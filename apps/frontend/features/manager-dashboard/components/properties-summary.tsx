import type { ManagerDashboardDto } from '../../../lib/api/dashboard-types';
import { DashboardPanel } from './dashboard-panel';
import { SummaryMetrics } from './summary-metrics';
import styles from './dashboard.module.css';

export function PropertiesSummary({
  properties,
}: {
  properties: ManagerDashboardDto['properties'];
}) {
  const items = [
    { label: 'متاح', value: properties.available },
    { label: 'تم البيع', value: properties.sold },
    { label: 'تم التأجير', value: properties.rented },
    { label: 'بانتظار الموافقة', value: properties.pending },
  ];
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return (
    <DashboardPanel
      title="قسم العقارات"
      description="توزيع حالة العقارات الحالية داخل النظام."
    >
      <SummaryMetrics items={items} />
      <div className={styles.statusBars}>
        {items.map((item) => (
          <label key={item.label}>
            <span>{item.label}</span>
            <progress
              max={Math.max(total, 1)}
              value={item.value}
              aria-label={`${item.label}: ${item.value} من ${total}`}
            />
          </label>
        ))}
      </div>
    </DashboardPanel>
  );
}
