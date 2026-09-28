import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { AttendanceStatusBadge } from './attendance-history-card';
import { duration, type AttendanceRecord } from '../model';
import styles from './attendance.module.css';
export function AttendanceTodayCard({
  date,
  record,
  onIn,
  onOut,
}: {
  date: string;
  record: AttendanceRecord | null;
  onIn: () => void;
  onOut: () => void;
}) {
  return (
    <Card className={styles.today}>
      <h2>تسجيل اليوم</h2>
      <p>{date}</p>
      <AttendanceStatusBadge status={record ? record.status : 'لم يسجل بعد'} />
      <dl className={styles.times}>
        {[
          ['الحضور', record?.checkIn || '—'],
          ['الانصراف', record?.checkOut || '—'],
          ['ساعات العمل', record ? duration(record) : '—'],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.actions}>
        <Button disabled={!!record} onClick={onIn}>
          تسجيل حضور
        </Button>
        <Button disabled={!record || !!record.checkOut} onClick={onOut}>
          تسجيل انصراف
        </Button>
      </div>
      <p>يتم اعتماد السجل من المدير عند الحاجة.</p>
      <small>تسجيل تجريبي محلي بوقت الجهاز، دون ربط بخادم.</small>
    </Card>
  );
}
