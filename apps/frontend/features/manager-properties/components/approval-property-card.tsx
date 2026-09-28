import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import type { ApprovalProperty } from '../preview-data';
import { PropertyStatusBadge } from './property-status-badge';
import styles from './properties.module.css';
export function ApprovalPropertyCard({
  property,
  onAction,
}: {
  property: ApprovalProperty;
  onAction: (action: string, property: ApprovalProperty) => void;
}) {
  return (
    <Card className={styles.approvalCard}>
      <div className={styles.approvalImage} aria-hidden="true" />
      <div>
        <PropertyStatusBadge status={property.status} />
        <h3>{property.title}</h3>
        <p>أرسله: {property.submittedBy}</p>
        <p>
          {property.code} · {property.area} م² · {property.rooms} ·{' '}
          {property.price}
        </p>
        <p>{property.submissionNote}</p>
        <div className={styles.actions}>
          {['اعتماد', 'طلب تعديل', 'رفض'].map((action) => (
            <Button
              key={action}
              onClick={() => onAction(action, property)}
              aria-label={`${action} ${property.code}`}
            >
              {action}
            </Button>
          ))}
        </div>
      </div>
    </Card>
  );
}
