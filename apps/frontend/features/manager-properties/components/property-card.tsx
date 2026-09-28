import type { PreviewProperty } from '../preview-data';
import { PropertyStatusBadge } from './property-status-badge';
import styles from './properties.module.css';
export function PropertyCard({
  property,
  onOpen,
}: {
  property: PreviewProperty;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.propertyCard}
      onClick={onOpen}
      aria-label={`تفاصيل ${property.title} ${property.code}`}
    >
      <span className={styles.badges}>
        <PropertyStatusBadge status="معتمد" />
        <PropertyStatusBadge status={property.status} />
      </span>
      <span className={styles.propertyContent}>
        <strong className={styles.price}>{property.price}</strong>
        <strong>{property.title}</strong>
        <span className={styles.meta}>
          {property.region} · <bdi>{property.code}</bdi>
        </span>
        <span className={styles.specs}>
          <span>{property.area} م²</span>
          <span>{property.rooms}</span>
          <span className={styles.detailsLink}>تفاصيل</span>
        </span>
      </span>
    </button>
  );
}
