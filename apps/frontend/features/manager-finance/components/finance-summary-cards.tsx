import { StatCard } from '../../../components/ui/stat-card';
import {
  summaryMoney,
  type FinanceSummary,
} from '../finance-model';
import styles from './finance.module.css';
export function FinanceSummaryCards({
  summaries,
}: {
  summaries: readonly FinanceSummary[];
}) {
  return (
    <div className={styles.stats}>
      {[
        {
          title: 'عمولات داخلة',
          value: summaryMoney(summaries, (totals) => totals.income),
        },
        {
          title: 'عمولات موظفين خارجة',
          value: summaryMoney(summaries, (totals) => totals.commission),
        },
        {
          title: 'مرتبات خارجة',
          value: summaryMoney(summaries, (totals) => totals.payroll),
        },
        {
          title: 'صافي الحركة المالية',
          value: summaryMoney(summaries, (totals) => totals.net),
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
