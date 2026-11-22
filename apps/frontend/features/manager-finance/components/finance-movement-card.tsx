import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import {
  money,
  movementCardDisplay,
  movementLabels,
  type FinanceMovement,
} from '../finance-model';
import styles from './finance.module.css';
export function FinanceMovementCard({
  movement,
  onOpen,
}: {
  movement: FinanceMovement;
  onOpen: () => void;
}) {
  const display = movementCardDisplay(movement);
  return (
    <Card
      className={`${styles.movement} ${movement.direction === 'داخل' ? styles.income : styles.outgoing}`}
      onClick={onOpen}
    >
      <div>
        <span className={styles.badge}>
          {movementLabels[movement.type]} • {movement.direction} •{' '}
          {movement.status}
        </span>
        <h3>{display.title}</h3>
        {display.party && <p>الطرف: {display.party}</p>}
        {display.property && <p>العقار: {display.property}</p>}
        {display.employee && <p>الموظف: {display.employee}</p>}
      </div>
      <div className={styles.amount}>
        <strong>{money(movement.amountFils, movement.currency)}</strong>
        <time dateTime={movement.date}>{movement.date}</time>
        <Button
          aria-label={`تفاصيل ${display.title}`}
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
