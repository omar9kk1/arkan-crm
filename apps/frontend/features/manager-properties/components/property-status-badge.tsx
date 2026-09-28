import type { PropertyStatus } from '../preview-data';
import styles from './properties.module.css';
export function PropertyStatusBadge({ status }: { status: PropertyStatus }) {
  return (
    <span
      className={`${styles.badge} ${status === 'معتمد' ? styles.approved : ''}`}
    >
      {status}
    </span>
  );
}
