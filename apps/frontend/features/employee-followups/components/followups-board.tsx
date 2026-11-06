'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { StatCard } from '../../../components/ui/stat-card';
import { SearchBar } from '../../../components/ui/search-bar';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { GlassSelect } from '../../../components/ui/glass-select';
import { Toast } from '../../../components/ui/toast';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
import {
  BUCKET_LABELS,
  STATUS_FILTERS,
  TABS,
  entryCountLabel,
  filterSubjects,
  groupByPerson,
  subjectCountLabel,
  subjectDueLine,
  type FollowUpStatusFilter,
  type FollowUpTabId,
  type PersonGroup,
} from '../model';
import {
  followUpApiMessage,
  listFollowUps,
} from '../../../lib/api/followups-api';
import type { FollowUpListDto } from '../../../lib/api/followup-types';
import { FOLLOW_UP_SUBJECT_QUERY_PARAM } from '../../notifications/notification-target';
import { FollowUpPersonDrawer } from './followup-person-drawer';
import styles from './followups.module.css';

/**
 * The PERSONAL follow-ups board: EVERY authorized subject of the caller,
 * grouped per person for phone-call convenience. Scheduling and scoping live
 * in the backend — this board only renders the authorized feed. It is the
 * SHARED body of the employee page («المتابعات») and of the manager page's
 * «متابعاتي» section: identical behavior, identical visuals; only the
 * property deep links follow the caller's own account area (`propertyBase`).
 * The cards are COMPACT and open the person drawer; all writing (notes) and
 * history reading happens INSIDE the drawer, never in the list. Merely
 * opening the board, searching or tapping a phone number NEVER resets a due
 * date: only a successfully committed note does (server-side).
 *
 * `refreshSignal` (optional): a counter prop — incrementing it reloads the
 * authorized feed (the host page shell wires its «تحديث» button to it).
 */
export function FollowUpsBoard({
  propertyBase = '/employee',
  refreshSignal = 0,
  toolbarLayout = 'stacked',
}: {
  propertyBase?: string;
  refreshSignal?: number;
  /** 'stacked' = the employee page's two rows; 'inline' = ONE row
   * (status bounded on the right, the search filling the rest) — used by the
   * manager's «متابعاتي» so the controls match the supervision toolbar. */
  toolbarLayout?: 'stacked' | 'inline';
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [feed, setFeed] = useState<FollowUpListDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<FollowUpTabId>('all');
  const [status, setStatus] = useState<FollowUpStatusFilter>('all');
  const [query, setQuery] = useState('');
  /** Hand-written note drafts, per subject — untouched subjects stay empty.
   * Board-level on purpose: drafts survive closing the drawer and switching
   * its tabs, and an API failure can never clear them. */
  const [notes, setNotes] = useState<Record<string, string>>({});
  /** The open drawer is stable by PERSON KEY (never by group object), so a
   * background feed refresh keeps the same drawer on fresh data. `subjectId`
   * is the EXACT follow-up subject the opened row points at — the drawer
   * shows ONLY that subject; null keeps the (legacy) whole-person drawer. */
  const [drawer, setDrawer] = useState<{
    key: string;
    tab: string;
    subjectId: string | null;
  } | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listFollowUps();
      setFeed(data);
      if (data.truncated)
        setNotice(
          'عدد المتابعات كبير جدًا والقائمة مقتطعة عند أول 1000 موضوع.',
        );
    } catch (cause) {
      setError(
        followUpApiMessage(cause, 'تعذر تحميل المتابعات. حاول مرة أخرى.'),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Host-shell refresh button («تحديث»): a counter increment reloads.
  const firstRefreshSignal = useRef(refreshSignal);
  useEffect(() => {
    if (firstRefreshSignal.current !== refreshSignal) {
      firstRefreshSignal.current = refreshSignal;
      if (refreshSignal > 0) void load();
    }
  }, [refreshSignal, load]);

  const items = feed?.items ?? [];
  const allGroups = useMemo(() => groupByPerson(items), [items]);

  const setNote = useCallback((subjectId: string, value: string) => {
    setNotes((previous) => ({ ...previous, [subjectId]: value }));
  }, []);
  const clearNotes = useCallback((subjectIds: readonly string[]) => {
    setNotes((previous) => {
      const next = { ...previous };
      for (const subjectId of subjectIds) delete next[subjectId];
      return next;
    });
  }, []);

  // Notification deep link: `?follow-up=<subjectId>` opens that subject's
  // PERSON drawer on «سجل المتابعات» once the authorized feed has loaded (a
  // foreign id simply never appears in this caller's feed — and the manager
  // supervision drawer consumes only ITS subject ids, so two consumers of the
  // same param can never fight over it). The param is TRANSIENT — stripped
  // with REPLACE navigation so a refresh/Back can never re-open it while the
  // SAME notification click later still works (the same contract the clients
  // page applies to its review deep link).
  const focusSubjectId =
    searchParams.get(FOLLOW_UP_SUBJECT_QUERY_PARAM)?.trim() ?? '';
  const focusTab = searchParams.get('follow-up-tab')?.trim() ?? '';
  const focusKeyRef = useRef('');
  useEffect(() => {
    if (!focusSubjectId || loading) return;
    if (focusKeyRef.current === focusSubjectId) return;
    focusKeyRef.current = focusSubjectId;
    const group = allGroups.find((candidate) =>
      candidate.subjects.some((subject) => subject.id === focusSubjectId),
    );
    const restoredTab =
      focusTab === 'record' ||
      focusTab === 'history' ||
      focusTab === 'associations'
        ? focusTab
        : 'history';
    if (group)
      setDrawer({
        key: group.key,
        tab: restoredTab,
        subjectId: focusSubjectId,
      });
    const params = new URLSearchParams(searchParams);
    params.delete(FOLLOW_UP_SUBJECT_QUERY_PARAM);
    const value = params.toString();
    router.replace(value ? `${pathname}?${value}` : pathname, {
      scroll: false,
    });
  }, [
    focusSubjectId,
    focusTab,
    loading,
    allGroups,
    searchParams,
    pathname,
    router,
  ]);

  const countIn = useCallback(
    (id: FollowUpTabId) =>
      id === 'all'
        ? items.length
        : items.filter((subject) => subject.tabs.includes(id)).length,
    [items],
  );
  const tabItems = useMemo(
    () => TABS.map((item) => ({ ...item, count: countIn(item.id) })),
    [countIn],
  );

  const counts = useMemo(
    () => ({
      overdue: items.filter((subject) => subject.bucket === 'OVERDUE').length,
      today: items.filter((subject) => subject.bucket === 'TODAY').length,
      upcoming: items.filter((subject) => subject.bucket === 'UPCOMING').length,
      never: items.filter((subject) => subject.lastSavedAt === null).length,
    }),
    [items],
  );

  const groups = useMemo(
    () => groupByPerson(filterSubjects(items, tab, status, query)),
    [items, tab, status, query],
  );

  // The CURRENT snapshot of the open person's group (the feed may have been
  // refreshed since the drawer opened). Nobody matching → effectively closed.
  const drawerGroup: PersonGroup | null =
    drawer === null
      ? null
      : (allGroups.find((group) => group.key === drawer.key) ?? null);

  const busy = loading && !feed;

  return (
    <>
      {busy && (
        <p className={styles.state} role="status" aria-live="polite">
          جارٍ تحميل المتابعات…
        </p>
      )}
      {!busy && error && (
        <Card>
          <p className={styles.errorText}>{error}</p>
          <Button onClick={() => void load()}>إعادة المحاولة</Button>
        </Card>
      )}

      {!busy && !error && (
        <>
          <div className={styles.stats}>
            {[
              { title: 'إجمالي متابعاتك', value: items.length },
              { title: 'متأخرة', value: counts.overdue },
              { title: 'مستحقة اليوم', value: counts.today },
              { title: ' لم تتم متابعتها', value: counts.never },
            ].map((item) => (
              <StatCard
                key={item.title}
                title={item.title}
                value={item.value}
                icon="clock"
                hint="من قاعدة البيانات مباشرة"
              />
            ))}
          </div>

          {/* The eight category tabs get their OWN FULL-WIDTH row — beside
              nothing, so the pill is never squeezed narrow enough to scroll
              and paint the gray track underneath it. */}
          <div className={styles.tabsRow}>
            <SegmentedTabs
              id={`${propertyBase}-followups-tabs`}
              label="تصنيف المتابعات"
              value={tab}
              onChange={(value) => setTab(value as FollowUpTabId)}
              items={tabItems}
            />
          </div>

          {toolbarLayout === 'inline' ? (
            <div className={styles.inlineToolbar}>
              <label className={styles.filterField}>
                الحالة
                <GlassSelect
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value as FollowUpStatusFilter)
                  }
                >
                  {STATUS_FILTERS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </GlassSelect>
              </label>
              <SearchBar
                label="البحث في المتابعات"
                placeholder="ابحث بالاسم أو الهاتف أو كود العقار"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          ) : (
            <>
              <div className={styles.toolbar}>
                <SearchBar
                  label="البحث في المتابعات"
                  placeholder="ابحث بالاسم أو الهاتف أو كود العقار"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>

              <div className={styles.filterRow}>
                <label className={styles.filterField}>
                  الحالة
                  <GlassSelect
                    value={status}
                    onChange={(event) =>
                      setStatus(event.target.value as FollowUpStatusFilter)
                    }
                  >
                    {STATUS_FILTERS.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </GlassSelect>
                </label>
              </div>
            </>
          )}

          <div className={styles.list}>
            {/* ONE column at EVERY width — exactly one person card per row
                (owner requirement), full content width, consistent gaps. */}
            {groups.length > 0 && (
              <div className={styles.listGrid}>
                {groups.map((group) => (
                  <Card key={group.key} className={styles.personCard}>
                    <div className={styles.cardBody}>
                      {/* The clean header: the person's identity ONLY (name,
                          dialable phone and the subject count). NEVER one
                          merged status for the whole person — every subject
                          row below carries its own bucket. */}
                      <div className={styles.cardHeader}>
                        <div className={styles.cardIdentity}>
                          <span className={styles.cardName}>{group.name}</span>
                          {group.phone ? (
                            // A plain tel anchor: calling dials directly,
                            // never opens the drawer and never touches any
                            // schedule (only a server-committed note does).
                            <a
                              className={styles.cardPhone}
                              href={`tel:${group.phone}`}
                              dir="ltr"
                            >
                              {group.phone}
                            </a>
                          ) : null}
                          <span
                            className={styles.subjectsCount}
                            aria-label="عدد مواضيع المتابعة"
                          >
                            {subjectCountLabel(group.subjects.length)}
                          </span>
                        </div>
                      </div>

                      {/* Each subject is ONE compact clickable row (fully
                          independent): its OWN label, its OWN due line (the
                          server bucket), its OWN status badge and its OWN
                          saved-entries count — clicking opens the LEFT drawer
                          for EXACTLY that subject. Rows never expand inline. */}
                      <ul className={styles.subjectRows}>
                        {group.subjects.map((subject) => (
                          <li key={subject.id} className={styles.subjectRow}>
                            <button
                              type="button"
                              className={styles.subjectActionRow}
                              aria-haspopup="dialog"
                              aria-label={`فتح تفاصيل ${subject.label}`}
                              onClick={() =>
                                setDrawer({
                                  key: group.key,
                                  tab: 'record',
                                  subjectId: subject.id,
                                })
                              }
                            >
                              <span className={styles.subjectInfo}>
                                <span className={styles.subjectLabel}>
                                  {subject.label}
                                </span>
                                <span className={styles.subjectMeta} dir="rtl">
                                  {subjectDueLine(subject)}
                                </span>
                              </span>
                              <span className={styles.subjectBadges}>
                                <span
                                  className={styles.badge}
                                  data-bucket={subject.bucket}
                                  aria-label="حالة الاستحقاق"
                                >
                                  {BUCKET_LABELS[subject.bucket]}
                                </span>
                                <span
                                  className={styles.badge}
                                  aria-label="عدد المتابعات المسجلة"
                                >
                                  {entryCountLabel(subject.entryCount)}
                                </span>
                              </span>
                              <span
                                className={styles.subjectChevron}
                                aria-hidden="true"
                              >
                                ←
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </Card>
                ))}
              </div>
            )}
            {groups.length === 0 && (
              <Card>
                {!items.length
                  ? 'لا توجد متابعات بعد — تظهر هنا تلقائيًا بعد الموافقة على العقارات وطلبات العملاء.'
                  : 'لا توجد متابعات تطابق التبويب والفلاتر الحالية.'}
              </Card>
            )}
          </div>

          {drawer && drawerGroup && (
            <FollowUpPersonDrawer
              key={drawerGroup.key}
              group={drawerGroup}
              subjectId={drawer.subjectId}
              tab={drawer.tab}
              propertyBase={propertyBase}
              notes={notes}
              onNoteChange={setNote}
              onClearNotes={clearNotes}
              onSaved={load}
              onSubjectSwitch={(next) =>
                setDrawer((previous) =>
                  previous && previous.key === drawerGroup.key
                    ? { ...previous, subjectId: next }
                    : previous,
                )
              }
              onClose={() => setDrawer(null)}
            />
          )}
        </>
      )}

      <Toast message={notice} onDismiss={() => setNotice('')} />
    </>
  );
}
