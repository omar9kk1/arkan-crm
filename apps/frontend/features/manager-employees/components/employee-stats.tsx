import { StatCard } from '../../../components/ui/stat-card';
import { employees, money, type EmployeeSample } from '../mock-data';
import styles from './employees.module.css';
export function EmployeeStats({
  employee,
  assignedCount = 0,
  items = employees,
}: {
  employee?: EmployeeSample;
  assignedCount?: number;
  items?: readonly EmployeeSample[];
}) {
  if (employee)
    return (
      <dl className={styles.metrics}>
        {[
          ['العملاء', employee.clientsCount],
          ['العقارات المدخلة', employee.propertiesCount],
          ['العقارات المخصصة', assignedCount],
          ['الصفقات', employee.dealsCount],
          ['إجمالي العمولة', money(employee.commission)],
          ['متابعات متأخرة', employee.lateCount],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    );
  return (
    <div className={styles.stats}>
      {[
        { title: 'إجمالي الموظفين', value: items.length },
        {
          title: 'موظفين نشطين',
          value: items.filter((item) => item.active).length,
        },
        {
          title: 'إجمالي العملاء من الموظفين',
          value: items.reduce((sum, item) => sum + item.clientsCount, 0),
        },
        {
          title: 'متابعات متأخرة',
          value: items.reduce((sum, item) => sum + item.lateCount, 0),
        },
      ].map((item) => (
        <StatCard
          key={item.title}
          {...item}
          icon="users"
          hint="بيانات تجريبية"
        />
      ))}
    </div>
  );
}
