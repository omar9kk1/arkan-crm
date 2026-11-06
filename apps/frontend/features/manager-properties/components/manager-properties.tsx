'use client';
import { useDraftState } from '../../../lib/drafts/use-form-draft';

import { Toast } from '../../../components/ui/toast';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { Button } from '../../../components/ui/button';
import { StatCard } from '../../../components/ui/stat-card';
import { SearchBar } from '../../../components/ui/search-bar';
import { SectionHeader } from '../../../components/ui/section-header';
import { ApiError } from '../../../lib/api-client';
import {
  approveProperty,
  rejectProperty,
  requestChangesProperty,
  trashProperty,
} from '../../../lib/api/properties-api';
import { mapPreviewFromApi } from '../../../lib/property-adapter';
import { usePropertyList } from '../../../lib/use-property-list';
import {
  managerTabForStatus,
  withRevealedRow,
} from '../../../lib/property-reveal';
import { useRevealScroll } from '../../../lib/use-reveal-scroll';
import type { PreviewProperty } from '../preview-data';
import { PropertiesSegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
import { PropertyCard } from './property-card';
import { PropertyDetailsDrawer } from './property-details-drawer';
import { ReviewActionDialog } from './review-action-dialog';
import { TrashDeleteDialog } from './trash-dialogs';
import { AddPropertyModal } from './add-property-modal';
import { useAuth } from '../../auth/components/auth-provider';
import styles from './properties.module.css';

const PAGE_SIZE = 100;
/** Pages pulled per click so the headline counts cover a sensible window. */
const MAX_PAGES_PER_LOAD = 3;

export function ManagerProperties() {
  const { user } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState('program');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useDraftState(
    'ui:features/manager-properties/components/manager-properties.tsx:adding',
    false,
  );
  const [notice, setNotice] = useState({ text: '', sequence: 0 });
  /** Id of the row whose decision is in flight — blocks a double click. */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [review, setReview] = useState<{
    property: PreviewProperty;
    action: 'reject' | 'changes';
  } | null>(null);
  const [reviewError, setReviewError] = useState('');
  const [, setCompareProperty] = useState<PreviewProperty | null>(null);
  // Soft-delete (move to Trash) dialog state.
  const [trashTarget, setTrashTarget] = useState<PreviewProperty | null>(null);
  const [trashBusy, setTrashBusy] = useState(false);
  const [trashDialogError, setTrashDialogError] = useState('');

  const notify = useCallback(
    (text: string) =>
      setNotice((previous) => ({ text, sequence: previous.sequence + 1 })),
    [],
  );



  // The rows, the cursor, the loading/error flags, the notification refresh
  // signal and the notification deep-link all come from the shared list core.
  // This page keeps the review decisions, the tab filtering, the headline
  // counts and the exact markup.
  const {
    items,
    nextCursor,
    loading,
    loadingMore,
    error,
    refetch,
    loadMore,
    selected,
    setSelected,
    revealed,
    targetId,
    closeSelected,
  } = usePropertyList<PreviewProperty>({
    pageSize: PAGE_SIZE,
    maxPagesPerLoad: MAX_PAGES_PER_LOAD,
    mapProperty: mapPreviewFromApi,
    viewer: user,
    onOpenError: notify,
    // An employee edit (or any other cross-session change) must refresh the
    // Pending Review list and its already-open drawer without a page reload.
    autoSyncMs: 20_000,
  });

  const matches = (property: PreviewProperty) =>
    `${property.title} ${property.region} ${property.code}`
      .toLocaleLowerCase('ar')
      .includes(query.trim().toLocaleLowerCase('ar'));

  // A deep-link target must be VISIBLE: activate the tab that lists its status
  // and clear the search box, so the row is not hidden by the current filter.
  // The tab comes from the backend status enum, never the localized label.
  useEffect(() => {
    if (!revealed) return;
    const needed = managerTabForStatus(revealed.apiStatus);
    if (needed && needed !== tab) setTab(needed);
    if (query) setQuery('');
    // Deliberately keys on the resolved target only: a manual tab switch or a
    // later query edit is never fought by this effect (deps intentionally omit
    // `tab`/`query`, which the hook reads through the current render).
  }, [revealed?.id]);

  // The resolved target is merged into the rows so its REAL card is rendered
  // even when the paginated window does not contain it — never a fake card, and
  // never a duplicate of an already-loaded row.
  const rows = useMemo(
    () => withRevealedRow(items, revealed),
    [items, revealed],
  );
  useRevealScroll(targetId);

  const visible = rows.filter(matches);
  const countOf = (status: string) =>
    rows.filter((property) => property.apiStatus === status).length;
  // A PENDING row whose latest review is CHANGES_REQUESTED is waiting on the
  // employee, not on the manager, so it must NOT sit in the actionable queue.
  const awaitingManager = (property: PreviewProperty) =>
    property.apiStatus === 'PENDING' &&
    property.reviewStatus !== 'CHANGES_REQUESTED';
  const pendingCount = rows.filter(awaitingManager).length;
  // Rows the employee still has to act on: rejected outright, or changes requested.
  const needsCorrectionCount =
    countOf('REJECTED') +
    rows.filter((property) => property.reviewStatus === 'CHANGES_REQUESTED')
      .length;
  // «العقارات» is the APPROVED inventory: only AVAILABLE rows may appear there,
  // so a row that is still under review — or was rejected / sent back for
  // changes — can never be mistaken for published stock. Approving a row moves
  // it here (and into «عقاراتي» for its creator) on the next read.
  const approved = visible.filter(
    (property) => property.apiStatus === 'AVAILABLE',
  );
  // «تحت المراجعة» gathers every authorized unapproved row: PENDING (ordinary
  // or changes-requested) and REJECTED. The drawer already withholds the review
  // buttons from reviewed rows, so listing them stays read-only until the
  // employee resubmits them.
  const unapproved = visible.filter(
    (property) =>
      property.apiStatus === 'PENDING' || property.apiStatus === 'REJECTED',
  );
  // Tab counts follow the same two rules over the loaded set; the search box
  // only narrows the panel below and never the headline number.
  const approvedCount = countOf('AVAILABLE');
  const unapprovedCount = countOf('PENDING') + countOf('REJECTED');
  const regions = [
    ...new Set(approved.map((property) => property.region)),
  ].filter(Boolean);
  // Keep the open drawer in sync with the latest fetch: after a decision the row
  // is re-read and the drawer reflects the new status without being closed. The
  // revealed deep-link target is part of `rows`, so it stays in sync too.
  const selectedLive = selected
    ? ((selected.id
        ? rows.find((property) => property.id === selected.id)
        : undefined) ?? selected)
    : null;

  const approve = async (property: PreviewProperty, approveAsDistinct = false) => {
    if (busyId) return;
    if (!property.id || property.version === undefined) {
      notify('تعذّر تحديد إصدار السجل. حدّث الصفحة ثم حاول مرة أخرى.');
      return;
    }
    setBusyId(property.id);
    try {
      await approveProperty(property.id, property.version, approveAsDistinct);
      notify(`تم اعتماد العقار ${property.code}.`);
      refetch();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'تعذر اعتماد العقار.');
      // Stale version: re-read so the manager sees the real latest status.
      if (cause instanceof ApiError && cause.status === 409) refetch();
    } finally {
      setBusyId(null);
    }
  };

  const approveDistinct = async (property: PreviewProperty) => {
    await approve(property, true);
  };

  const submitDecision = async (reason: string) => {
    if (!review || busyId) return;
    const { property, action } = review;
    if (!property.id || property.version === undefined) {
      setReviewError('تعذّر تحديد إصدار السجل. حدّث الصفحة ثم حاول مرة أخرى.');
      return;
    }
    setBusyId(property.id);
    try {
      // Two distinct manager actions, two distinct endpoints. Request Changes
      // must never be routed to `reject`.
      if (action === 'changes')
        await requestChangesProperty(property.id, reason, property.version);
      else await rejectProperty(property.id, reason, property.version);
      setReview(null);
      setReviewError('');
      notify(
        action === 'changes'
          ? `تم طلب تعديل العقار ${property.code}.`
          : `تم رفض العقار ${property.code}.`,
      );
      refetch();
    } catch (cause) {
      const stale =
        cause instanceof ApiError &&
        (cause.status === 409 || cause.status === 404);
      if (stale) {
        setReview(null);
        setReviewError('');
        notify(cause instanceof Error ? cause.message : 'تغيّر هذا العقار.');
        refetch();
      } else {
        // Keep the dialog (and the typed reason) open on a recoverable failure.
        setReviewError(
          cause instanceof Error ? cause.message : 'تعذر تسجيل القرار.',
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  const onAction = (action: string, property: PreviewProperty) => {
    if (action === 'اعتماد') void approve(property);
    else if (action === 'طلب تعديل') {
      setReviewError('');
      setReview({ property, action: 'changes' });
    } else if (action === 'رفض') {
      setReviewError('');
      setReview({ property, action: 'reject' });
    } else if (action === 'حذف') {
      setTrashDialogError('');
      setTrashTarget(property);
    }
  };

  const confirmTrash = async (reason: string) => {
    if (!trashTarget?.id || trashBusy) return;
    setTrashBusy(true);
    setTrashDialogError('');
    try {
      await trashProperty(trashTarget.id, reason || undefined);
      notify(`تم نقل العقار ${trashTarget.code} إلى سلة المحذوفات.`);
      setTrashTarget(null);
      refetch();
    } catch (cause) {
      setTrashDialogError(
        cause instanceof Error ? cause.message : 'تعذّر حذف العقار.',
      );
    } finally {
      setTrashBusy(false);
    }
  };

  return (
    <ManagerPageShell
      title="عقارات المدير"
      actions={<Button onClick={() => setAdding(true)}>إضافة عقار</Button>}
    >
      <div className={styles.scope}>
        <div className={styles.stats}>
          {[
            { title: 'عقار داخل البرنامج', value: rows.length },
            { title: 'بانتظار الموافقة', value: pendingCount },
            { title: 'عقار معتمد', value: countOf('AVAILABLE') },
            { title: 'مطلوب تعديل', value: needsCorrectionCount },
          ].map((item) => (
            <StatCard
              key={item.title}
              {...item}
              icon="building"
              hint={nextCursor ? 'ضمن العقارات المحمّلة' : 'من الخادم'}
            />
          ))}
        </div>
        <div className={styles.toolbar}>
          <PropertiesSegmentedTabs
            id="properties"
            label="قوائم العقارات"
            items={[
              { id: 'program', label: 'العقارات', count: approvedCount },
              {
                id: 'approval',
                label: 'تحت المراجعة',
                count: unapprovedCount,
              },
            ]}
            value={tab}
            onChange={setTab}
          />
          <SearchBar
            label="البحث في العقارات بالمنطقة أو الكود"
            placeholder="ابحث بالمنطقة أو الكود..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {loading ? (
          <p className={styles.inset} role="status" aria-live="polite">
            جارٍ تحميل العقارات…
          </p>
        ) : error ? (
          <p className={styles.inset} role="alert">
            {error}{' '}
            <Button type="button" variant="ghost" onClick={refetch}>
              إعادة المحاولة
            </Button>
          </p>
        ) : rows.length === 0 ? (
          <p className={styles.inset}>لم يسجّل الخادم أي عقار حتى الآن.</p>
        ) : (
          <>
            <section
              role="tabpanel"
              tabIndex={0}
              id="properties-panel-program"
              aria-labelledby="properties-tab-program"
              hidden={tab !== 'program'}
            >
              {regions.map((region) => (
                <section key={region} className={styles.region}>
                  <SectionHeader
                    title={`عقارات ${region}`}
                    description="العقارات المعتمدة والمتاحة في النظام"
                  >
                    <span className={styles.badge}>
                      {
                        approved.filter(
                          (property) => property.region === region,
                        ).length
                      }{' '}
                      عقار
                    </span>
                  </SectionHeader>
                  <div className={styles.propertyGrid}>
                    {approved
                      .filter((property) => property.region === region)
                      .map((property) => (
                        <PropertyCard
                          key={property.id ?? property.code}
                          property={property}
                          onOpen={() => setSelected(property)}
                          selected={!!targetId && property.id === targetId}
                        />
                      ))}
                  </div>
                </section>
              ))}
              {!approved.length && (
                <p className={styles.inset}>لا توجد عقارات تطابق البحث.</p>
              )}
            </section>
            <section
              role="tabpanel"
              tabIndex={0}
              id="properties-panel-approval"
              aria-labelledby="properties-tab-approval"
              hidden={tab !== 'approval'}
            >
              <SectionHeader
                title="عقارات تحت المراجعة"
                description="الطلبات غير المعتمدة: بانتظار الموافقة، مطلوب تعديل، أو مرفوضة — كل بحالة شارتها الحقيقي، ولا تُفتح للمراجعة مجددًا إلا بعد إعادة الإرسال."
              />
              <div className={styles.propertyGrid}>
                {unapproved.map((property) => (
                  <PropertyCard
                    key={property.id ?? property.code}
                    property={property}
                    onOpen={() => setSelected(property)}
                    selected={!!targetId && property.id === targetId}
                  />
                ))}
              </div>
              {!unapproved.length && (
                <p className={styles.inset}>لا توجد طلبات تطابق البحث.</p>
              )}
            </section>
            {nextCursor && (
              <p className={styles.inset}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={loadMore}
                  disabled={loadingMore}
                  aria-busy={loadingMore}
                >
                  {loadingMore ? 'جارٍ التحميل…' : 'تحميل المزيد'}
                </Button>
              </p>
            )}
          </>
        )}

        <Toast
          message={notice.text}
          eventKey={notice.sequence}
          onDismiss={() => setNotice((previous) => ({ ...previous, text: '' }))}
        />
        {selectedLive && (
          <PropertyDetailsDrawer
            key={selectedLive.id ?? selectedLive.code}
            property={selectedLive}
            onClose={() => {
              setCompareProperty(null);
              closeSelected();
            }}
            onBack={() => {
              setCompareProperty(null);
              let origin: { subjectId?: string; tab?: string } | null = null;
              try {
                origin = JSON.parse(
                  sessionStorage.getItem('propertyDetailsOrigin') || 'null',
                );
              } catch {
                origin = null;
              }
              sessionStorage.removeItem('propertyDetailsOrigin');
              if (origin?.subjectId) {
                const tab = origin.tab || 'history';
                router.push(
                  `/manager/followups?follow-up=${encodeURIComponent(origin.subjectId)}&follow-up-tab=${encodeURIComponent(tab)}`,
                );
              } else {
                router.back();
              }
            }}
            onAction={onAction}
            onApproveDistinct={approveDistinct}
            busy={busyId === selectedLive.id}
          />
        )}
        {review && (
          <ReviewActionDialog
            propertyCode={review.property.code}
            action={review.action}
            busy={busyId === review.property.id}
            error={reviewError}
            onConfirm={(reason) => void submitDecision(reason)}
            onClose={() => {
              if (busyId) return;
              setReview(null);
              setReviewError('');
            }}
          />
        )}
        {adding && (
          <AddPropertyModal
            onClose={() => setAdding(false)}
            onSave={() => {
              setAdding(false);
              setTab('program');
              setQuery('');
              notify('تم حفظ العقار');
              refetch();
            }}
          />
        )}
        {trashTarget && (
          <TrashDeleteDialog
            propertyCode={trashTarget.code}
            busy={trashBusy}
            error={trashDialogError}
            onConfirm={(reason) => void confirmTrash(reason)}
            onClose={() => {
              if (trashBusy) return;
              setTrashTarget(null);
              setTrashDialogError('');
            }}
          />
        )}
      </div>
    </ManagerPageShell>
  );
}
