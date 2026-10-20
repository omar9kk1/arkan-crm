import styles from './clients.module.css';
import type { OwnerTypePill } from '../client-model';

export function PersonCard({
  name,
  phone,
  summary,
  employee,
  lastFollowUp,
  status,
  late,
  typePills,
  onOpen,
}: {
  name: string;
  phone: string;
  summary: string;
  employee: string;
  lastFollowUp: string;
  status: string;
  late: boolean;
  /** Compact transaction-type pills; when present they sit directly above the
   * status badge in the same grid cell, so the card layout never changes. */
  typePills?: readonly OwnerTypePill[];
  onOpen: () => void;
}) {
  const badge = (
    <span className={`${styles.badge} ${late ? styles.warning : ''}`}>
      {status}
    </span>
  );
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
      {typePills?.length ? (
        // Same grid cell as the bare badge below: the pills stack above it and
        // the card's columns and dimensions stay exactly as they were.
        <span className={styles.pillStack}>
          <span className={styles.typePills}>
            {typePills.map((pill) => (
              <span
                key={pill.type}
                className={styles.typePill}
                aria-label={`${pill.count} ${pill.label}`}
              >
                {pill.count} {pill.label}
              </span>
            ))}
          </span>
          {badge}
        </span>
      ) : (
        badge
      )}
      {late && (
        <span className={styles.lateMessage}>
          توجد متابعة متأخرة تحتاج مراجعة من المدير
        </span>
      )}
    </button>
  );
}
