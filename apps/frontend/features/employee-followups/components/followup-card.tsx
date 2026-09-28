import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { state, type Followup, type Entry } from '../model';
import styles from './followups.module.css';
export function FollowupStatusBadge({ item }: { item: Followup }) {
  const status = state(item);
  return (
    <span className={status === 'متأخرة' ? styles.late : styles.badge}>
      {status}
    </span>
  );
}
export function FollowupCard({
  item,
  onOpen,
  onResult,
}: {
  item: Followup;
  onOpen: () => void;
  onResult: () => void;
}) {
  return (
    <Card className={styles.row}>
      <div>
        <h3>{item.name}</h3>
        <p>{item.kind} · الموظف: أحمد محمد</p>
        <p>الموعد: {item.due.replace('T', ' ')}</p>
        <p>آخر نتيجة: {item.history[0]?.result || 'لم تسجل نتيجة'}</p>
        <p>{item.note}</p>
      </div>
      <div className={styles.actions}>
        <FollowupStatusBadge item={item} />
        <Button compactOnMobile onClick={onOpen}>
          تفاصيل
        </Button>
        <Button compactOnMobile onClick={onResult}>
          تسجيل نتيجة
        </Button>
      </div>
    </Card>
  );
}
export function FollowupTimeline({ items }: { items: Entry[] }) {
  return (
    <div className={styles.timeline}>
      {items.length ? (
        items.map((entry, i) => (
          <Card key={i}>
            <time>{new Date(entry.date).toLocaleString('ar-KW')}</time>
            <h3>{entry.result}</h3>
            <p>{entry.note || 'لا توجد ملاحظة'}</p>
            <p>المتابعة التالية: {entry.next.replace('T', ' ') || 'لم تحدد'}</p>
          </Card>
        ))
      ) : (
        <p>لا توجد نتائج سابقة.</p>
      )}
    </div>
  );
}
