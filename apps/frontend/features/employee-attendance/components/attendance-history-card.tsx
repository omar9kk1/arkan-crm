import { Card } from '../../../components/ui/card';
import {
  duration,
  type AttendanceRecord,
  type AttendanceState,
} from '../model';
import styles from './attendance.module.css';
export function AttendanceStatusBadge({
  status,
}: {
  status: AttendanceState | 'لم يسجل بعد';
}) {
  return (
    <span className={status === 'متأخر' ? styles.late : styles.badge}>
      {status}
    </span>
  );
}
export function AttendanceHistoryCard({
  record,
}: {
  record: AttendanceRecord;
}) {
  return (
    <Card className={styles.row}>
      <div>
        <h3>{record.date}</h3>
        <AttendanceStatusBadge status={record.status} />
      </div>
      <dl className={styles.times}>
        {[
          ['وقت الحضور', record.checkIn || '—'],
          ['وقت الانصراف', record.checkOut || '—'],
          ['عدد الساعات', duration(record)],
          ['طريقة التسجيل', record.method === 'NFC' ? 'NFC' : 'يدوي'],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.note}>{record.note}</p>
    </Card>
  );
}
