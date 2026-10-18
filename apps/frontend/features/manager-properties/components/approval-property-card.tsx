'use client';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import type { ApprovalProperty } from '../preview-data';
import {
  useInViewport,
  usePropertyImage,
} from '../../../lib/api/use-property-image';
import { PropertyStatusBadge } from './property-status-badge';
import styles from './properties.module.css';

/** Manager decision surface for one PENDING property. */
export function ApprovalPropertyCard({
  property,
  onAction,
  busy = false,
}: {
  property: ApprovalProperty;
  onAction: (action: string, property: ApprovalProperty) => void;
  /** True while a decision for this row is in flight — blocks a double click. */
  busy?: boolean;
}) {
  const { ref, inView } = useInViewport<HTMLDivElement>();
  const image = usePropertyImage(
    property.primaryImageUrl && property.id ? property.id : null,
    inView,
  );
  return (
    <Card className={styles.approvalCard} ref={ref}>
      {image.src ? (
        <div className={styles.approvalImage}>
          <img src={image.src} alt="صورة العقار" />
        </div>
      ) : (
        <div className={styles.approvalImage} aria-hidden="true" />
      )}
      <div>
        <PropertyStatusBadge status={property.status} />
        <h3>{property.title}</h3>
        <p>أرسله: {property.submittedBy}</p>
        <p>
          {property.code} ·{' '}
          {property.area ? `${property.area} م²` : 'المساحة غير محددة'} ·{' '}
          {property.rooms} · {property.price}
        </p>
        <p>{property.submissionNote}</p>
        <div className={styles.actions}>
          {['اعتماد', 'طلب تعديل', 'رفض'].map((action) => (
            <Button
              key={action}
              onClick={() => onAction(action, property)}
              aria-label={`${action} ${property.code}`}
              disabled={busy}
              aria-busy={busy}
            >
              {action}
            </Button>
          ))}
        </div>
      </div>
    </Card>
  );
}
