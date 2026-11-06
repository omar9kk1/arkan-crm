import type { ManagerDashboardDto } from '../../../lib/api/dashboard-types';
import { DashboardPanel } from './dashboard-panel';
import styles from './dashboard.module.css';

export function TopEmployeesPlaceholder({
  leaders,
}: {
  leaders: ManagerDashboardDto['leaders'];
}) {
  const items = [
    {
      label: 'أكثر موظف جاب عملاء',
      name: leaders.clients.name ?? '—',
      value: `${leaders.clients.count} عميل`,
    },
    {
      label: 'أكثر موظف جاب عقارات',
      name: leaders.properties.name ?? '—',
      value: `${leaders.properties.count} عقارات`,
    },
    {
      label: 'أكثر موظف قفل صفقات',
      name: leaders.deals.name ?? '—',
      value: `${leaders.deals.count} صفقات`,
    },
  ];
  return (
    <DashboardPanel
      title="أفضل الموظفين"
      description="التقييم مقسّم حسب نوع الأداء عشان يبقى عادل وواضح."
      badge="الفترة المختارة"
    >
      <ul className={styles.leaders}>
        {items.map((item) => (
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
