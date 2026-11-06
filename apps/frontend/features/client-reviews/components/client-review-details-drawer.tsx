'use client';
import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import {
  clientLabels,
  fieldLabels,
  floorSummary,
  type ClientType,
} from '../../employee-clients/components/request-wizard/client-request-model';
import type { ClientReviewDetailDto } from '../../../lib/api/client-reviews-api';
import pageStyles from '../../manager-clients/components/clients.module.css';
import styles from './client-reviews.module.css';

/**
 * The ONE shared «تفاصيل طلب المراجعة» drawer of the clients pages.
 *
 * Both the manager and the employee «تحت المراجعة» tab render THIS component —
 * there is no second copy of the layout anywhere. The only differences between
 * the roles are the footer actions the parent passes in (manager: approve /
 * reject / request-changes; employee: resubmit), which follow the exact same
 * backend permission checks.
 */
export type ReviewDecision = 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';

/** The short request-type wording shown inside the drawer header. */
export const KIND_SHORT: Record<ClientReviewDetailDto['kind'], string> = {
  CREATION: 'إضافة عميل',
  EDIT: 'تعديل عميل',
};

export const STATUS_LABELS: Record<ClientReviewDetailDto['status'], string> = {
  PENDING: 'بانتظار الموافقة',
  APPROVED: 'تمت الموافقة',
  REJECTED: 'مرفوض',
  CHANGES_REQUESTED: 'مطلوب تعديل',
};

export const reviewDateLabel = (value: string | null): string =>
  value ? value.slice(0, 10) : '';

/* -------------------------------------------------------------------------
 * The persisted wizard request document (`Client.requestData`), decoded ONLY
 * for display. Every value rendered below comes straight from the stored
 * document — nothing is guessed, defaulted or invented; a malformed or absent
 * document simply yields the subtle empty state.
 * ---------------------------------------------------------------------- */

interface StoredRequestProperty {
  governorate?: string;
  area?: string;
  propertyType?: string;
  operationType?: string;
  budget?: string;
  budgetTo?: string;
  size?: string;
  roomsOrFloor?: string;
  duration?: string;
  specifications?: string;
  notes?: string;
  floors?: { name: string; portion: 'FULL' | 'HALF' | 'QUARTER'; details: string }[];
}

interface StoredRequestDraft {
  message?: string;
  requestDetails?: {
    desiredProperty?: StoredRequestProperty;
    currentProperty?: StoredRequestProperty;
    customFields?: { label: string; value: string }[];
  };
}

interface StoredRequestDocument {
  version?: number;
  types?: string[];
  requests?: Record<string, StoredRequestDraft>;
}

function parseRequestData(raw: string | null): StoredRequestDocument | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as StoredRequestDocument;
  } catch {
    return null;
  }
}

/** Non-empty persisted facts of one stored request part, label + value only. */
function storedFacts(
  data: StoredRequestProperty | undefined,
): { label: string; value: string }[] {
  if (!data) return [];
  const entries: (keyof typeof fieldLabels)[] = [
    'governorate',
    'area',
    'propertyType',
    'operationType',
    'budget',
    'budgetTo',
    'size',
    'roomsOrFloor',
    'duration',
    'specifications',
    'notes',
  ];
  return entries
    .map((key) => ({ label: fieldLabels[key], value: (data[key] ?? '').trim() }))
    .filter((entry) => entry.value);
}

/** Section B — the honest, already-persisted request details of the wizard. */
function RequestDataSection({ requestData }: { requestData: string | null }) {
  const stored = parseRequestData(requestData);
  const types = (stored?.types ?? []).filter(
    (type) => type === 'BUYER' || type === 'RENTER' || type === 'EXCHANGER',
  );
  const typeLabels = types.map((type) => clientLabels[type as ClientType] ?? type);
  const parts = types.flatMap((type) => {
    const draft = stored?.requests?.[type];
    return draft ? [{ type, draft }] : [];
  });
  const hasAnyFact = parts.some((part) => {
    const details = part.draft.requestDetails;
    return (
      Boolean(details?.desiredProperty) ||
      Boolean(details?.currentProperty) ||
      Boolean(details?.customFields?.length) ||
      Boolean(part.draft.message?.trim())
    );
  });

  return (
    <section className={styles.section} aria-label="تفاصيل الطلب">
      <h3 className={styles.sectionTitle}>تفاصيل الطلب</h3>
      {typeLabels.length ? (
        <div className={pageStyles.typePills} style={{ marginBottom: 'var(--space-3)' }}>
          {typeLabels.map((label) => (
            <span key={label} className={pageStyles.typePill}>
              {label}
            </span>
          ))}
        </div>
      ) : null}
      {parts.map(({ type, draft }) => {
        const details = draft.requestDetails;
        const desired = storedFacts(details?.desiredProperty);
        const current = storedFacts(details?.currentProperty);
        const floors = details?.desiredProperty?.floors ?? [];
        return (
          <div key={type} style={{ marginBottom: 'var(--space-3)' }}>
            {draft.message?.trim() ? (
              <div className={styles.noteBlock}>
                <span className={styles.noteLabel}>
                  طلب جديد — {clientLabels[type as ClientType] ?? type}
                </span>
                {draft.message.trim()}
              </div>
            ) : null}
            {desired.length ? (
              <dl className={pageStyles.facts}>
                {desired.map((entry) => (
                  <div key={entry.label}>
                    <dt>{entry.label}</dt>
                    <dd>
                      <bdi>{entry.value}</bdi>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {current.length ? (
              <>
                <p className={styles.noteLabel}>العقار الحالي:</p>
                <dl className={pageStyles.facts}>
                  {current.map((entry) => (
                    <div key={entry.label}>
                      <dt>{entry.label}</dt>
                      <dd>
                        <bdi>{entry.value}</bdi>
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : null}
            {floors.length ? (
              <p className={pageStyles.secondary}>
                الأدوار المسقطة:
                <br />
                <bdi>{floorSummary(floors)}</bdi>
              </p>
            ) : null}
            {(details?.customFields ?? []).map((field) => (
              <p key={field.label} className={pageStyles.secondary}>
                {field.label}: <bdi>{field.value}</bdi>
              </p>
            ))}
          </div>
        );
      })}
      {!typeLabels.length && !hasAnyFact && (
        <p className={styles.empty}>لا توجد تفاصيل طلب مسجّلة في هذا الطلب.</p>
      )}
    </section>
  );
}

/**
 * LEFT-side Astra drawer (≈520px, responsive) with a pinned header, an
 * independently scrolling body of organized sections and a pinned action
 * footer that never overlaps the content:
 *
 *   A. بيانات العميل        — proposed values, current ones as muted captions
 *   B. تفاصيل الطلب        — only persisted wizard fields, never invented
 *   C. العقارات المرتبطة   — one calm card per linked property (authorized
 *                             deep link when the parent provides it)
 *   D. التعديلات المقترحة  — the backend's real change list for EDIT rows;
 *                             a plain creation summary for CREATION rows
 *   E. الملاحظات           — client / submission / management notes blocks
 *
 * Role-specific actions are rendered by the PARENT's inputs only: managers get
 * approve / reject / request-changes while the state allows them, employees
 * get the permitted resubmission, and decided reviews stay read-only.
 */
export function ClientReviewDetailsDrawer({
  open,
  detail,
  loading,
  busy,
  isManager,
  canDecide,
  canResubmit,
  decisionNote,
  onDecisionNoteChange,
  onDecide,
  onResubmit,
  onOpenProperty,
  onClose,
}: {
  open: boolean;
  detail: ClientReviewDetailDto | null;
  loading: boolean;
  busy: boolean;
  isManager: boolean;
  canDecide: boolean;
  /** The requester's ONE authorized correction round (CHANGES_REQUESTED
   *  employee row). PENDING is read-only — the backend 409s a blind resend
   *  without any write or notification. */
  canResubmit: boolean;
  decisionNote: string;
  onDecisionNoteChange: (value: string) => void;
  onDecide: (action: ReviewDecision) => void;
  onResubmit: () => void;
  /** Optional authorized property deep link (same contract as client drawers). */
  onOpenProperty?: (propertyId: string) => void;
  onClose: () => void;
}) {
  /**
   * The decision notes are REVEALED ON DEMAND only: «موافقة وتطبيق» decides
   * directly (no textarea), while «رفض» / «طلب تعديل» open this compact
   * inline section for their reason text. Cancel returns to the three plain
   * action buttons. The note value itself stays parent-owned (`decisionNote`)
   * so the existing decision calls, validation and error handling are reused
   * untouched.
   */
  const [noteAction, setNoteAction] = useState<'REJECTED' | 'CHANGES_REQUESTED' | null>(
    null,
  );
  // Opening another review always starts from the plain three-button state.
  useEffect(() => {
    setNoteAction(null);
  }, [detail?.id]);

  if (!open) return null;
  return (
    <PropertyOverlay
      title="تفاصيل طلب المراجعة"
      drawer
      className={styles.reviewDrawer}
      headerDetails={
        detail ? (
          <div className={styles.metaRow}>
            <span
              className={`${pageStyles.badge}${
                detail.status === 'PENDING' || detail.status === 'CHANGES_REQUESTED'
                  ? ` ${pageStyles.warning}`
                  : ''
              }`}
            >
              {STATUS_LABELS[detail.status]}
            </span>
            <span>{KIND_SHORT[detail.kind]}</span>
            <span>
              {detail.requesterName} · <bdi>{reviewDateLabel(detail.createdAt)}</bdi>
            </span>
          </div>
        ) : null
      }
      onClose={onClose}
      /* Actions live in the overlay's pinned footer (sibling of the scroll
         body), so decision buttons never cover the content. */
      footer={
        detail ? (
          canResubmit ? (
            /* The ONE authorized resubmission round: the manager asked for
               corrections (CHANGES_REQUESTED). Enabled again exactly when
               that round exists; the backend 409s any further click. */
            <div className={styles.footerActions}>
              <Button type="button" disabled={busy} onClick={onResubmit}>
                إعادة إرسال الطلب
              </Button>
              <p className={styles.footerNote}>
                إعادة الإرسال تعيد بناء الطلب على أحدث حالة معتمدة بعد
                قراءة ملاحظات الإدارة.
              </p>
            </div>
          ) : canDecide ? (
            <div className={styles.footerActions}>
              {isManager ? (
                noteAction ? (
                  /* Compact inline section: reason required by the click that
                     opened it; the SAME decide call runs on confirm. */
                  <div className={`${pageStyles.field} ${styles.noteSection}`}>
                    <label htmlFor="review-note">
                      {noteAction === 'REJECTED' ? 'سبب الرفض' : 'التعديلات المطلوبة'}
                    </label>
                    <textarea
                      id="review-note"
                      value={decisionNote}
                      rows={2}
                      maxLength={2000}
                      autoFocus
                      onChange={(event) => onDecisionNoteChange(event.target.value)}
                    />
                    <div className={styles.noteSectionActions}>
                      <Button
                        type="button"
                        variant="primary"
                        disabled={busy}
                        onClick={() => onDecide(noteAction)}
                      >
                        {noteAction === 'REJECTED' ? 'تأكيد الرفض' : 'إرسال طلب التعديل'}
                      </Button>
                      <Button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          onDecisionNoteChange('');
                          setNoteAction(null);
                        }}
                      >
                        إلغاء
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="primary"
                      disabled={busy}
                      onClick={() => onDecide('APPROVED')}
                    >
                      موافقة وتطبيق
                    </Button>
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        onDecisionNoteChange('');
                        setNoteAction('CHANGES_REQUESTED');
                      }}
                    >
                      طلب تعديل
                    </Button>
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        onDecisionNoteChange('');
                        setNoteAction('REJECTED');
                      }}
                    >
                      رفض
                    </Button>
                  </>
                )
              ) : (
                /* Employee + PENDING: a clear read-only state while the
                   manager reviews — NO active resubmit control (a blind
                   resend click can neither reach nor spam the manager). */
                <p className={styles.footerNote}>
                  بانتظار مراجعة المدير — لا توجد إجراءات متاحة على هذا الطلب.
                </p>
              )}
            </div>
          ) : (
            <div className={styles.footerActions}>
              <p className={styles.footerNote}>
                رُوجع الطلب بتاريخ{' '}
                <bdi>{reviewDateLabel(detail.reviewedAt) || '—'}</bdi> — لا توجد
                إجراءات متاحة على هذا الطلب.
              </p>
            </div>
          )
        ) : null
      }
    >
      {loading && (
        <p role="status" aria-live="polite">
          جارٍ تحميل تفاصيل الطلب…
        </p>
      )}
      {!loading && detail && (
        <>
          {/* A. بيانات العميل — proposed values, current ones as a muted
              caption wherever an EDIT actually changes them. */}
          <section className={styles.section} aria-label="بيانات العميل">
            <h3 className={styles.sectionTitle}>بيانات العميل</h3>
            <dl className={pageStyles.facts}>
              <div>
                <dt>اسم العميل</dt>
                <dd>
                  {detail.proposed.name}
                  {detail.current && detail.current.name !== detail.proposed.name ? (
                    <span className={styles.valueOld}>
                      الحالي: {detail.current.name}
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>رقم الهاتف</dt>
                <dd>
                  <bdi dir="ltr">{detail.proposed.phone}</bdi>
                  {detail.current && detail.current.phone !== detail.proposed.phone ? (
                    <span className={styles.valueOld}>
                      الحالي: <bdi dir="ltr">{detail.current.phone}</bdi>
                    </span>
                  ) : null}
                </dd>
              </div>
            </dl>
          </section>

          {/* B. تفاصيل الطلب — only the persisted wizard fields. */}
          <RequestDataSection requestData={detail.proposed.requestData} />

          {/* C. العقارات المرتبطة — one calm card per property. */}
          <section className={styles.section} aria-label="العقارات المرتبطة">
            <h3 className={styles.sectionTitle}>العقارات المرتبطة</h3>
            {detail.proposed.addInterests.length ||
            detail.proposed.removeInterests.length ? (
              <ul className={pageStyles.timeline}>
                {detail.proposed.addInterests.map((interest) => {
                  const body = (
                    <>
                      <bdi className={pageStyles.propCode} dir="ltr">
                        {interest.reference ?? interest.propertyId}
                      </bdi>
                      {interest.title ? (
                        <strong className={pageStyles.propTitle}>{interest.title}</strong>
                      ) : null}
                      {interest.reason ? <p>سبب الاستفسار: {interest.reason}</p> : null}
                      {interest.notes ? <p>ملاحظات: {interest.notes}</p> : null}
                    </>
                  );
                  return (
                    <li
                      key={`add-${interest.propertyId}`}
                      className={pageStyles.interestCard}
                    >
                      {onOpenProperty ? (
                        <button
                          type="button"
                          className={pageStyles.propertyLink}
                          onClick={() => onOpenProperty(interest.propertyId)}
                        >
                          {body}
                        </button>
                      ) : (
                        body
                      )}
                    </li>
                  );
                })}
                {detail.proposed.removeInterests.map((interest) => (
                  <li
                    key={`drop-${interest.propertyId}`}
                    className={pageStyles.interestCard}
                  >
                    <bdi className={pageStyles.propCode} dir="ltr">
                      {interest.reference ?? interest.propertyId}
                    </bdi>
                    <strong className={pageStyles.propTitle}>
                      يُزال من الاستفسارات المسجلة
                    </strong>
                    {interest.title ? <p>{interest.title}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.empty}>لا توجد عقارات مرتبطة بهذا الطلب.</p>
            )}
          </section>

          {/* D. التعديلات المقترحة — the backend's real change list for EDIT
              rows; a plain creation summary, never a fake diff. */}
          <section className={styles.section} aria-label="التعديلات المقترحة">
            <h3 className={styles.sectionTitle}>التعديلات المقترحة</h3>
            {detail.kind === 'EDIT' ? (
              detail.diff.length ? (
                <ul className={styles.changeList}>
                  {detail.diff.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className={styles.empty}>
                  لا توجد تعديلات عن الحالة المعتمدة الحالية.
                </p>
              )
            ) : (
              <p className={styles.empty}>
                طلب إضافة عميل جديد: لا توجد بيانات سابقة للمقارنة — محتوى
                الطلب الكامل معروض في الأقسام أعلاه، ويُنشأ سجل العميل عند
                الموافقة فقط.
              </p>
            )}
          </section>

          {/* E. الملاحظات — each kind in its own readable block. */}
          <section className={styles.section} aria-label="الملاحظات">
            <h3 className={styles.sectionTitle}>الملاحظات</h3>
            {detail.proposed.notes || detail.submissionNote || detail.reviewNotes ? (
              <>
                {detail.proposed.notes ? (
                  <div className={styles.noteBlock}>
                    <span className={styles.noteLabel}>ملاحظات العميل</span>
                    {detail.proposed.notes}
                  </div>
                ) : null}
                {detail.submissionNote ? (
                  <div className={styles.noteBlock}>
                    <span className={styles.noteLabel}>ملاحظة مقدم الطلب</span>
                    {detail.submissionNote}
                  </div>
                ) : null}
                {detail.reviewNotes ? (
                  <div className={styles.noteBlock}>
                    <span className={styles.noteLabel}>ملاحظات الإدارة</span>
                    {detail.reviewNotes}
                  </div>
                ) : null}
              </>
            ) : (
              <p className={styles.empty}>لا توجد ملاحظات على هذا الطلب.</p>
            )}
          </section>
        </>
      )}
    </PropertyOverlay>
  );
}
