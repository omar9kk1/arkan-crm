import { StatCard } from '../../../components/ui/stat-card';
import {
  workedMinutes,
  hoursLabel,
  type AttendanceRecord,
} from '../attendance-model';
import styles from './attendance.module.css';
export function AttendanceSummaryCards({
  records,
}: {
  records: readonly AttendanceRecord[];
}) {
  return (
    <div className={styles.stats}>
      {[
        [
          'حاضرين اليوم',
          records.filter((r) => r.status === 'present' || r.status === 'late')
            .length,
        ],
        ['متأخرين', records.filter((r) => r.status === 'late').length],
        ['غياب', records.filter((r) => r.status === 'absent').length],
        [
          'إجمالي ساعات العمل',
          hoursLabel(records.reduce((sum, r) => sum + workedMinutes(r), 0)),
        ],
      ].map(([title, value]) => (
        <StatCard
          key={title}
          title={String(title)}
          value={value}
          icon="clock"
          hint="ملخص اليوم الحالي لجميع الموظفين"
        />
      ))}
    </div>
  );
}
