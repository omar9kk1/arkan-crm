import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { CommissionBreakdown } from './commission-breakdown';
import { money, type MockDeal } from '../mock-data';
import styles from './deals.module.css';
export function DealCard({
  deal,
  onOpen,
}: {
  deal: MockDeal;
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
        <span>تفاصيل الصفقة ←</span>
      </Button>
      <div className={styles.row}>
        <span>العميل: {deal.client.name}</span>
        <span className={styles.badge}>{deal.property.status}</span>
      </div>
      <div className={styles.row}>
        <strong>{money(deal.price)}</strong>
        <time dateTime={deal.date}>{deal.date}</time>
      </div>
      <CommissionBreakdown deal={deal} />
    </Card>
  );
}
