'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { FollowUpPersonDrawer } from '../../employee-followups/components/followup-person-drawer';
import { groupByPerson } from '../../employee-followups/model';
import { displayDue } from '../../employee-followups/model';
import { listFollowUps } from '../../../lib/api/followups-api';
import { getFollowUpAchievementsToday } from '../../../lib/api/followups-api';
import type { FollowUpListDto } from '../../../lib/api/followup-types';
import type { FollowUpAchievementsTodayDto } from '../../../lib/api/followups-api';
import styles from './employee-dashboard.module.css';

export function EmployeeAchievementsToday() {
  const [feed, setFeed] = useState<FollowUpListDto | null>(null);
  const [ach, setAch] = useState<FollowUpAchievementsTodayDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [drawer, setDrawer] = useState<{
    key: string;
    subjectId: string | null;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [f, a] = await Promise.all([
        listFollowUps(),
        getFollowUpAchievementsToday(),
      ]);
      setFeed(f);
      setAch(a);
    } catch {
      setError('تعذّر تحميل الإنجازات.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items = feed?.items ?? [];
  const groups = useMemo(() => groupByPerson(items), [items]);

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

  const openSubject = useCallback(
    (subjectId: string) => {
      const group = groups.find((g) =>
        g.subjects.some((s) => s.id === subjectId),
      );
      if (!group) return;
      setDrawer({ key: group.key, subjectId });
    },
    [groups],
  );

  const count = ach?.count ?? 0;
  const distinct = ach?.distinctSubjects ?? 0;
  const recent = ach?.entries ?? [];

  return (
    <section className={styles.achievementsSection}>
      <h2 className={styles.achievementsTitle}>إنجازاتي اليوم</h2>
      <p className={styles.achievementsSubtitle}>
        ملخص نشاطك المسجّل في النظام
      </p>

      {loading ? (
        <div className={styles.achievementsSkeleton} />
      ) : error ? (
        <Card>
          <p className={styles.achievementsEmpty}>{error}</p>
          <Button onClick={() => void load()}>إعادة المحاولة</Button>
        </Card>
      ) : (
        <>
          <div className={styles.achievementsMetrics}>
            <div className={styles.achievementCell}>
              <span className={styles.achievementValue}>{count}</span>
              <span className={styles.achievementLabel}>متابعات سجّلتها</span>
            </div>
            <div className={styles.achievementCell}>
              <span className={styles.achievementValue}>{distinct}</span>
              <span className={styles.achievementLabel}>
                مواضيع مختلفة تابعتها
              </span>
            </div>
          </div>

          {recent.length === 0 ? (
            <p className={styles.achievementsEmpty}>
              لم تُسجّل متابعات اليوم بعد
            </p>
          ) : (
            <div className={styles.achievementsActivity}>
              {recent.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className={styles.achievementRow}
                  onClick={() => openSubject(e.subjectId)}
                >
                  <span className={styles.achievementSubject}>
                    {e.subjectLabel}
                  </span>
                  <span className={styles.achievementAction}>
                    تم تسجيل متابعة جديدة
                  </span>
                  <span className={styles.achievementTime} dir="ltr">
                    {displayDue(e.createdAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {drawer && drawerGroup && (
        <FollowUpPersonDrawer
          key={drawerGroup.key}
          group={drawerGroup}
          subjectId={drawer.subjectId}
          tab="history"
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
