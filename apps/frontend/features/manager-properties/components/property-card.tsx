'use client';
import { useState } from 'react';
import type { PreviewProperty } from '../preview-data';
import {
  useInViewport,
  usePropertyImage,
} from '../../../lib/api/use-property-image';
import { responsibleLabel, statusLabel } from '../../../lib/property-adapter';
import styles from './properties.module.css';

/**
 * Compact manager card matching the employee card: the whole surface is the
 * property image (16:21 portrait, edge to edge) with a status pill at the
 * top-right, a responsible-person pill at the top-left and only the district
 * and the asking price overlaid near the bottom. Titles, reference numbers,
 * area/room labels and the old details button stay removed from the card; the
 * full details and the review actions live inside the drawer this button opens.
 */
export function PropertyCard({
  property,
  onOpen,
}: {
  property: PreviewProperty;
  onOpen: () => void;
}) {
  // Only rows nearing the viewport fetch their private image, so a long list
  // does not issue one authenticated image request per card on mount.
  const { ref, inView } = useInViewport<HTMLButtonElement>();
  const image = usePropertyImage(
    property.primaryImageUrl && property.id ? property.id : null,
    inView,
  );
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imageSrc = image.src && image.src !== failedSrc ? image.src : null;
  const district = property.region.trim() || 'المنطقة غير محددة';
  const status = statusLabel(property);
  const responsible = responsibleLabel(property);
  return (
    <button
      ref={ref}
      type="button"
      className={styles.propertyCard}
      onClick={onOpen}
      aria-label={`تفاصيل العقار: ${district}، ${property.price}، ${status}`}
    >
      <span className={styles.cardImage} aria-hidden="true">
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
        <strong className={styles.cardPrice}>{property.price}</strong>
      </span>
    </button>
  );
}
