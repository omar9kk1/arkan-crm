'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { PropertyDetailsDrawer } from '../../manager-properties/components/property-details-drawer';
import { ClientReviewDetailsDrawer } from '../../client-reviews/components/client-review-details-drawer';
import {
  getOwnerClientReview,
  type ClientReviewDetailDto,
} from '../../../lib/api/client-reviews-api';
import { getProperty } from '../../../lib/api/properties-api';
import type { PropertyViewDto } from '../../../lib/api/property-types';
import type { SystemLogDetailsRefDto } from '../../../lib/api/system-log-types';
import { mapPreviewFromApi } from '../../../lib/property-adapter';
import { useAuth } from '../../auth/components/auth-provider';

/**
 * Read-only bridge from the OWNER system log to the SAME review drawers the
 * manager uses. It fetches exactly the audit-referenced id through the existing
 * authorized GET endpoints and never passes a mutation callback.
 */
export function SystemLogDetailsDrawer({
  details,
  onClose,
}: {
  details: SystemLogDetailsRefDto;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [review, setReview] = useState<ClientReviewDetailDto | null>(null);
  const [property, setProperty] = useState<PropertyViewDto | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setReview(null);
    setProperty(null);

    const load =
      details.type === 'CLIENT_REVIEW'
        ? getOwnerClientReview(details.id)
        : getProperty(details.id);

    void load
      .then((result) => {
        if (cancelled) return;
        if (details.type === 'CLIENT_REVIEW')
          setReview(result as ClientReviewDetailDto);
        else setProperty(result as PropertyViewDto);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof Error
            ? cause.message
            : details.type === 'CLIENT_REVIEW'
              ? 'تعذر تحميل تفاصيل طلب المراجعة.'
              : 'تعذر تحميل تفاصيل العقار.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [details.id, details.type, reloadKey]);

  if (loading || error) {
    return (
      <PropertyOverlay
        title="تفاصيل السجل"
        drawer
        onClose={onClose}
        footer={
          error ? (
            <div>
              <p role="alert">{error}</p>
              <Button type="button" onClick={() => setReloadKey((key) => key + 1)}>
                إعادة المحاولة
              </Button>
            </div>
          ) : null
        }
      >
        {loading ? (
          <p role="status">جارٍ تحميل تفاصيل السجل...</p>
        ) : (
          <p>التفاصيل غير متاحة. قد يكون السجل المرتبط قد حُذف أو تغيّر.</p>
        )}
      </PropertyOverlay>
    );
  }

  if (review) {
    return (
      <ClientReviewDetailsDrawer
        open
        detail={review}
        loading={false}
        busy={false}
        isManager={false}
        canDecide={false}
        canResubmit={false}
        readOnly
        decisionNote=""
        onDecisionNoteChange={() => undefined}
        onDecide={() => undefined}
        onResubmit={() => undefined}
        onClose={onClose}
      />
    );
  }

  if (property) {
    return (
      <PropertyDetailsDrawer
        property={mapPreviewFromApi(property, user)}
        onClose={onClose}
        readOnly
      />
    );
  }

  return null;
}
