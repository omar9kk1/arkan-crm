import type { SuitableProperty } from '../mock-data';
import styles from './clients.module.css';
export function PersonProperties({
  properties,
}: {
  properties: readonly SuitableProperty[];
}) {
  return properties.length ? (
    <ul className={styles.timeline}>
      {properties.map((property) => (
        <li key={property.code}>
          <strong>{property.title}</strong>
          <span className={styles.badge}>{property.code}</span>
          <p>{property.summary}</p>
        </li>
      ))}
    </ul>
  ) : (
    <p>لا توجد عقارات مناسبة ضمن العينة الحالية.</p>
  );
}
