'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '../../../components/ui/card';
import { Toast } from '../../../components/ui/toast';
import { ApiError } from '../../../lib/api-client';
import {
  approveClientReview,
  getClientReview,
  getClientReviewCount,
  listClientReviews,
  rejectClientReview,
  requestChangesOnClientReview,
  resubmitClientReview,
  type ClientReviewDetailDto,
  type ClientReviewSummaryDto,
} from '../../../lib/api/client-reviews-api';
import {
  ClientReviewDetailsDrawer,
  reviewDateLabel,
  STATUS_LABELS,
  type ReviewDecision,
} from './client-review-details-drawer';
import { useClientsDataRefreshSignal } from '../../notifications/clients-refresh';
// The SAME Astra pill vocabulary the clients cards (and the review drawer
// header) use — the tab badge counts render with the identical styling.
import pageStyles from '../../manager-clients/components/clients.module.css';
import styles from './client-reviews.module.css';

export type ClientReviewsRole = 'MANAGER' | 'EMPLOYEE';

const KIND_LABELS: Record<ClientReviewSummaryDto['kind'], string> = {
  CREATION: 'طلب إضافة عميل',
  EDIT: 'طلب تعديل عميل',
};

/** Subtle amber pill for still-active requests; decided ones stay neutral. */
const STATUS_PILLS: Record<ClientReviewSummaryDto['status'], string> = {
  PENDING: `${pageStyles.badge} ${pageStyles.warning}`,
  CHANGES_REQUESTED: `${pageStyles.badge} ${pageStyles.warning}`,
  APPROVED: `${pageStyles.badge}`,
  REJECTED: `${pageStyles.badge}`,
};

/** Server Arabic copy first; a generic Arabic fallback otherwise. */
function serverMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError && cause.messages.length) return cause.messages[0] ?? fallback;
  if (cause instanceof Error && cause.message) return cause.message;
  return fallback;
}

/**
 * The SHARED «تحت المراجعة» tab of the clients pages (manager + employee).
 *
 * It reads the same authorized feed (`GET /client-reviews`): an employee sees
 * their OWN submissions and their outcomes; a manager sees every submission
 * and holds the decision buttons. A row click opens the ONE shared
 * `ClientReviewDetailsDrawer` — the exact same layout for both roles; only the
 * footer actions differ, following the backend's permission checks.
 *
 * The manager decision writes NOTHING silently: approve applies the reviewed
 * proposal exactly, reject keeps the approved row untouched, request-changes
 * returns it to the requester. A stale approval answers 409 and stays open.
 */
export function ClientReviewsTab({
  role,
  focusReviewId = '',
  onCountChange,
  onOpenProperty,
}: {
  role: ClientReviewsRole;
  /** Deep-link id from the bell (`?client-review=…`); opens that drawer. */
  focusReviewId?: string;
  /**
   * The page's «تحت المراجعة» badge counter: the mounted tab reports its
   * refreshed feed length here (after every refetch — mount, decision,
   * resubmit, refresh signal) so the number always matches the list it
   * labels, with no second fetching path.
   */
  onCountChange?: (count: number) => void;
  /**
   * Optional authorized property deep link (same contract as the client
   * drawers): when provided, each linked-property row opens the exact
   * property in the existing properties page.
   */
  onOpenProperty?: (propertyId: string) => void;
}) {
  const [items, setItems] = useState<ClientReviewSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClientReviewDetailDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [decisionNote, setDecisionNote] = useState('');
  const [busy, setBusy] = useState(false);
  const focusedRef = useRef('');

  // The counter callback lives in a ref so `refresh` keeps ONE identity (the
  // mount effect below must not re-run just because a parent re-created it).
  const onCountChangeRef = useRef(onCountChange);
  onCountChangeRef.current = onCountChange;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // The cards feed and the badge counter travel together: the exact
      // PENDING count (backend-scoped, accurate beyond any list window)
      // drives the page's «تحت المراجعة» badge.
      const [page, counter] = await Promise.all([
        listClientReviews(),
        getClientReviewCount().catch(() => null),
      ]);
      setItems(page.items);
      if (counter) onCountChangeRef.current?.(counter.pending);
    } catch (cause) {
      setError(serverMessage(cause, 'تعذر تحميل طلبات المراجعة.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The existing clients data-refresh signal (the bell's publisher): when new
  // record activity arrives, the already-open tab re-reads its feed silently —
  // no extra timer, no new fetching system — and reports the fresh count too.
  const refreshSignal = useClientsDataRefreshSignal();
  useEffect(() => {
    if (refreshSignal === 0) return;
    void refresh();
  }, [refreshSignal, refresh]);

  const openDetail = useCallback(async (id: string) => {
    setDetailId(id);
    setDecisionNote('');
    setDetailLoading(true);
    setError('');
    try {
      setDetail(await getClientReview(id));
    } catch (cause) {
      setError(serverMessage(cause, 'تعذر تحميل تفاصيل الطلب.'));
      setDetail(null);
      setDetailId(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Deep link from a notification bell click: load EXACTLY that review by its
  // persistent id through the detail API — never through the currently loaded
  // or filtered list — so historical notifications keep working after the
  // status changed (APPROVED / REJECTED / CHANGES_REQUESTED) or the row left
  // the delivered list window. Missing/unauthorized ids close the drawer and
  // surface the clear error row instead of an empty drawer.
  //
  // The parents strip the transient URL param (replace) right after handling:
  // an EMPTY param therefore re-arms the link, so clicking the SAME
  // notification later reopens it even while still on the page.
  useEffect(() => {
    if (!focusReviewId) {
      focusedRef.current = '';
      return;
    }
    if (focusedRef.current === focusReviewId) return;
    focusedRef.current = focusReviewId;
    void openDetail(focusReviewId);
  }, [focusReviewId, openDetail]);

  const isManager = role === 'MANAGER';
  const canDecide = (row?: ClientReviewDetailDto | null) =>
    Boolean(row) && (row?.status === 'PENDING' || row?.status === 'CHANGES_REQUESTED');

  const decide = async (action: ReviewDecision) => {
    if (!detail || !canDecide(detail) || busy) return;
    setBusy(true);
    try {
      const payload = { reviewNotes: decisionNote.trim() || null };
      if (action === 'APPROVED') await approveClientReview(detail.id, payload);
      else if (action === 'REJECTED') await rejectClientReview(detail.id, payload);
      else await requestChangesOnClientReview(detail.id, payload);
      if (action === 'CHANGES_REQUESTED')
        setNotice('أُعيد طلب العميل إلى الموظف مع طلب التعديل.');
      else if (action === 'REJECTED')
        setNotice('رُفض طلب العميل ولم يتغير أي سجل معتمد.');
      else setNotice('تم تطبيق الطلب المعتمد على سجل العميل.');
      setDetailId(null);
      setDetail(null);
      await refresh();
    } catch (cause) {
      setNotice(serverMessage(cause, 'تعذر تنفيذ القرار. حدّث الطلب وحاول مرة أخرى.'));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  /** The requester's ONE authorized correction round (CHANGES_REQUESTED
   *  only): re-stage the proposal on the current approved state. Any other
   *  status (PENDING included) is refused locally AND answers a safe 409
   *  server-side with no write and no notification. */
  const resubmit = async () => {
    if (!detail || detail.status !== 'CHANGES_REQUESTED' || busy) return;
    setBusy(true);
    try {
      const p = detail.proposed;
      await resubmitClientReview(detail.id, {
        kind: detail.kind,
        ...(detail.kind === 'EDIT' && detail.clientId ? { clientId: detail.clientId } : {}),
        name: p.name,
        phone: p.phone,
        notes: p.notes,
        requestData: p.requestData,
        ...(p.addInterests.length
          ? {
              addInterests: p.addInterests.map((interest) => ({
                propertyId: interest.propertyId,
                reason: interest.reason,
                notes: interest.notes,
              })),
            }
          : {}),
        ...(detail.kind === 'EDIT' && p.removeInterests.length
          ? { removeInterests: p.removeInterests.map((i) => i.propertyId) }
          : {}),
      });
      setNotice('أُعيد إرسال الطلب بناء على أحدث حالة معتمدة.');
      await openDetail(detail.id);
      await refresh();
    } catch (cause) {
      setNotice(serverMessage(cause, 'تعذر إعادة إرسال الطلب. حاول مرة أخرى.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="طلبات المراجعة">
      {loading && (
        <p role="status" aria-live="polite">
          جارٍ تحميل طلبات المراجعة…
        </p>
      )}
      {!loading && error && (
        <p role="alert">{error}</p>
      )}
      {!loading && !error && items.length === 0 && (
        <Card>لا توجد طلبات مراجعة مسجّلة.</Card>
      )}
      {!loading && !error && items.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          {items.map((item) => (
            <Card key={item.id}>
              <button
                type="button"
                className={styles.cardButton}
                onClick={() => void openDetail(item.id)}
              >
                <span className={styles.cardHead}>
                  {/* Two-line title: the request kind as a small muted line,
                      the client's actual name alone below it (larger/bold).
                      The status badge stays opposite, never squeezed. */}
                  <span className={styles.cardTitleGroup}>
                    <span className={styles.cardKind}>{KIND_LABELS[item.kind]}</span>
                    <strong className={styles.cardTitle}>
                      <bdi>{item.clientName?.trim() || 'بدون اسم'}</bdi>
                    </strong>
                  </span>
                  <span className={`${STATUS_PILLS[item.status]} ${styles.cardStatus}`}>
                    {STATUS_LABELS[item.status]}
                  </span>
                </span>
                {/* Second row, clearly separated: requester on the RIGHT,
                    date on the LEFT (RTL), each isolated for mixed
                    Arabic/English text. On narrow screens each becomes its
                    own readable row (see the media query). */}
                <span className={styles.cardMeta}>
                  <span className={styles.cardMetaItem}>
                    مقدم الطلب: <bdi>{item.requesterName}</bdi>
                  </span>
                  <span className={styles.cardMetaItem}>
                    التاريخ: <bdi>{reviewDateLabel(item.createdAt)}</bdi>
                  </span>
                </span>
                {item.reviewNotes && (
                  <p className={styles.cardFeedback}>{item.reviewNotes}</p>
                )}
              </button>
            </Card>
          ))}
        </div>
      )}

      {/* ONE shared drawer for both roles — see client-review-details-drawer. */}
      <ClientReviewDetailsDrawer
        open={Boolean(detailId)}
        detail={detail}
        loading={detailLoading}
        busy={busy}
        isManager={isManager}
        canDecide={canDecide(detail)}
        canResubmit={!isManager && detail?.status === 'CHANGES_REQUESTED'}
        decisionNote={decisionNote}
        onDecisionNoteChange={setDecisionNote}
        onDecide={(action) => void decide(action)}
        onResubmit={() => void resubmit()}
        onOpenProperty={onOpenProperty}
        onClose={() => {
          setDetailId(null);
          setDetail(null);
        }}
      />

      <Toast message={notice} onDismiss={() => setNotice('')} />
    </section>
  );
}
