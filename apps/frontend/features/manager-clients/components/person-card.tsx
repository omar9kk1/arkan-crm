import styles from './clients.module.css';
export function PersonCard({
  name,
  phone,
  summary,
  employee,
  lastFollowUp,
  status,
  late,
  onOpen,
}: {
  name: string;
  phone: string;
  summary: string;
  employee: string;
  lastFollowUp: string;
  status: string;
  late: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.personCard} ${late ? styles.delayed : ''}`}
      onClick={onOpen}
      aria-label={`فتح ملف ${name}`}
    >
      <span className={styles.personMain}>
        <span className={styles.avatar} aria-hidden="true">
          {name.slice(0, 1)}
        </span>
        <span>
          <strong>{name}</strong>
          <span className={styles.secondary}>{summary}</span>
          <bdi className={styles.phone}>{phone}</bdi>
        </span>
      </span>
      <span>
        <span className={styles.secondary}>الموظف المتابع</span>
        <strong>{employee}</strong>
      </span>
      <span>
        <span className={styles.secondary}>آخر متابعة</span>
        <time dateTime={lastFollowUp}>{lastFollowUp}</time>
      </span>
      <span className={`${styles.badge} ${late ? styles.warning : ''}`}>
        {status}
      </span>
      {late && (
        <span className={styles.lateMessage}>
          توجد متابعة متأخرة تحتاج مراجعة من المدير
        </span>
      )}
    </button>
  );
}
