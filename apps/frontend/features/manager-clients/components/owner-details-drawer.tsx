import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Role } from '@arkan/shared';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { AnimatedCount } from '../../../components/ui/animated-count';
import type { OwnerSample } from '../client-model';
import { PersonProperties } from './person-properties';
import { useAuth } from '../../auth/components/auth-provider';
import { requestOpenProperty } from '../../notifications/open-property';
import { PROPERTY_QUERY_PARAM } from '../../../lib/property-reveal';
import { FollowUpHistoryTimeline } from '../../employee-followups/components/followup-person-drawer';
import {
  followUpApiMessage,
  getFollowUpHistory,
  listFollowUps,
  listSupervisionFollowUps,
} from '../../../lib/api/followups-api';
import type { FollowUpEntryDto, FollowUpSubjectDto } from '../../../lib/api/followup-types';
import styles from './clients.module.css';
export function OwnerDetailsDrawer({
  owner,
  onClose,
}: {
  owner: OwnerSample;
  onClose: () => void;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const isManager =
    user?.role === Role.MANAGER || user?.role === Role.OWNER;

  // Reuses the existing property deep-link channel AND carries the id in the
  // URL: the properties page resolves both through one authorized
  // `GET /properties/:id`, activates the tab that shows the row, merges the real
  // row into the grid so the exact card is present even off the first page,
  // highlights it and opens the existing drawer. The URL keeps the selection
  // across a refresh or a direct deep-link.
  const openProperty = (propertyId: string) => {
    requestOpenProperty(propertyId);
    const route =
      user?.role === Role.MANAGER || user?.role === Role.OWNER
        ? '/manager/properties'
        : '/employee/properties';
    router.push(`${route}?${PROPERTY_QUERY_PARAM}=${encodeURIComponent(propertyId)}`);
  };

  const ownerPropertyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of owner.properties) {
      if (p.id) ids.add(p.id);
    }
    return ids;
  }, [owner.properties]);

  const [subjects, setSubjects] = useState<FollowUpSubjectDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');
  const [history, setHistory] = useState<FollowUpEntryDto[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const data = isManager
          ? await listSupervisionFollowUps()
          : await listFollowUps();
        if (cancelled) return;
        const items: FollowUpSubjectDto[] = data.items ?? [];
        // Only PROPERTY_OWNER subjects related to this owner's authorized properties
        const related = items.filter((s) => {
          if (s.kind !== 'PROPERTY_OWNER') return false;
          if (!s.propertyId) return false;
          return ownerPropertyIds.has(s.propertyId);
        });
        setSubjects(related);
        if (related.length > 0) {
          setSelectedSubjectId((prev) => prev && related.some((r) => r.id === prev) ? prev : related[0]!.id);
        } else {
          setSelectedSubjectId('');
        }
      } catch (e: unknown) {
        if (cancelled) return;
        setError(followUpApiMessage(e, 'تعذر تحميل المتابعات'));
        setSubjects([]);
        setSelectedSubjectId('');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isManager, ownerPropertyIds]);

  useEffect(() => {
    if (!selectedSubjectId) {
      setHistory([]);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    getFollowUpHistory(selectedSubjectId)
      .then((res) => {
        if (cancelled) return;
        setHistory(res?.entries ?? []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setHistoryError(followUpApiMessage(e, 'تعذر تحميل سجل المتابعة'));
        setHistory([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSubjectId]);

  return (
    <PropertyOverlay
      drawer
      title={`ملف المالك · ${owner.name}`}
      onClose={onClose}
    >
      <dl className={styles.facts}>
        {([
          ['الاسم', owner.name],
          ['الهاتف', owner.phone],
          ['الحالة', owner.status],
          ['آخر متابعة', owner.lastFollowUp],
          // A real COUNT — the same shared count-up as everywhere else.
          [
            'عدد العقارات',
            <AnimatedCount key="owner-properties" value={owner.properties.length} />,
          ],
        ] as Array<[string, ReactNode]>).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <bdi>{value}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      {owner.status === 'متأخر' && (
        <p className={styles.alert}>
          توجد متابعة متأخرة تحتاج مراجعة من المدير
        </p>
      )}
      <h3>العقارات التابعة للمالك</h3>
      <PersonProperties
        properties={owner.properties}
        onOpenProperty={openProperty}
      />
      <h3>{isManager ? 'سجل المتابعات' : 'سجل متابعاتي'}</h3>
      {loading ? (
        <p className={styles.secondary}>جارٍ التحميل…</p>
      ) : error ? (
        <p className={styles.secondary}>{error}</p>
      ) : subjects.length === 0 ? (
        <p>لا توجد متابعات مسجلة</p>
      ) : (
        <>
          {subjects.length > 1 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
              {subjects.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedSubjectId(s.id)}
                  style={{
                    padding: '0.25rem 0.75rem',
                    borderRadius: '999px',
                    border: selectedSubjectId === s.id ? '1px solid var(--accent, #b9a06c)' : '1px solid rgba(185,160,108,0.35)',
                    background: selectedSubjectId === s.id ? 'rgba(185,160,108,0.12)' : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  {s.propertyReference || s.label}
                </button>
              ))}
            </div>
          ) : null}
          {historyLoading ? (
            <p className={styles.secondary}>جارٍ تحميل السجل…</p>
          ) : historyError ? (
            <p className={styles.secondary}>{historyError}</p>
          ) : history.length === 0 ? (
            <p>لا توجد متابعات مسجلة</p>
          ) : (
            <FollowUpHistoryTimeline entries={history} />
          )}
        </>
      )}
    </PropertyOverlay>
  );
}
