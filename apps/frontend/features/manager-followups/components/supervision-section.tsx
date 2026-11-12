'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { StatCard } from '../../../components/ui/stat-card';
import { SearchBar } from '../../../components/ui/search-bar';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { GlassSelect } from '../../../components/ui/glass-select';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
import {
  TABS,
  entryCountLabel,
  subjectCountLabel,
  subjectDueLine,
  type FollowUpTabId,
} from '../../employee-followups/model';
import {
  MANAGER_BUCKET_LABELS,
  MANAGER_STATUS_FILTERS,
  groupSupervision,
  type SupervisionGroup,
  type SupervisionStatusFilter,
} from '../model';
import {
  followUpApiMessage,
  getFollowUpHistory,
  getSupervisionSummary,
  listSupervisionEmployees,
  listSupervisionFollowUps,
} from '../../../lib/api/followups-api';
import type {
  FollowUpResponsibleDto,
  FollowUpSummaryApiDto,
  FollowUpSupervisionSubjectDto,
} from '../../../lib/api/followup-types';
import { useDebouncedValue } from '../../../lib/use-debounced-value';
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

  const [rows, setRows] = useState<FollowUpSupervisionSubjectDto[]>([]);
  const [summary, setSummary] = useState<FollowUpSummaryApiDto | null>(null);
  const [employees, setEmployees] = useState<FollowUpResponsibleDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [employeeNextCursor, setEmployeeNextCursor] = useState<string | null>(
    null,
  );
  const [employeeLoading, setEmployeeLoading] = useState(false);
  const [employeeError, setEmployeeError] = useState<string | null>(null);
  const [employeeQuery, setEmployeeQuery] = useState('');
  const debouncedEmployeeQuery = useDebouncedValue(employeeQuery, 300);
  const employeeCursorRef = useRef<string | null>(null);
  const employeeRequestRef = useRef(0);
  const employeeBusyRef = useRef(false);
  const selectedEmployeeRef = useRef<FollowUpResponsibleDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<FollowUpTabId>('all');
  const [status, setStatus] = useState<SupervisionStatusFilter>('all');
  const [employeeUserId, setEmployeeUserId] = useState('');
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);
  const cursorRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const busyRef = useRef(false);
  const paramsRef = useRef({
    search: debouncedQuery,
    tab,
    status,
    employeeUserId,
  });
  paramsRef.current = { search: debouncedQuery, tab, status, employeeUserId };
  const [drawer, setDrawer] = useState<{
    key: string;
    tab: string;
    subjectId: string | null;
  } | null>(null);
  /** Deep-link target that is not on the currently loaded page. */
  const [focusGroup, setFocusGroup] = useState<SupervisionGroup | null>(null);
  // The exact target a follow-up deep link focused (the entry highlight in
  // the drawer's history tab); cleared as soon as the drawer is closed.
  const [focus, setFocus] = useState<{
    subjectId: string;
    entryId: string | null;
  } | null>(null);
  // Committed reminder results (subject → sentAt) applied on top of the
  // feed, so «آخر تذكير» flips even before the next full refresh.
  const [reminded, setReminded] = useState<Record<string, string>>({});
  const handleReminded = useCallback((subjectId: string, sentAt: string) => {
    setReminded((previous) => ({ ...previous, [subjectId]: sentAt }));
  }, []);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    busyRef.current = true;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setRows([]);
    setNextCursor(null);
    cursorRef.current = null;
    try {
      const [data, summaryData] = await Promise.all([
        listSupervisionFollowUps({
          search: debouncedQuery.trim() || undefined,
          tab,
          status,
          employeeUserId: employeeUserId || undefined,
          limit: 50,
        }),
        getSupervisionSummary(employeeUserId || undefined),
      ]);
      if (requestId !== requestIdRef.current) return;
      setRows(data.items);
      setSummary(summaryData);
      setNextCursor(data.nextCursor);
      cursorRef.current = data.nextCursor;
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      setError(
        followUpApiMessage(
          cause,
          'تعذّر تحميل متابعات الفريق. حاول مرة أخرى.',
        ),
      );
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        busyRef.current = false;
      }
    }
  }, [debouncedQuery, tab, status, employeeUserId]);

  const loadMore = useCallback(async () => {
    const cursor = cursorRef.current;
    if (!cursor || busyRef.current) return;
    const requestId = requestIdRef.current;
    const params = paramsRef.current;
    busyRef.current = true;
    setLoadingMore(true);
    setError(null);
    try {
      const data = await listSupervisionFollowUps({
        search: params.search.trim() || undefined,
        tab: params.tab,
        status: params.status,
        employeeUserId: params.employeeUserId || undefined,
        cursor,
        limit: 50,
      });
      if (requestId !== requestIdRef.current) return;
      setRows((previous) => {
        const seen = new Set(previous.map((subject) => subject.id));
        return [
          ...previous,
          ...data.items.filter((subject) => !seen.has(subject.id)),
        ];
      });
      setNextCursor(data.nextCursor);
      cursorRef.current = data.nextCursor;
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      setError(
        followUpApiMessage(cause, 'تعذّر تحميل المزيد من متابعات الفريق.'),
      );
    } finally {
      if (requestId === requestIdRef.current) {
        setLoadingMore(false);
        busyRef.current = false;
      }
    }
  }, []);

  // Host-shell refresh counter → reload the feed.
  const loadEmployeeOptions = useCallback(
    async (append = false) => {
      if (append && (employeeBusyRef.current || !employeeCursorRef.current)) {
        return;
      }
      const requestId = ++employeeRequestRef.current;
      const cursor = append ? employeeCursorRef.current : null;
      if (!append) {
        employeeCursorRef.current = null;
        setEmployeeNextCursor(null);
      }
      employeeBusyRef.current = true;
      setEmployeeLoading(true);
      setEmployeeError(null);
      try {
        const data = await listSupervisionEmployees({
          search: debouncedEmployeeQuery.trim() || undefined,
          cursor: cursor ?? undefined,
          limit: 100,
        });
        if (requestId !== employeeRequestRef.current) return;
        setEmployees((previous) => {
          const base = append ? previous : [];
          const seen = new Set(base.map((option) => option.userId));
          const merged = [
            ...base,
            ...data.items.filter((option) => !seen.has(option.userId)),
          ];
          const selected = selectedEmployeeRef.current;
          if (selected && !merged.some((o) => o.userId === selected.userId)) {
            merged.unshift(selected);
          }
          return merged;
        });
        employeeCursorRef.current = data.nextCursor;
        setEmployeeNextCursor(data.nextCursor);
      } catch (cause) {
        if (requestId !== employeeRequestRef.current) return;
        setEmployeeError(
          followUpApiMessage(cause, 'تعذّر تحميل قائمة الموظفين.'),
        );
      } finally {
        if (requestId === employeeRequestRef.current) {
          setEmployeeLoading(false);
          employeeBusyRef.current = false;
        }
      }
    },
    [debouncedEmployeeQuery],
  );

  // Employee options are independent of the feed page; search reloads only
  // this bounded list.
  useEffect(() => {
    void loadEmployeeOptions(false);
  }, [loadEmployeeOptions]);

  const firstRefreshSignal = useRef(refreshSignal);
  useEffect(() => {
    if (firstRefreshSignal.current !== refreshSignal) {
      firstRefreshSignal.current = refreshSignal;
      if (refreshSignal > 0) void load();
    }
  }, [refreshSignal, load]);

  const items: FollowUpSupervisionSubjectDto[] = useMemo(
    () =>
      rows.map((item) =>
        reminded[item.id]
          ? { ...item, lastReminderAt: reminded[item.id] ?? null }
          : item,
      ),
    [rows, reminded],
  );

  // The EMPLOYEE filter FIRST — the stats and the tab counts are computed
  // over employee-filtered subjects (the requirements' exact accounting).
  const employeeOptions = useMemo(() => {
    const selected = selectedEmployeeRef.current;
    return selected && !employees.some((o) => o.userId === selected.userId)
      ? [selected, ...employees]
      : employees;
  }, [employees, employeeUserId]);

  const tabItems = useMemo(
    () =>
      TABS.map((item) => ({
        ...item,
        count: summary?.tabs[item.id] ?? 0,
      })),
    [summary],
  );

  const counts = useMemo(
    () => ({
      total: summary?.total ?? 0,
      overdue: summary?.overdue ?? 0,
      today: summary?.today ?? 0,
      upcoming: summary?.upcoming ?? 0,
    }),
    [summary],
  );

  const groups = useMemo(() => groupSupervision(items), [items]);

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
    const restoredTab =
      focusTab === 'record' ||
      focusTab === 'history' ||
      focusTab === 'associations'
        ? focusTab
        : 'history';
    if (group) {
      setDrawer({
        key: group.key,
        tab: restoredTab,
        subjectId: focusSubjectId,
      });
      setFocus({ subjectId: focusSubjectId, entryId: focusEntryId || null });
    } else {
      // Beyond the loaded page: fetch exactly that authorized subject.
      void getFollowUpHistory(focusSubjectId)
        .then((data) => {
          const subject: FollowUpSupervisionSubjectDto = {
            ...data.subject,
            responsible:
              data.subject.responsible ?? { userId: '', name: '' },
            lastReminderAt: null,
          };
          const fallback = groupSupervision([subject])[0];
          if (!fallback) return;
          setFocusGroup(fallback);
          setDrawer({
            key: fallback.key,
            tab: restoredTab,
            subjectId: focusSubjectId,
          });
          setFocus({
            subjectId: focusSubjectId,
            entryId: focusEntryId || null,
          });
        })
        .catch(() => undefined);
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
      : (allGroups.find((group) => group.key === drawer.key) ??
        (focusGroup?.key === drawer.key ? focusGroup : null));

  const busy = loading && rows.length === 0;

  return (
    <>
      {busy && (
        <p className={styles.state} role="status" aria-live="polite">
          جارٍ تحميل متابعات الموظفين…
        </p>
      )}
      {!busy && error && rows.length === 0 && (
        <Card>
          <p className={styles.errorText}>{error}</p>
          <Button onClick={() => void load()}>إعادة المحاولة</Button>
        </Card>
      )}

      {!busy && (!error || rows.length > 0) && (
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
                onChange={(event) => {
                  const userId = event.target.value;
                  setEmployeeUserId(userId);
                  selectedEmployeeRef.current = userId
                    ? (employees.find((option) => option.userId === userId) ??
                      selectedEmployeeRef.current)
                    : null;
                }}
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

          <div className={managerStyles.employeeFilterTools}>
            <SearchBar
              label="بحث في الموظفين"
              placeholder="ابحث باسم الموظف للوصول إلى ما بعد الصفحة الأولى"
              value={employeeQuery}
              onChange={(event) => setEmployeeQuery(event.target.value)}
            />
            {employeeNextCursor && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => void loadEmployeeOptions(true)}
                disabled={employeeLoading}
                aria-busy={employeeLoading}
              >
                {employeeLoading ? 'جارٍ التحميل…' : 'المزيد من الموظفين'}
              </Button>
            )}
          </div>
          {employeeError && <p className={styles.notice}>{employeeError}</p>}

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

          {nextCursor && !loading && (
            <p className={styles.state}>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                aria-busy={loadingMore}
              >
                {loadingMore ? 'جارٍ التحميل…' : 'تحميل المزيد'}
              </Button>
            </p>
          )}

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
                setFocusGroup(null);
              }}
            />
          )}
        </>
      )}
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
