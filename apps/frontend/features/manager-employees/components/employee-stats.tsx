import { StatCard } from '../../../components/ui/stat-card';
import { money, UNAVAILABLE, type EmployeeRecord } from '../model';
import styles from './employees.module.css';

/** `null` is a metric the backend cannot answer yet — never a fabricated 0. */
const number = (value: number | null) =>
  value === null ? UNAVAILABLE : String(value);

/** Sums a metric only when every row actually has it; otherwise unavailable. */
const sumOrUnavailable = (values: readonly (number | null)[]) =>
  values.length && values.every((value) => value !== null)
    ? values.reduce((sum, value) => sum + (value ?? 0), 0)
    : UNAVAILABLE;

export function EmployeeStats({
  employee,
  items = [],
}: {
  employee?: EmployeeRecord;
  items?: readonly EmployeeRecord[];
}) {
  if (employee)
    return (
      <dl className={styles.metrics}>
        {[
          ['العملاء', number(employee.clientsCount)],
          ['العقارات المدخلة', number(employee.propertyCount)],
          ['العقارات المخصصة', number(employee.assignedCount)],
          ['الصفقات', number(employee.dealsCount)],
          [
            'إجمالي العمولة',
            employee.commission === null
              ? UNAVAILABLE
              : money(employee.commission),
          ],
          ['متابعات متأخرة', number(employee.lateCount)],
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
        { title: 'إجمالي الموظفين', value: items.length, hint: 'من سجلات الخادم' },
        {
          title: 'موظفين نشطين',
          value: items.filter((item) => item.active).length,
          hint: 'من سجلات الخادم',
        },
        {
          title: 'إجمالي العملاء من الموظفين',
          value: sumOrUnavailable(items.map((item) => item.clientsCount)),
          hint: 'غير متوفر من الخادم بعد',
        },
        {
          title: 'متابعات متأخرة',
          value: sumOrUnavailable(items.map((item) => item.lateCount)),
          hint: 'غير متوفر من الخادم بعد',
        },
      ].map((item) => (
        <StatCard key={item.title} {...item} icon="users" />
      ))}
    </div>
  );
}
