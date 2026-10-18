'use client';
import { useDraftState } from '../../../lib/drafts/use-form-draft';

import { Toast } from '../../../components/ui/toast';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { Button } from '../../../components/ui/button';
import { StatCard } from '../../../components/ui/stat-card';
import { SearchBar } from '../../../components/ui/search-bar';
import { SectionHeader } from '../../../components/ui/section-header';
import { ApiError } from '../../../lib/api-client';
import {
  approveProperty,
  getProperty,
  listProperties,
  rejectProperty,
  requestChangesProperty,
} from '../../../lib/api/properties-api';
import { mapPreviewFromApi } from '../../../lib/property-adapter';
import type { PropertyViewDto } from '../../../lib/api/property-types';
import type { PreviewProperty } from '../preview-data';
import { PropertiesSegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
import { PropertyCard } from './property-card';
import { PropertyDetailsDrawer } from './property-details-drawer';
import { ReviewActionDialog } from './review-action-dialog';
import { AddPropertyModal } from './add-property-modal';
import { useAuth } from '../../auth/components/auth-provider';
import {
  consumeOpenProperty,
  useOpenPropertyRequest,
} from '../../notifications/open-property';
import { usePropertyRefreshSignal } from '../../notifications/property-refresh';
import styles from './properties.module.css';

const PAGE_SIZE = 100;
/** Pages pulled per click so the headline counts cover a sensible window. */
const MAX_PAGES_PER_LOAD = 3;

export function ManagerProperties() {
  const { user } = useAuth();
  const [items, setItems] = useState<PreviewProperty[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Monotonic id: a late page can never overwrite a newer load.
  const requestId = useRef(0);
  // Set by a notification-driven re-read so it can update in the background.
  const silentRef = useRef(false);
  const [nonce, setNonce] = useState(0);
  const [tab, setTab] = useState('program');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<PreviewProperty | null>(null);
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

  const notify = useCallback(
    (text: string) =>
      setNotice((previous) => ({ text, sequence: previous.sequence + 1 })),
    [],
  );

  const refetch = useCallback(() => setNonce((value) => value + 1), []);

  // The notification poll re-reads this list whenever it learns of a genuinely
  // new property notification, so the OTHER user's screen updates without a
  // browser refresh. It goes through `refetch`, so it reuses the existing
  // request guard, tab filtering and headline counts, and it can never loop:
  // this list publishes nothing back.
  const refreshSignal = usePropertyRefreshSignal();
  useEffect(() => {
    if (refreshSignal === 0) return;
    silentRef.current = true;
    refetch();
  }, [refreshSignal, refetch]);

  // Opens the property a notification deep-linked to, using the EXISTING details
  // drawer. The backend re-authorizes the property on read, so a stale link
  // answers 404 and is reported instead of opening an empty drawer.
  const openRequest = useOpenPropertyRequest();
  useEffect(() => {
    if (!openRequest || !user) return;
    const propertyId = openRequest.propertyId;
    let cancelled = false;
    (async () => {
      try {
        const dto = await getProperty(propertyId);
        if (cancelled) return;
        setSelected(mapPreviewFromApi(dto, user));
      } catch (cause) {
        if (cancelled) return;
        notify(cause instanceof Error ? cause.message : 'تعذّر فتح العقار.');
      } finally {
        consumeOpenProperty(propertyId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openRequest, user, notify]);

  useEffect(() => {
    const id = ++requestId.current;
    // A notification-driven re-read is SILENT: the rows already on screen stay
    // until the fresh ones replace them, so the panel never blinks away.
    const silent = silentRef.current;
    silentRef.current = false;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    (async () => {
      const rows: PropertyViewDto[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page = await listProperties(
          cursor ? { limit: PAGE_SIZE, cursor } : { limit: PAGE_SIZE },
        );
        if (id !== requestId.current) return;
        rows.push(...page.items);
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor && pages < MAX_PAGES_PER_LOAD);
      if (id !== requestId.current) return;
      setItems(rows.map((dto: PropertyViewDto) => mapPreviewFromApi(dto, user)));
      setNextCursor(cursor);
      setLoading(false);
    })().catch((cause: unknown) => {
      if (id !== requestId.current) return;
      if (silent) {
        // Keep the rows on screen; the next poll retries.
        setLoading(false);
        return;
      }
      setItems([]);
      setNextCursor(null);
      setLoading(false);
      setError(
        cause instanceof Error
          ? cause.message
          : 'تعذر تحميل العقارات من الخادم.',
      );
    });
  }, [nonce, user]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    const id = requestId.current;
    setLoadingMore(true);
    listProperties({ limit: PAGE_SIZE, cursor: nextCursor })
      .then((page) => {
        if (id !== requestId.current) return;
        setItems((previous) => [
          ...previous,
          ...page.items.map((dto: PropertyViewDto) =>
            mapPreviewFromApi(dto, user),
          ),
        ]);
        setNextCursor(page.nextCursor);
        setLoadingMore(false);
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return;
        setLoadingMore(false);
        setError(
          cause instanceof Error
            ? cause.message
            : 'تعذر تحميل المزيد من العقارات.',
        );
      });
  }, [nextCursor, loadingMore, user]);

  const matches = (property: PreviewProperty) =>
    `${property.title} ${property.region} ${property.code}`
      .toLocaleLowerCase('ar')
      .includes(query.trim().toLocaleLowerCase('ar'));

  const visible = items.filter(matches);
  const countOf = (status: string) =>
    items.filter((property) => property.apiStatus === status).length;
  // A PENDING row whose latest review is CHANGES_REQUESTED is waiting on the
  // employee, not on the manager, so it must NOT sit in the actionable queue.
  const awaitingManager = (property: PreviewProperty) =>
    property.apiStatus === 'PENDING' &&
    property.reviewStatus !== 'CHANGES_REQUESTED';
  const pendingCount = items.filter(awaitingManager).length;
  // Rows the employee still has to act on: rejected outright, or changes requested.
  const needsCorrectionCount =
    countOf('REJECTED') +
    items.filter((property) => property.reviewStatus === 'CHANGES_REQUESTED')
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
  // is re-read and the drawer reflects the new status without being closed.
  const selectedLive = selected
    ? (selected.id
        ? items.find((property) => property.id === selected.id)
        : undefined) ?? selected
    : null;

  const approve = async (property: PreviewProperty) => {
    if (busyId) return;
    if (!property.id || property.version === undefined) {
      notify('تعذّر تحديد إصدار السجل. حدّث الصفحة ثم حاول مرة أخرى.');
      return;
    }
    setBusyId(property.id);
    try {
      await approveProperty(property.id, property.version);
      notify(`تم اعتماد العقار ${property.code}.`);
      refetch();
    } catch (cause) {
      notify(
        cause instanceof Error ? cause.message : 'تعذر اعتماد العقار.',
      );
      // Stale version: re-read so the manager sees the real latest status.
      if (cause instanceof ApiError && cause.status === 409) refetch();
    } finally {
      setBusyId(null);
    }
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
        cause instanceof ApiError && (cause.status === 409 || cause.status === 404);
      if (stale) {
        setReview(null);
        setReviewError('');
        notify(
          cause instanceof Error ? cause.message : 'تغيّر هذا العقار.',
        );
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
    }
  };

  return (
    <ManagerPageShell
      title="عقارات المدير"
      description="صفحة واحدة لإدارة العقارات داخل النظام، ومراجعة العقارات المرسلة من الموظفين قبل اعتمادها."
      actions={<Button onClick={() => setAdding(true)}>إضافة عقار</Button>}
    >
      <div className={styles.scope}>
        <p className={styles.preview}>
          القوائم مبنية على سجلات الخادم الفعلية • الإحصاءات تُحسب من العقارات
          المحمّلة{nextCursor ? ' (جزء من الإجمالي)' : ''}.
        </p>
        <div className={styles.stats}>
          {[
            { title: 'عقار داخل البرنامج', value: items.length },
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
        ) : items.length === 0 ? (
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
            onClose={() => setSelected(null)}
            onAction={onAction}
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
      </div>
    </ManagerPageShell>
  );
}
