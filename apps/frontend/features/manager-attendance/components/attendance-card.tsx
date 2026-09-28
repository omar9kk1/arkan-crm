import { Card } from '../../../components/ui/card';
import {
  employees,
  statuses,
  workedMinutes,
  hoursLabel,
  type AttendanceRecord,
} from '../attendance-model';
import styles from './attendance.module.css';
export function AttendanceCard({ record }: { record: AttendanceRecord }) {
  return (
    <Card className={styles.record}>
      <div>
        <h3>
          {record.employeeName ||
            employees.find((e) => e.id === record.employeeId)?.name}
        </h3>
        <p>موظف مبيعات</p>
        <time dateTime={record.date}>{record.date}</time>
      </div>
      <dl className={styles.times}>
        {[
          ['وقت الحضور', record.checkIn || '—'],
          ['طريقة التسجيل', record.method === 'NFC' ? 'NFC' : 'يدوي'],
          ['وقت الانصراف', record.checkOut || '—'],
          [
            'ساعات العمل',
            record.checkIn && !record.checkOut
              ? 'لم يُسجل الانصراف'
              : hoursLabel(workedMinutes(record)),
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <span
        className={`${styles.badge} ${record.status === 'late' ? styles.late : ''}`}
      >
        {statuses[record.status]}
      </span>
      {record.note && <p className={styles.note}>{record.note}</p>}
    </Card>
  );
}
