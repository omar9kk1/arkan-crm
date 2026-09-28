import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { money, movementLabels, type FinanceMovement } from '../finance-model';
import styles from './finance.module.css';
export function FinanceMovementCard({
  movement,
  onOpen,
}: {
  movement: FinanceMovement;
  onOpen: () => void;
}) {
  return (
    <Card
      className={`${styles.movement} ${movement.direction === 'داخل' ? styles.income : styles.outgoing}`}
      onClick={onOpen}
    >
      <div>
        <span className={styles.badge}>
          {movementLabels[movement.type]} · {movement.direction}
        </span>
        <h3>{movement.title}</h3>
        <p>
          المصدر: {movement.sourceType} · {movement.sourceId}
        </p>
        <p>الطرف: {movement.party}</p>
        {movement.property && <p>العقار: {movement.property}</p>}
        {movement.employee && <p>الموظف: {movement.employee}</p>}
      </div>
      <div className={styles.amount}>
        <strong>{money(movement.amountFils, movement.currency)}</strong>
        <time dateTime={movement.date}>{movement.date}</time>
        <Button
          aria-label={`تفاصيل ${movement.reference}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          تفاصيل
        </Button>
      </div>
    </Card>
  );
}
