import { StatCard } from '../../../components/ui/stat-card';
import { totalMoney, type FinanceMovement } from '../finance-model';
import styles from './finance.module.css';
export function FinanceSummaryCards({
  movements,
}: {
  movements: readonly FinanceMovement[];
}) {
  return (
    <div className={styles.stats}>
      {[
        {
          title: 'عمولات داخلة',
          value: totalMoney(movements, (totals) => totals.income),
        },
        {
          title: 'عمولات موظفين خارجة',
          value: totalMoney(movements, (totals) => totals.commission),
        },
        {
          title: 'مرتبات خارجة',
          value: totalMoney(movements, (totals) => totals.payroll),
        },
        {
          title: 'صافي الحركة المالية',
          value: totalMoney(movements, (totals) => totals.net),
        },
      ].map((item) => (
        <StatCard
          key={item.title}
          title={item.title}
          value={item.value}
          icon="wallet"
          hint="حسب الفلاتر الحالية"
        />
      ))}
    </div>
  );
}
