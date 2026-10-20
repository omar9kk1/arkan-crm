'use client';
import type { SuitableProperty } from '../client-model';
import styles from './clients.module.css';

/**
 * Renders a person's linked properties. Cards stay exactly as before; when the
 * caller supplies `onOpenProperty` AND the row carries a stable `Property.id`,
 * each card becomes a button that asks the properties page to open that exact
 * property in its EXISTING details drawer (never by code or array index).
 *
 * The manager client drawer passes no handler, so its cards are unchanged.
 */
export function PersonProperties({
  properties,
  onOpenProperty,
}: {
  properties: readonly SuitableProperty[];
  onOpenProperty?: (propertyId: string) => void;
}) {
  if (!properties.length)
    return <p>لا توجد عقارات مناسبة ضمن العينة الحالية.</p>;
  return (
    <ul className={styles.timeline}>
      {properties.map((property) => {
        const canOpen = Boolean(onOpenProperty && property.id);
        const content = (
          <>
            {/* Title alone fills its readable line; the code (when it differs
                from the title) drops to its own line below it. */}
            <strong className={styles.propTitle}>{property.title}</strong>
            {property.code && property.code !== property.title ? (
              <span className={`${styles.badge} ${styles.propCode}`}>
                {property.code}
              </span>
            ) : null}
            {/* District and price live on SEPARATE lines; legacy rows without
                them fall back to the old combined summary line. */}
            {property.area ? <p>{property.area}</p> : null}
            {property.price ? (
              <strong className={styles.propPrice}>{property.price}</strong>
            ) : null}
            {!property.area && !property.price && property.summary ? (
              <p>{property.summary}</p>
            ) : null}
            {property.reason ? <p>سبب الاهتمام: {property.reason}</p> : null}
            {property.notes ? <p>{property.notes}</p> : null}
          </>
        );
        return (
          <li key={property.id || property.code}
            className={styles.interestCard}
          >
            {canOpen ? (
              <button
                type="button"
                className={styles.propertyLink}
                onClick={() => onOpenProperty?.(property.id)}
                aria-label={`فتح عقار ${property.title}`}
              >
                {content}
              </button>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ul>
  );
}
