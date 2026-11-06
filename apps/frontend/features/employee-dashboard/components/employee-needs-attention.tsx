'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { FollowUpPersonDrawer } from '../../employee-followups/components/followup-person-drawer';
import {
  groupByPerson,
  currentSubjectIdentity,
  displayDue,
} from '../../employee-followups/model';
import { listFollowUps } from '../../../lib/api/followups-api';
import type {
  FollowUpListDto,
  FollowUpSubjectDto,
} from '../../../lib/api/followup-types';
import styles from './employee-dashboard.module.css';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

type Category = 'none' | 'old';

interface NeedItem {
  subject: FollowUpSubjectDto;
  category: Category;
}

export function EmployeeNeedsAttention() {
  const [feed, setFeed] = useState<FollowUpListDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'none' | 'old'>('all');
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
      setError('تعذّر تحميل البيانات. حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items = feed?.items ?? [];
  const groups = useMemo(() => groupByPerson(items), [items]);

  const needs = useMemo<NeedItem[]>(() => {
    const now = Date.now();
    const out: NeedItem[] = [];
    for (const s of items) {
      // client-related subjects only
      if (
        s.kind !== 'CLIENT_REQUEST' &&
        s.kind !== 'INQUIRY' &&
        s.kind !== 'CLIENT'
      )
        continue;
      // exclude overdue/today (those belong to "مهامي اليوم")
      if (s.bucket === 'OVERDUE' || s.bucket === 'TODAY') continue;
      if (s.entryCount === 0) {
        out.push({ subject: s, category: 'none' });
      } else if (s.lastSavedAt) {
        const last = Date.parse(s.lastSavedAt);
        if (!Number.isNaN(last) && now - last > SEVEN_DAYS_MS) {
          out.push({ subject: s, category: 'old' });
        }
      }
    }
    // prioritize: none first, then old by oldest lastSavedAt
    out.sort((a, b) => {
      if (a.category !== b.category) return a.category === 'none' ? -1 : 1;
      const la = a.subject.lastSavedAt ? Date.parse(a.subject.lastSavedAt) : 0;
      const lb = b.subject.lastSavedAt ? Date.parse(b.subject.lastSavedAt) : 0;
      return la - lb;
    });
    return out;
  }, [items]);

  const filtered = useMemo(() => {
    if (filter === 'none') return needs.filter((n) => n.category === 'none');
    if (filter === 'old') return needs.filter((n) => n.category === 'old');
    return needs;
  }, [filter, needs]);

  const visible = filtered.slice(0, 3);
  const noneCount = needs.filter((n) => n.category === 'none').length;
  const oldCount = needs.filter((n) => n.category === 'old').length;

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
    <section className={styles.needsSection}>
      <div className={styles.needsHead}>
        <h2 className={styles.needsTitle}>عملاء محتاجين اهتمام</h2>
        <div className={styles.needsFilters}>
          <button
            type="button"
            className={`${styles.needsFilter} ${
              filter === 'all' ? styles.needsFilterActive : ''
            }`}
            onClick={() => setFilter('all')}
          >
            الكل ({needs.length})
          </button>
          <button
            type="button"
            className={`${styles.needsFilter} ${
              filter === 'none' ? styles.needsFilterActive : ''
            }`}
            onClick={() => setFilter('none')}
          >
            بلا متابعة ({noneCount})
          </button>
          <button
            type="button"
            className={`${styles.needsFilter} ${
              filter === 'old' ? styles.needsFilterActive : ''
            }`}
            onClick={() => setFilter('old')}
          >
            تواصل قديم ({oldCount})
          </button>
        </div>
      </div>

      {loading ? (
        <div className={styles.needsList}>
          {[0, 1, 2].map((i) => (
            <div key={i} className={styles.needSkeleton} />
          ))}
        </div>
      ) : error ? (
        <Card>
          <p className={styles.needsEmpty}>{error}</p>
          <Button onClick={() => void load()}>إعادة المحاولة</Button>
        </Card>
      ) : needs.length === 0 ? (
        <Card>
          <p className={styles.needsEmpty}>
            لا يوجد عملاء يحتاجون اهتمامًا حاليًا
          </p>
        </Card>
      ) : (
        <div className={styles.needsList}>
          {visible.map((n) => (
            <button
              key={n.subject.id}
              type="button"
              className={styles.needCard}
              onClick={() => openSubject(n.subject)}
            >
              <div className={styles.needHead}>
                <span className={styles.needName}>
                  {n.subject.person?.name ?? n.subject.label}
                </span>
                <span className={styles.needBadge} data-category={n.category}>
                  {n.category === 'none' ? 'بلا متابعة' : 'تواصل قديم'}
                </span>
              </div>
              <span className={styles.needSubject}>
                {currentSubjectIdentity(n.subject)}
              </span>
              <span className={styles.needReason}>
                {n.category === 'none'
                  ? 'لا يوجد متابعة مسجّلة لهذا الطلب.'
                  : `آخر متابعة مسجّلة: ${displayDue(n.subject.lastSavedAt ?? '')}`}
              </span>
              <span className={styles.needOpen} aria-hidden="true">
                فتح المتابعة ←
              </span>
            </button>
          ))}
        </div>
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
