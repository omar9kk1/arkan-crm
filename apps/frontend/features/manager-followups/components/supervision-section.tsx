'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { StatCard } from '../../../components/ui/stat-card';
import { SearchBar } from '../../../components/ui/search-bar';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { GlassSelect } from '../../../components/ui/glass-select';
import { Toast } from '../../../components/ui/toast';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
import {
  TABS,
  entryCountLabel,
  subjectCountLabel,
  subjectDueLine,
  subjectMatchesTab,
  type FollowUpTabId,
} from '../../employee-followups/model';
import {
  MANAGER_BUCKET_LABELS,
  MANAGER_STATUS_FILTERS,
  employeeFilterOptions,
  filterSupervision,
  groupSupervision,
  supervisionMatchesEmployee,
  type SupervisionStatusFilter,
} from '../model';
import {
  followUpApiMessage,
  listSupervisionFollowUps,
} from '../../../lib/api/followups-api';
import type {
  FollowUpSupervisionListDto,
  FollowUpSupervisionSubjectDto,
} from '../../../lib/api/followup-types';
import {
  FOLLOW_UP_ENTRY_QUERY_PARAM,
  FOLLOW_UP_SUBJECT_QUERY_PARAM,
} from '../../notifications/notification-target';
import { EmployeeFollowUpDrawer } from './employee-followup-drawer';
import styles from '../../employee-followups/components/followups.module.css';
import managerStyles from './manager-followups.module.css';

/**
 * «متابعات الموظفين» — the manager's supervision section.
 *
 * STRICTLY READ-ONLY over EMPLOYEE follow-up subjects: stats («متأخرة /
 * متابعة اليوم / قادمة» — never the employee wording), the eight category
 * tabs, the status filter, the responsible-employee filter (incl. «جميع
 * الموظفين») and a search that also matches the employee's name. The cards
 * follow the SAME person-card grammar as the employee board (compact, one
 * column, LEFT drawer) — without «اتصال» and with the responsible employee
 * named on every row. The feed is always the SERVER's authorized view, most
 * overdue first; opening, filtering and searching never touch a schedule —
 * the section's only write is the drawer's manual reminder.
 *
 * Deep link: `?follow-up=<subjectId>` opens that subject's drawer on
 * «سجل المتابعات» once the feed has loaded. The ids of the personal section
 * (manager-owned) and of this section (employee-owned) are DISJOINT by
 * construction of the server scopes, so both consumers of the same param
 * never compete.
 */
export function SupervisionSection({
  refreshSignal = 0,
}: {
  refreshSignal?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [feed, setFeed] = useState<FollowUpSupervisionListDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<FollowUpTabId>('all');
  const [status, setStatus] = useState<SupervisionStatusFilter>('all');
  const [employeeUserId, setEmployeeUserId] = useState('');
  const [query, setQuery] = useState('');
  const [drawer, setDrawer] = useState<{
    key: string;
    tab: string;
    subjectId: string | null;
  } | null>(null);
  // The exact target a follow-up deep link focused (the entry highlight in
  // the drawer's history tab); cleared as soon as the drawer is closed.
  const [focus, setFocus] = useState<{
    subjectId: string;
    entryId: string | null;
  } | null>(null);
  // Committed reminder results (subject → sentAt) applied on top of the
  // feed, so «آخر تذكير» flips even before the next full refresh.
  const [reminded, setReminded] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const handleReminded = useCallback((subjectId: string, sentAt: string) => {
    setReminded((previous) => ({ ...previous, [subjectId]: sentAt }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listSupervisionFollowUps();
      setFeed(data);
      if (data.truncated)
        setNotice(
          'عدد المتابعات كبير جدًا والقائمة مقتطعة عند أول 1000 موضوع.',
        );
    } catch (cause) {
      setError(
        followUpApiMessage(
          cause,
          'تعذر تحميل متابعات الموظفين. حاول مرة أخرى.',
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Host-shell refresh counter → reload the feed.
  const firstRefreshSignal = useRef(refreshSignal);
  useEffect(() => {
    if (firstRefreshSignal.current !== refreshSignal) {
      firstRefreshSignal.current = refreshSignal;
      if (refreshSignal > 0) void load();
    }
  }, [refreshSignal, load]);

  const items: FollowUpSupervisionSubjectDto[] = useMemo(
    () =>
      (feed?.items ?? []).map((item) =>
        reminded[item.id]
          ? { ...item, lastReminderAt: reminded[item.id] ?? null }
          : item,
      ),
    [feed, reminded],
  );

  // The EMPLOYEE filter FIRST — the stats and the tab counts are computed
  // over employee-filtered subjects (the requirements' exact accounting).
  const employeeFiltered = useMemo(
    () =>
      items.filter((item) => supervisionMatchesEmployee(item, employeeUserId)),
    [items, employeeUserId],
  );
  const employeeOptions = useMemo(() => employeeFilterOptions(items), [items]);

  const tabItems = useMemo(
    () =>
      TABS.map((item) => ({
        ...item,
        count:
          item.id === 'all'
            ? employeeFiltered.length
            : employeeFiltered.filter((subject) =>
                subjectMatchesTab(subject, item.id),
              ).length,
      })),
    [employeeFiltered],
  );

  const counts = useMemo(
    () => ({
      total: employeeFiltered.length,
      overdue: employeeFiltered.filter(
        (subject) => subject.bucket === 'OVERDUE',
      ).length,
      today: employeeFiltered.filter((subject) => subject.bucket === 'TODAY')
        .length,
      upcoming: employeeFiltered.filter(
        (subject) => subject.bucket === 'UPCOMING',
      ).length,
    }),
    [employeeFiltered],
  );

  const filtered = useMemo(
    () => filterSupervision(items, status, employeeUserId, query),
    [items, status, employeeUserId, query],
  );
  const groups = useMemo(() => groupSupervision(filtered), [filtered]);

  // Notification deep link `?follow-up=<subjectId>[&follow-up-entry=<id>]` —
  // the same transient contract as the personal board: open on «سجل
  // المتابعات» when found, then strip. The guard resets whenever the URL no
  // longer carries the subject, so clicking the SAME notification again
  // re-opens it — and a stale/deleted/unauthorized id answers a subtle
  // «غير موجودة» notice instead of silently doing nothing. The ids of the
  // personal section (manager-owned) and of this section (employee-owned)
  // are DISJOINT by construction of the server scopes, so both consumers of
  // the same param never compete.
  const focusSubjectId =
    searchParams.get(FOLLOW_UP_SUBJECT_QUERY_PARAM)?.trim() ?? '';
  const focusEntryId =
    searchParams.get(FOLLOW_UP_ENTRY_QUERY_PARAM)?.trim() ?? '';
  const focusTab = searchParams.get('follow-up-tab')?.trim() ?? '';
  const focusKeyRef = useRef('');
  const allGroups = useMemo(() => groupSupervision(items), [items]);
  useEffect(() => {
    if (!focusSubjectId) {
      // The param was just consumed (replace navigation): clear the one-shot
      // guard so the same notification click can re-open the drawer.
      focusKeyRef.current = '';
      return;
    }
    if (loading) return;
    if (focusKeyRef.current === focusSubjectId) return;
    focusKeyRef.current = focusSubjectId;
    const group = allGroups.find((candidate) =>
      candidate.subjects.some((subject) => subject.id === focusSubjectId),
    );
    if (group) {
      const restoredTab =
        focusTab === 'record' ||
        focusTab === 'history' ||
        focusTab === 'associations'
          ? focusTab
          : 'history';
      setDrawer({
        key: group.key,
        tab: restoredTab,
        subjectId: focusSubjectId,
      });
      setFocus({ subjectId: focusSubjectId, entryId: focusEntryId || null });
    } else {
      setNotice(
        'المتابعة المطلوبة غير موجودة أو غير متاحة في متابعات الموظفين.',
      );
    }
    const params = new URLSearchParams(searchParams);
    params.delete(FOLLOW_UP_SUBJECT_QUERY_PARAM);
    params.delete(FOLLOW_UP_ENTRY_QUERY_PARAM);
    params.delete('follow-up-tab');
    const value = params.toString();
    router.replace(value ? `${pathname}?${value}` : pathname, {
      scroll: false,
    });
  }, [
    focusSubjectId,
    focusEntryId,
    loading,
    allGroups,
    searchParams,
    pathname,
    router,
  ]);

  const drawerGroup =
    drawer === null
      ? null
      : (allGroups.find((group) => group.key === drawer.key) ?? null);

  const busy = loading && !feed;

  return (
    <>
      {busy && (
        <p className={styles.state} role="status" aria-live="polite">
          جارٍ تحميل متابعات الموظفين…
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
          {/* The supervision stats: the manager's OWN bucket wording —
              «متأخرة / متابعة اليوم / قادمة», never «مستحقة». */}
          <div className={styles.stats}>
            {[
              { title: 'إجمالي مواضيع الموظفين', value: counts.total },
              { title: 'متأخرة', value: counts.overdue },
              { title: 'متابعة اليوم', value: counts.today },
              { title: 'قادمة', value: counts.upcoming },
            ].map((item) => (
              <StatCard
                key={item.title}
                title={item.title}
                value={item.value}
                icon="chart"
                hint="من قاعدة البيانات مباشرة"
              />
            ))}
          </div>

          <div className={styles.tabsRow}>
            <SegmentedTabs
              id="manager-followups-supervision-tabs"
              label="تصنيف متابعات الموظفين"
              value={tab}
              onChange={(value) => setTab(value as FollowUpTabId)}
              items={tabItems}
            />
          </div>

          <div className={managerStyles.supervisionToolbar}>
            {/* RTL grid: the status field lands on the RIGHT, the employee
                filter beside it, and the search fills the rest to the LEFT
                boundary — the same one-row grammar as «متابعاتي». */}
            <label className={styles.filterField}>
              الحالة
              <GlassSelect
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as SupervisionStatusFilter)
                }
              >
                {MANAGER_STATUS_FILTERS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </GlassSelect>
            </label>
            <label className={styles.filterField}>
              الموظف المسؤول
              <GlassSelect
                value={employeeUserId}
                onChange={(event) => setEmployeeUserId(event.target.value)}
              >
                <option value="">جميع الموظفين</option>
                {employeeOptions.map((option) => (
                  <option key={option.userId} value={option.userId}>
                    {option.name}
                  </option>
                ))}
              </GlassSelect>
            </label>
            <SearchBar
              label="البحث في متابعات الموظفين"
              placeholder="ابحث بالاسم أو الهاتف أو كود العقار أو اسم الموظف"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className={styles.list}>
            {groups.length > 0 && (
              <div className={styles.listGrid}>
                {groups.map((group) => (
                  <SupervisionCard
                    key={group.key}
                    name={group.name}
                    phone={group.phone}
                    subjectCount={group.subjects.length}
                    subjects={group.subjects}
                    onOpen={(subject) =>
                      setDrawer({
                        key: group.key,
                        tab: 'record',
                        subjectId: subject.id,
                      })
                    }
                  />
                ))}
              </div>
            )}
            {groups.length === 0 && (
              <Card>
                {!items.length
                  ? 'لا توجد متابعات موظفين بعد — تظهر هنا متابعة الملاك والعملاء المسندة للموظفين تلقائيًا.'
                  : 'لا توجد متابعات تطابق التبويب والفلاتر الحالية.'}
              </Card>
            )}
          </div>

          {drawer && drawerGroup && (
            <EmployeeFollowUpDrawer
              key={drawerGroup.key}
              group={drawerGroup}
              subjectId={drawer.subjectId}
              tab={drawer.tab}
              focusSubjectId={focus?.subjectId ?? null}
              focusEntryId={focus?.entryId ?? null}
              onSubjectSwitch={(next) => {
                // An associations-row switch is an EXPLICIT subject change:
                // any stale history-highlight focus is dropped with it.
                setFocus((previous) =>
                  previous?.subjectId === next ? previous : null,
                );
                setDrawer((previous) =>
                  previous && previous.key === drawerGroup.key
                    ? { ...previous, subjectId: next }
                    : previous,
                );
              }}
              onReminded={handleReminded}
              onClose={() => {
                setDrawer(null);
                setFocus(null);
              }}
            />
          )}
        </>
      )}

      <Toast message={notice} onDismiss={() => setNotice('')} />
    </>
  );
}

/**
 * ONE supervision person card — the SAME redesigned grammar as the personal
 * board: a clean identity header (name · phone · subject count) and ONE
 * compact clickable row per subject, each carrying ITS OWN server bucket
 * badge, its OWN saved-entries count and the responsible employee's name.
 * No whole-card trigger anymore: clicking a row opens the LEFT drawer for
 * EXACTLY that subject. No gold fill, no expanded inline details.
 */
function SupervisionCard({
  name,
  phone,
  subjectCount,
  subjects,
  onOpen,
}: {
  name: string;
  phone: string;
  subjectCount: number;
  subjects: FollowUpSupervisionSubjectDto[];
  onOpen: (subject: FollowUpSupervisionSubjectDto) => void;
}) {
  return (
    <Card className={styles.personCard}>
      <div className={styles.cardBody}>
        <div className={styles.cardHeader}>
          <div className={styles.cardIdentity}>
            <span className={styles.cardName}>{name}</span>
            {phone ? (
              // A plain tel anchor: calling dials directly — it never opens
              // the drawer and never touches anyone's schedule.
              <a className={styles.cardPhone} href={`tel:${phone}`} dir="ltr">
                {phone}
              </a>
            ) : null}
            <span
              className={styles.subjectsCount}
              aria-label="عدد مواضيع المتابعة"
            >
              {subjectCountLabel(subjectCount)}
            </span>
          </div>
        </div>

        <ul className={styles.subjectRows}>
          {subjects.map((subject) => (
            <li key={subject.id} className={styles.subjectRow}>
              <button
                type="button"
                className={styles.subjectActionRow}
                aria-haspopup="dialog"
                aria-label={`فتح تفاصيل ${subject.label}`}
                onClick={() => onOpen(subject)}
              >
                <span className={styles.subjectInfo}>
                  <span className={styles.subjectLabel}>{subject.label}</span>
                  <span className={styles.subjectMeta}>
                    {subject.responsible.name}
                    {' · '}
                    {subjectDueLine(subject)}
                  </span>
                </span>
                <span className={styles.subjectBadges}>
                  <span
                    className={styles.badge}
                    data-bucket={subject.bucket}
                    aria-label="حالة الاستحقاق"
                  >
                    {MANAGER_BUCKET_LABELS[subject.bucket]}
                  </span>
                  <span
                    className={styles.badge}
                    aria-label="عدد المتابعات المسجلة"
                  >
                    {entryCountLabel(subject.entryCount)}
                  </span>
                </span>
                <span className={styles.subjectChevron} aria-hidden="true">
                  ←
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
