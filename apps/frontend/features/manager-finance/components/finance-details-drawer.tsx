import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import {
  money,
  movementDetailRows,
  type FinanceMovement,
} from '../finance-model';
import styles from './finance.module.css';
export function FinanceDetailsDrawer({
  movement,
  onClose,
}: {
  movement: FinanceMovement;
  onClose: () => void;
}) {
  return (
    <PropertyOverlay
      title={movement.title}
      drawer
      onClose={onClose}
      className={styles.detailsDrawer}
    >
      <div className={styles.amountSummary}>
        <span>قيمة الحركة</span>
        <strong>
          <bdi>{money(movement.amountFils, movement.currency)}</bdi>
        </strong>
        <span className={styles.badge}>
          {movement.direction} • {movement.status}
        </span>
      </div>
      <dl className={styles.facts}>
        {movementDetailRows(movement).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <bdi>{value}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      <h3>تفاصيل الحساب</h3>
      <ul className={styles.list}>
        {movement.calculation.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <h3>ملاحظات</h3>
      <p>{movement.notes || 'لا توجد ملاحظات.'}</p>
      <p className={styles.muted}>
        قراءة الحركة لا تغيّر حالتها المالية. لا تتوفر إجراءات تعديل أو صرف من
        هذا العرض.
      </p>
    </PropertyOverlay>
  );
}
