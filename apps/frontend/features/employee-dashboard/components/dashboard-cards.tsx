import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { StatCard } from '../../../components/ui/stat-card';
import type { followups, properties, clients } from '../preview-data';
import styles from './employee-dashboard.module.css';
export function EmployeeStatCard({
  title,
  value,
}: {
  title: string;
  value: number;
}) {
  return (
    <StatCard title={title} value={value} hint="بيانات تجريبية" icon="users" />
  );
}
export function FollowUpCard({
  item,
  onOpen,
}: {
  item: (typeof followups)[number];
  onOpen: () => void;
}) {
  return (
    <Card className={styles.small} onClick={onOpen}>
      <h3>{item.name}</h3>
      <p>
        {item.type} · {item.time}
      </p>
      <span className={styles.badge}>{item.status}</span>
      <Button
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        aria-label={`تفاصيل متابعة ${item.name}`}
      >
        تفاصيل
      </Button>
    </Card>
  );
}
export function EmployeePropertyCard({
  item,
  onOpen,
}: {
  item: (typeof properties)[number];
  onOpen: () => void;
}) {
  return (
    <Card className={`${styles.small} ${styles.property}`} onClick={onOpen}>
      <span className={styles.badge}>{item.status}</span>
      <div className={styles.propertyText}>
        <strong>{item.price}</strong>
        <h3>{item.name}</h3>
        <p>{item.area}</p>
        <Button
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          aria-label={`تفاصيل ${item.name}`}
        >
          تفاصيل
        </Button>
      </div>
    </Card>
  );
}
export function ClientMiniCard({ item }: { item: (typeof clients)[number] }) {
  return (
    <Card className={styles.small}>
      <h3>{item.name}</h3>
      <p>{item.request}</p>
      <p>
        آخر متابعة: <time dateTime={item.last}>{item.last}</time>
      </p>
      <span className={styles.badge}>{item.status}</span>
    </Card>
  );
}
