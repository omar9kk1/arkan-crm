import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { CommissionBreakdown } from './commission-breakdown';
import {
  COMMISSION_STATUS_LABEL,
  money,
  type Deal,
  type DealCommission,
} from '../deal-model';
import styles from './deals.module.css';

const statusClass = (status: DealCommission['status']) =>
  status === 'PAID'
    ? styles.statusPaid
    : status === 'PENDING'
      ? styles.statusPending
      : '';

export function DealCard({
  deal,
  onOpen,
}: {
  deal: Deal;
  onOpen: () => void;
}) {
  return (
    <Card className={styles.dealCard}>
      <Button
        className={styles.cardTitle}
        onClick={onOpen}
        aria-label={`تفاصيل صفقة ${deal.propertyId}`}
      >
        <strong>
          {deal.type} {deal.property.title} · {deal.propertyId}
        </strong>
        <span>عرض التفاصيل ←</span>
      </Button>
      <div className={styles.row}>
        <span>العميل: {deal.client.name}</span>
        <span className={styles.badge}>{deal.property.statusLabel}</span>
      </div>
      <div className={styles.row}>
        <strong>{money(deal.price)}</strong>
        <time dateTime={deal.date}>{deal.date}</time>
      </div>
      <CommissionBreakdown
        deal={deal}
        renderEmployeeAction={(role) => {
          const commission = deal.commissions.find(
            (row) => row.role === role,
          );
          if (!commission) return null;
          return (
            <span
              className={`${styles.badge} ${statusClass(commission.status)}`}
            >
              {COMMISSION_STATUS_LABEL[commission.status]}
            </span>
          );
        }}
      />
    </Card>
  );
}
