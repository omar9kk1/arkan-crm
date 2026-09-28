import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import {
  clientStatus,
  type EmployeeClient,
  type FollowUp,
  type SuitableProperty,
} from '../client-model';
import styles from './clients.module.css';
export function EmployeeClientCard({
  client,
  onOpen,
}: {
  client: EmployeeClient;
  onOpen: () => void;
}) {
  return (
    <Card className={styles.client} onClick={onOpen}>
      <div>
        <h3>{client.name}</h3>
        <p>
          <bdi>{client.phone}</bdi> · {client.type} · {client.area}
        </p>
        <p>الميزانية: {client.budget} د.ك</p>
      </div>
      <div>
        <p>آخر متابعة: {client.history[0]?.date || 'لم تسجل بعد'}</p>
        <p>المتابعة القادمة: {client.next || 'لم تحدد'}</p>
        <span className={styles.badge}>{clientStatus(client)}</span>
      </div>
      <Button
        compactOnMobile
        aria-label={`تفاصيل ${client.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        تفاصيل
      </Button>
    </Card>
  );
}
export function ClientFollowUpTimeline({ items }: { items: FollowUp[] }) {
  return (
    <div className={styles.list}>
      {items.length ? (
        items.map((item) => (
          <Card key={item.id}>
            <h3>
              {item.type} · {item.date}
            </h3>
            <p>الموظف: أحمد محمد</p>
            <p>{item.result}</p>
            <p>{item.note || 'لا توجد ملاحظة'}</p>
            <p>المتابعة القادمة: {item.next}</p>
          </Card>
        ))
      ) : (
        <p>لا توجد متابعات مسجلة.</p>
      )}
    </div>
  );
}
export function SuitablePropertyMiniCard({
  property,
}: {
  property: SuitableProperty;
}) {
  return (
    <Card>
      <h3>{property.name}</h3>
      <p>{property.area}</p>
      <strong>{property.price}</strong>
    </Card>
  );
}
