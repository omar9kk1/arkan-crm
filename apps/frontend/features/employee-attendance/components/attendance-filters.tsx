import { GlassSelect } from '../../../components/ui/glass-select';
import styles from './attendance.module.css';
export function AttendanceFilters({
  period,
  status,
  onPeriod,
  onStatus,
}: {
  period: string;
  status: string;
  onPeriod: (value: string) => void;
  onStatus: (value: string) => void;
}) {
  return (
    <div className={styles.filters}>
      <label>
        الفترة
        <GlassSelect value={period} onChange={(e) => onPeriod(e.target.value)}>
          <option value="today">اليوم</option>
          <option value="week">آخر 7 أيام</option>
          <option value="month">الشهر الحالي</option>
        </GlassSelect>
      </label>
      <label>
        الحالة
        <GlassSelect value={status} onChange={(e) => onStatus(e.target.value)}>
          <option value="">الكل</option>
          {['حاضر', 'متأخر', 'غائب', 'إجازة'].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </GlassSelect>
      </label>
    </div>
  );
}
