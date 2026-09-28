import { GlassSelect } from '../../../components/ui/glass-select';
import {
  employees,
  statuses,
  type AttendanceFilter,
} from '../attendance-model';
import styles from './attendance.module.css';
export function AttendanceFilters({
  value,
  onChange,
}: {
  value: AttendanceFilter;
  onChange: (value: AttendanceFilter) => void;
}) {
  return (
    <div className={styles.filters}>
      <label className={styles.field}>
        التاريخ
        <input
          type="date"
          required
          value={value.date}
          onChange={(e) => {
            if (e.target.value) onChange({ ...value, date: e.target.value });
          }}
        />
      </label>
      <label className={styles.field}>
        الفترة
        <GlassSelect
          value={value.period}
          onChange={(e) =>
            onChange({
              ...value,
              period: e.target.value as AttendanceFilter['period'],
            })
          }
        >
          <option value="today">اليوم</option>
          <option value="week">آخر 7 أيام</option>
          <option value="month">الشهر الحالي</option>
        </GlassSelect>
      </label>
      <label className={styles.field}>
        الموظف
        <GlassSelect
          value={value.employeeId}
          onChange={(e) => onChange({ ...value, employeeId: e.target.value })}
        >
          <option value="">الكل</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </GlassSelect>
      </label>
      <label className={styles.field}>
        الحالة
        <GlassSelect
          value={value.status}
          onChange={(e) =>
            onChange({
              ...value,
              status: e.target.value as AttendanceFilter['status'],
            })
          }
        >
          <option value="">الكل</option>
          {Object.entries(statuses).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </GlassSelect>
      </label>
    </div>
  );
}
