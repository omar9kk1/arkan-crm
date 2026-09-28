import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { money, type FinanceMovement } from '../finance-model';
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
          {movement.direction} · {movement.status}
        </span>
      </div>
      <dl className={styles.facts}>
        {[
          ['التاريخ', movement.date],
          ['المصدر', `${movement.sourceType} · ${movement.sourceId}`],
          ['الطرف', movement.party],
          ['الموظف', movement.employee ?? 'غير مرتبط بموظف'],
          ['العقار', movement.property ?? 'غير مرتبط بعقار'],
          ['العميل أو المالك', movement.clientOrOwner ?? 'غير مرتبط'],
          ['رقم العملية', movement.reference],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <bdi>{value}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      <h3>تفصيل الحساب</h3>
      <ul className={styles.list}>
        {movement.calculation.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <h3>ملاحظات</h3>
      <p>{movement.notes || 'لا توجد ملاحظات.'}</p>
      <p className={styles.muted}>
        تفاصيل تجريبية فقط، وليست سجلًا ماليًا محفوظًا.
      </p>
    </PropertyOverlay>
  );
}
