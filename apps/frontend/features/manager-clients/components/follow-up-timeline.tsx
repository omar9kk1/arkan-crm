import type { FollowUp } from '../mock-data';
import styles from './clients.module.css';
export function FollowUpTimeline({
  entries,
}: {
  entries: readonly FollowUp[];
}) {
  if (!entries.length) return <p>لا توجد متابعات مسجلة في هذه العينة.</p>;
  return (
    <ol className={styles.timeline}>
      {entries.map((entry) => (
        <li key={entry.id}>
          <div className={styles.row}>
            <time dateTime={entry.date}>{entry.date}</time>
            <span>{entry.employee}</span>
          </div>
          <strong>{entry.result}</strong>
          <p>{entry.note}</p>
        </li>
      ))}
    </ol>
  );
}
