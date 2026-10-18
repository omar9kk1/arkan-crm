'use client';
import { useState } from 'react';
import type { Property } from '../model';
import {
  useInViewport,
  usePropertyImage,
} from '../../../lib/api/use-property-image';
import { responsibleLabel, statusLabel } from '../../../lib/property-adapter';
import styles from './properties.module.css';

export function PropertyStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`${styles.badge} ${status === 'مطلوب تعديل' ? styles.warning : ''}`}
    >
      {status}
    </span>
  );
}
export function EmployeePropertyCard({
  property: p,
  onOpen,
}: {
  property: Property;
  onOpen: () => void;
}) {
  // Rows fetch their private image only as they approach the viewport.
  const { ref, inView } = useInViewport<HTMLButtonElement>();
  const image = usePropertyImage(
    p.primaryImageUrl && p.id ? p.id : null,
    inView,
  );
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imageSrc = image.src && image.src !== failedSrc ? image.src : null;
  const district = p.region.trim() || 'المنطقة غير محددة';
  const status = statusLabel(p);
  const responsible = responsibleLabel(p);
  const amount = Number(p.price);
  const price =
    p.price.trim() && Number.isFinite(amount) && amount >= 0
      ? `${amount.toLocaleString('ar-KW', { maximumFractionDigits: 3 })} د.ك`
      : 'السعر غير محدد';
  return (
    <button
      ref={ref}
      type="button"
      className={styles.imageCard}
      onClick={onOpen}
      aria-label={`تفاصيل العقار: ${district}، ${price}، ${status}`}
    >
      <span className={styles.cardPhoto} aria-hidden="true">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt=""
            onError={() => setFailedSrc(imageSrc)}
          />
        ) : (
          <svg
            className={styles.imageFallback}
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8" />
          </svg>
        )}
      </span>
      <span className={styles.cardPills}>
        <span className={styles.cardStatus}>{status}</span>
        {responsible && (
          <span className={styles.cardResponsible}>{responsible}</span>
        )}
      </span>
      <span className={styles.imageCardOverlay}>
        <span className={styles.cardDistrict}>{district}</span>
        <strong className={styles.cardPrice}>{price}</strong>
      </span>
    </button>
  );
}
