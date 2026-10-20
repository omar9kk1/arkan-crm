import { Card } from '../../../components/ui/card';
import cardStyles from '../../../components/ui/card.module.css';
import type { KeyboardEvent } from 'react';
import {
  isLate,
  localDate,
  type ClientInterest,
  type EmployeeClient,
  type FollowUp,
  type SuitableProperty,
} from '../client-model';
import styles from './clients.module.css';
/**
 * The WHOLE card is the way to open the client's details drawer — no separate
 * «تفاصيل» button inside. Accessible as a button role with Enter/Space, the
 * shared gold focus ring, and pointer cursor; the card's grid, content and
 * badge stay exactly as before. No nested interactive controls remain, so a
 * card click can never double-fire.
 */
export function EmployeeClientCard({
  client,
  onOpen,
}: {
  client: EmployeeClient;
  onOpen: () => void;
}) {
  const open = () => onOpen();
  // Keyboard equivalence with a real button (Space scrolls by default).
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  };
  return (
    <Card
      className={styles.client}
      onClick={open}
      role="button"
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label={`فتح ملف ${client.name}`}
    >
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
        <span className={styles.badge}>
          {isLate(client, localDate()) ? 'متأخر' : client.properties.length ? 'نشط' : 'بدون عقار مناسب'}
        </span>
      </div>
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
            <p>الموظف: {item.employee}</p>
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

/**
 * One recorded interest of the client in an EXISTING program property. When the
 * caller supplies `onOpenProperty` (and the row carries the stable
 * `Property.id` it always does), the card is a button asking the properties
 * page to open that EXACT property in its existing drawer — same deep-link
 * channel the owner cards use.
 */
export function ClientInterestMiniCard({
  interest,
  onOpenProperty,
}: {
  interest: ClientInterest;
  onOpenProperty?: (propertyId: string) => void;
}) {
  const content = (
    <>
      {/* The property title alone fills its readable line. */}
      <h3>{interest.name}</h3>
      {/* The display code travels on its OWN line below the title; the
          temporary mirror row (no title data yet) reuses the code as the
          title, so the badge hides to avoid showing it twice. */}
      {interest.code && interest.code !== interest.name ? (
        <span className={styles.interestCode}>{interest.code}</span>
      ) : null}
      {interest.area ? <p>{interest.area}</p> : null}
      <strong>{interest.price}</strong>
      {interest.reason ? <p>سبب الاهتمام: {interest.reason}</p> : null}
      {interest.notes ? <p>{interest.notes}</p> : null}
    </>
  );
  if (onOpenProperty)
    return (
      // The button carries the SAME card surface class, so the deep-link card
      // looks exactly like the plain one — without invalid button>section DOM.
      <button
        type="button"
        className={`${cardStyles.card} ${styles.propertyLink} ${styles.interestCard}`}
        onClick={() => onOpenProperty(interest.propertyId)}
        aria-label={`فتح عقار ${interest.name}`}
      >
        {content}
      </button>
    );
  return <Card className={styles.interestCard}>{content}</Card>;
}
