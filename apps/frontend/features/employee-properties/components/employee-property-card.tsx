import type { Property } from '../model';
import styles from './properties.module.css';
import shared from '../../manager-properties/components/properties.module.css';
export function PropertyStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`${styles.badge} ${status === 'مطلوب تعديل' ? styles.warning : ''}`}
    >
      {status}
    </span>
  );
}
export function EmployeePropertyCard({
  property: p,
  onOpen,
}: {
  property: Property;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={shared.propertyCard}
      onClick={onOpen}
      aria-label={`تفاصيل ${p.title} ${p.code}`}
    >
      <span className={shared.badges}>
        <PropertyStatusBadge status={p.status} />{' '}
        <span className={styles.badge}>{p.operation}</span>
      </span>
      <span className={shared.propertyContent}>
        <strong className={shared.price}>
          {p.price
            ? `${Number(p.price).toLocaleString('ar-KW')} د.ك`
            : 'السعر غير محدد'}
        </strong>
        <b>{p.title}</b>
        <span className={shared.meta}>
          {p.region} · {p.code}
        </span>
        <span className={shared.specs}>
          <span>{p.area} م²</span>
          <span>{p.rooms}</span>
          <span className={shared.detailsLink}>تفاصيل</span>
        </span>
      </span>
    </button>
  );
}
