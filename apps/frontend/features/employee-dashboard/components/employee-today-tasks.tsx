'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { FollowUpPersonDrawer } from '../../employee-followups/components/followup-person-drawer';
import {
  groupByPerson,
  BUCKET_LABELS,
  currentSubjectIdentity,
  displayDue,
} from '../../employee-followups/model';
import { listFollowUps } from '../../../lib/api/followups-api';
import type {
  FollowUpListDto,
  FollowUpSubjectDto,
} from '../../../lib/api/followup-types';
import styles from './employee-dashboard.module.css';

export function EmployeeTodayTasks() {
  const [feed, setFeed] = useState<FollowUpListDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'overdue' | 'today'>('all');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [drawer, setDrawer] = useState<{
    key: string;
    subjectId: string | null;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listFollowUps();
      setFeed(data);
    } catch {
      setError('تعذّر تحميل المهام. حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items = feed?.items ?? [];
  const groups = useMemo(() => groupByPerson(items), [items]);

  const actionable = useMemo(
    () => items.filter((s) => s.bucket === 'OVERDUE' || s.bucket === 'TODAY'),
    [items],
  );
  const overdue = useMemo(
    () => actionable.filter((s) => s.bucket === 'OVERDUE'),
    [actionable],
  );
  const today = useMemo(
    () => actionable.filter((s) => s.bucket === 'TODAY'),
    [actionable],
  );

  const filtered = useMemo(() => {
    if (filter === 'overdue') return overdue;
    if (filter === 'today') return today;
    return actionable;
  }, [filter, actionable, overdue, today]);

  const visible = filtered.slice(0, 4);
  const hasMore = filtered.length > 4;

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

  const drawerGroup = drawer
    ? (groups.find((g) => g.key === drawer.key) ?? null)
    : null;

  const openTask = useCallback(
    (subject: FollowUpSubjectDto) => {
      const group = groups.find((g) =>
        g.subjects.some((s) => s.id === subject.id),
      );
      if (!group) return;
      setDrawer({ key: group.key, subjectId: subject.id });
    },
    [groups],
  );

  return (
    <section className={styles.todayTasksSection}>
      <div className={styles.todayTasksHead}>
        <h2 className={styles.todayTasksTitle}>مهامي اليوم</h2>
      </div>

      {/* Filters */}
      <div className={styles.todayTasksFilters}>
        <button
          type="button"
          className={`${styles.todayTasksFilter} ${
            filter === 'all' ? styles.todayTasksFilterActive : ''
          }`}
          onClick={() => setFilter('all')}
        >
          الكل ({actionable.length})
        </button>
        <button
          type="button"
          className={`${styles.todayTasksFilter} ${
            filter === 'overdue' ? styles.todayTasksFilterActive : ''
          }`}
          onClick={() => setFilter('overdue')}
        >
          المتأخرة ({overdue.length})
        </button>
        <button
          type="button"
          className={`${styles.todayTasksFilter} ${
            filter === 'today' ? styles.todayTasksFilterActive : ''
          }`}
          onClick={() => setFilter('today')}
        >
          اليوم ({today.length})
        </button>
      </div>

      {/* Loading / error / empty / list */}
      {loading ? (
        <div className={styles.todayTasksList}>
          {[0, 1, 2].map((i) => (
            <div key={i} className={styles.todayTaskSkeleton} />
          ))}
        </div>
      ) : error ? (
        <Card>
          <p className={styles.todayTasksEmpty}>{error}</p>
          <Button onClick={() => void load()}>إعادة المحاولة</Button>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <p className={styles.todayTasksEmpty}>لا توجد متابعات مستحقة اليوم</p>
        </Card>
      ) : (
        <>
          <div className={styles.todayTasksList}>
            {visible.map((subject) => (
              <button
                key={subject.id}
                type="button"
                className={styles.todayTaskCard}
                onClick={() => openTask(subject)}
              >
                <div className={styles.todayTaskHead}>
                  <span className={styles.todayTaskName}>
                    {subject.person?.name ?? subject.label}
                  </span>
                  <span
                    className={styles.todayTaskBadge}
                    data-bucket={subject.bucket}
                  >
                    {BUCKET_LABELS[subject.bucket]}
                  </span>
                </div>
                <span className={styles.todayTaskSubject}>
                  {currentSubjectIdentity(subject)}
                </span>
                <span className={styles.todayTaskDue}>
                  {displayDue(subject.dueAt)}
                </span>
                <span className={styles.todayTaskAction}>متابعة العميل</span>
                <span className={styles.todayTaskOpen} aria-hidden="true">
                  فتح المتابعة ←
                </span>
              </button>
            ))}
          </div>
          {hasMore ? (
            <p className={styles.todayTasksMore}>
              {filtered.length - 4} مهام إضافية
            </p>
          ) : null}
        </>
      )}

      {drawer && drawerGroup && (
        <FollowUpPersonDrawer
          key={drawerGroup.key}
          group={drawerGroup}
          subjectId={drawer.subjectId}
          tab="record"
          propertyBase="/employee"
          notes={notes}
          onNoteChange={setNote}
          onClearNotes={clearNotes}
          onSaved={() => load()}
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
    </section>
  );
}
