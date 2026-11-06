'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { AnimatedCount } from '../../../components/ui/animated-count';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { Toast } from '../../../components/ui/toast';
import {
  DueValue,
  FollowUpHistoryTimeline,
} from '../../employee-followups/components/followup-person-drawer';
import {
  BUCKET_LABELS,
  displayDue,
  focusPersonGroup,
  personAssociations,
  subjectCategoryLabel,
} from '../../employee-followups/model';
import {
  MANAGER_BUCKET_LABELS,
  overdueDurationLabel,
  reminderAllowed,
} from '../model';
import {
  followUpApiMessage,
  getFollowUpHistory,
  sendFollowUpReminder,
} from '../../../lib/api/followups-api';
import { requestOpenProperty } from '../../notifications/open-property';
import { PROPERTY_QUERY_PARAM } from '../../../lib/property-reveal';
import { PersonAssociationsPanel } from '../../employee-followups/components/person-associations';
import type {
  FollowUpHistoryDto,
  FollowUpSupervisionSubjectDto,
} from '../../../lib/api/followup-types';
import styles from '../../employee-followups/components/followups.module.css';
import managerStyles from './manager-followups.module.css';

/** The supervision drawer's EXACTLY two tabs. */
const DRAWER_TABS = [
  { id: 'record', label: 'بيانات المتابعة' },
  { id: 'history', label: 'سجل المتابعات' },
  { id: 'associations', label: 'الارتباطات' },
] as const;

type DrawerTabId = (typeof DRAWER_TABS)[number]['id'];

/**
 * ONE immutable history snapshot per subject, loaded independently (one
 * failure never hides the rest).
 */
interface SubjectHistorySnapshot {
  subjectId: string;
  data: FollowUpHistoryDto | null;
  error: string | null;
}

/**
 * The READ-ONLY supervision drawer of ONE person: identity, every subject's
 * facts (the responsible EMPLOYEE, category, last/next follow-up, the REAL
 * overdue duration, the latest manual reminder) and its history — plus the
 * «تذكير الموظف» reminder per ACTUALLY overdue subject.
 *
 * The manager NEVER records follow-up notes here: there is NO textarea, NO
 * batch save, no due-date/ownership/cycle editing, and no history editing —
 * the conversation stays the employee's voice alone. The reminder keeps the
 * server's cooldown state visible («تم إرسال التذكير») and is confirmed ONLY
 * after the server commits. Deep links open the property/client records on
 * the manager's OWN pages.
 */
export function EmployeeFollowUpDrawer({
  group,
  subjectId,
  tab,
  focusSubjectId,
  focusEntryId,
  onSubjectSwitch,
  onClose,
  onReminded,
}: {
  group: {
    key: string;
    name: string;
    phone: string;
    categories: string[];
    subjects: FollowUpSupervisionSubjectDto[];
  };
  /**
   * The EXACT subject this drawer opened for (a clicked subject row or a
   * deep link): the drawer shows ONLY that subject. An id that vanished from
   * a refreshed feed safely falls back to the whole person.
   */
  subjectId?: string | null;
  /** Initial tab (a notification deep link opens the history directly). */
  tab: string;
  /** The subject a follow-up deep link focused (null = plain manual open). */
  focusSubjectId?: string | null;
  /** The FollowUpEntry to scroll into view and subtly highlight, if any. */
  focusEntryId?: string | null;
  /** An associations-row click that switches the drawer's exact subject. */
  onSubjectSwitch: (subjectId: string) => void;
  onClose: () => void;
  /** Reports a server-committed reminder so the feed cards' «آخر تذكير»
   * flips immediately (the next reload confirms it from the server). */
  onReminded?: (subjectId: string, sentAt: string) => void;
}) {
  const router = useRouter();
  /**
   * The SUBJECT-FOCUSED view of the supervised person (read-only): when a
   * subject row or a deep link opened the drawer, every list and effect below
   * runs against exactly that subject. Memoized so ids stay stable, and an
   * unknown id safely degrades to the whole person (nothing stale renders).
   */
  const activeGroup = useMemo(
    () => focusPersonGroup(group, subjectId),
    [group, subjectId],
  );
  const activeSubject = activeGroup.subjects[0] ?? null;
  const subjectScoped = Boolean(
    activeSubject && subjectId === activeSubject.id,
  );
  // The person's REAL authorized associations (distinct records only) —
  // derived from the supervision feed itself, so the manager can never read
  // or count anything outside this authorized company scope.
  const associations = useMemo(
    () => personAssociations(group.subjects),
    [group.subjects],
  );
  const isRegistered = group.subjects.some(
    (subject) =>
      subject.person?.type === 'CLIENT' || subject.person?.type === 'CONTACT',
  );
  const [tabId, setTabId] = useState<DrawerTabId>(
    tab === 'history' ? 'history' : 'record',
  );
  const [notice, setNotice] = useState('');
  const [snapshots, setSnapshots] = useState<SubjectHistorySnapshot[]>([]);
  /** Committed reminder results per subject (the just-sent ones, so the
   * state survives even before the feed refresh lands). */
  const [sentAt, setSentAt] = useState<Record<string, string>>({});
  const [reminderBusy, setReminderBusy] = useState<Record<string, boolean>>({});

  // REAL per-subject history, loaded INDEPENDENTLY (one failure never hides
  // the rest). Re-fetched when the focused subject list changes — switching
  // tabs never refetches, and histories are read-only here (no reload loop).
  useEffect(() => {
    let cancelled = false;
    const subjects = activeGroup.subjects;
    void Promise.allSettled(
      subjects.map((subject) => getFollowUpHistory(subject.id)),
    ).then((results) => {
      if (cancelled) return;
      setSnapshots(
        subjects.map((subject, index) => {
          const result = results[index];
          return result && result.status === 'fulfilled'
            ? { subjectId: subject.id, data: result.value, error: null }
            : {
                subjectId: subject.id,
                data: null,
                error: followUpApiMessage(
                  result?.reason,
                  'تعذر تحميل سجل المتابعة.',
                ),
              };
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [activeGroup.subjects]);

  /**
   * The ONE manual reminder action of the whole page: a server call that
   * notifies the responsible employee through the existing pipeline,
   * cooldown-deduplicated server-side, and NEVER touches the subject's due
   * date, cycle, ownership or history. The state flips to «تم إرسال
   * التذكير» ONLY after the server commits (or replays within the window).
   */
  const sendReminder = useCallback(
    async (subjectId: string) => {
      setReminderBusy((previous) => ({ ...previous, [subjectId]: true }));
      try {
        const result = await sendFollowUpReminder(subjectId);
        setSentAt((previous) => ({ ...previous, [subjectId]: result.sentAt }));
        onReminded?.(subjectId, result.sentAt);
        setNotice(
          result.replayed
            ? 'تم إرسال التذكير للموظف المسؤول (ضمن نافذة التذكير نفسها، بلا تكرار).'
            : 'تم إرسال التذكير إلكترونيًا للموظف المسؤول.',
        );
      } catch (cause) {
        setNotice(
          followUpApiMessage(cause, 'تعذر إرسال التذكير. حاول مرة أخرى.'),
        );
      } finally {
        setReminderBusy((previous) => ({ ...previous, [subjectId]: false }));
      }
    },
    [onReminded],
  );

  // The property deep link → the manager's OWN properties page (same reveal
  // channel everywhere); read-only drawer → no draft-loss confirmation.
  const openSubjectProperty = useCallback(
    (subject: FollowUpSupervisionSubjectDto) => {
      if (!subject.propertyId) return;
      try {
        sessionStorage.setItem(
          'propertyDetailsOrigin',
          JSON.stringify({ subjectId: subject.id, tab: tabId }),
        );
      } catch {
        /* ignore */
      }
      requestOpenProperty(subject.propertyId);
      router.push(
        `/manager/properties?${PROPERTY_QUERY_PARAM}=${encodeURIComponent(subject.propertyId)}`,
      );
    },
    [router],
  );

  // The associations panel's property navigation: the SAME route convention,
  // unguarded by design — the supervision drawer is read-only (no drafts).
  // (The panel itself switches subjects IN-PLACE; this helper remains for the
  // drawer's own property tile inside the facts panel.)

  // The client-record deep link → the manager clients page, exactly the
  // drawer's `client` param convention.
  const openSubjectClient = useCallback(
    (subject: FollowUpSupervisionSubjectDto) => {
      if (!subject.clientId) return;
      router.push(
        `/manager/clients?client=${encodeURIComponent(subject.clientId)}`,
      );
    },
    [router],
  );

  return (
    <PropertyOverlay
      className={styles.personDrawer}
      drawer
      slideFromLeft
      /* SECTION 1: the PERSON is the headline; the selected subject lives in
         its own «المتابعة الحالية» block below (approved structure). */
      title={group.name}
      guardClose={() => true}
      onClose={onClose}
      headerDetails={
        <>
          <div className={styles.drawerIdentityRow}>
            {group.phone ? (
              <span className={styles.drawerPhone} dir="ltr">
                {group.phone}
              </span>
            ) : null}
            {isRegistered && (
              <span className={styles.registeredBadge}>مسجّل بالنظام</span>
            )}
          </div>
        </>
      }
    >
      <div className={styles.drawerTabs}>
        <SegmentedTabs
          id="manager-followups-drawer-tabs"
          label="أقسام بيانات المتابعة"
          value={tabId}
          onChange={(value) => setTabId(value as DrawerTabId)}
          items={DRAWER_TABS.map((item) => ({ ...item }))}
        />
      </div>

      {/* The facts panel (read-only) — one section per subject. */}
      <section
        id="manager-followups-drawer-record"
        role="tabpanel"
        aria-labelledby="manager-followups-drawer-tabs-tab-record"
        hidden={tabId !== 'record'}
      >
        <div className={styles.drawerSubjectList}>
          {activeGroup.subjects.map((subject) => {
            const employeeSent = sentAt[subject.id] ?? subject.lastReminderAt;
            const reminderSent = Boolean(employeeSent);
            const canRemind = reminderAllowed(subject) && !reminderSent;
            const busy = reminderBusy[subject.id] ?? false;
            const duration =
              subject.bucket === 'OVERDUE'
                ? overdueDurationLabel(subject.dueAt)
                : '';
            const propertyLink = Boolean(
              subject.propertyId && subject.propertyReference,
            );
            return (
              <article key={subject.id} className={styles.drawerSubject}>
                <div className={styles.drawerSubjectHead}>
                  <div className={styles.drawerSubjectTitle}>
                    <h4>{subject.label}</h4>
                    <span className={styles.subjectType}>
                      {subjectCategoryLabel(
                        subject.kind,
                        subject.requestType,
                        subject.tabs,
                      )}
                    </span>
                  </div>
                </div>

                {/* The facts block: small «تفاصيل المتابعة» heading with the
                    subject's OWN status chip beside it, then ONE softly tinted
                    details panel of compact label/value rows with subtle
                    separators (no independent card for each fact, no orphan
                    counter tile). READ-ONLY. */}
                <div className={styles.factsHead}>
                  <span className={styles.factsTitle}>تفاصيل المتابعة</span>
                  <span className={styles.badge} data-bucket={subject.bucket}>
                    {MANAGER_BUCKET_LABELS[subject.bucket]}
                    {duration ? ` · متأخرة ${duration}` : ''}
                  </span>
                </div>
                <div className={styles.detailsPanel}>
                  <div className={styles.detailsRow}>
                    <span className={styles.factLabel}>الموظف المسؤول</span>
                    <span className={styles.factValue}>
                      {subject.responsible.name}
                    </span>
                  </div>
                  <div className={styles.detailsRow}>
                    <span className={styles.factLabel}>آخر متابعة</span>
                    <span className={styles.factValue}>
                      <DueValue iso={subject.lastSavedAt} />
                    </span>
                  </div>
                  <div className={styles.detailsRow}>
                    <span className={styles.factLabel}>المتابعة القادمة</span>
                    <span className={styles.factValue}>
                      <DueValue iso={subject.dueAt} />
                    </span>
                  </div>
                  {duration ? (
                    <div className={styles.detailsRow}>
                      <span className={styles.factLabel}>مدة التأخر</span>
                      <span className={styles.factValue}>{duration}</span>
                    </div>
                  ) : null}
                  {propertyLink ? (
                    <div className={styles.detailsRow}>
                      <span className={styles.factLabel}>العقار</span>
                      <div className={styles.factValue}>
                        <span dir="ltr">
                          {subject.propertyReference}
                          {subject.propertyTitle
                            ? ` · ${subject.propertyTitle}`
                            : ''}
                        </span>
                        <button
                          type="button"
                          className={styles.detailsLink}
                          onClick={() => openSubjectProperty(subject)}
                          aria-label={`فتح العقار ${subject.propertyReference}`}
                        >
                          عرض تفاصيل العقار ←
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {!subject.propertyId && subject.clientId ? (
                    <div className={styles.detailsRow}>
                      <span className={styles.factLabel}>ملف العميل</span>
                      <div className={styles.factValue}>
                        <button
                          type="button"
                          className={styles.detailsLink}
                          onClick={() => openSubjectClient(subject)}
                          aria-label="فتح ملف العميل"
                        >
                          فتح سجل العميل ←
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {subject.area ? (
                    <div className={styles.detailsRow}>
                      <span className={styles.factLabel}>المنطقة</span>
                      <span className={styles.factValue}>{subject.area}</span>
                    </div>
                  ) : null}
                  <div className={styles.detailsRow}>
                    <span className={styles.factLabel}>عدد المتابعات</span>
                    <span className={styles.factValue}>
                      <AnimatedCount value={subject.entryCount} />
                    </span>
                  </div>
                  <div className={styles.detailsRow}>
                    <span className={styles.factLabel}>آخر تذكير</span>
                    <span className={styles.factValue}>
                      {employeeSent ? displayDue(employeeSent) : 'لم يُرسل بعد'}
                    </span>
                  </div>
                  {subject.person ? (
                    <div className={styles.detailsRow}>
                      <span className={styles.factLabel}>للتواصل</span>
                      <span className={styles.factValue} dir="ltr">
                        {subject.person.phone}
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* The reminders row: the ghost action only while the
                    subject is ACTUALLY overdue and not yet reminded; after a
                    server commit it becomes the non-actionable «تم إرسال
                    التذكير» state (the feed refresh keeps it committed). */}
                {reminderAllowed(subject) ? (
                  <div className={managerStyles.reminderRow}>
                    {reminderSent ? (
                      <span className={managerStyles.reminderSent}>
                        ✓ تم إرسال التذكير · {displayDue(employeeSent!)}
                      </span>
                    ) : (
                      <span className={managerStyles.reminderHint}>
                        إشعار داخلي + Web Push للموظف المسؤول، دون تغيير موعد
                        المتابعة.
                      </span>
                    )}
                    {!reminderSent ? (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={!canRemind || busy}
                        onClick={() => void sendReminder(subject.id)}
                      >
                        {busy ? 'جارٍ الإرسال…' : 'تذكير الموظف'}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {subject.bucket !== 'OVERDUE' ? (
                  <p className={managerStyles.reminderHint}>
                    يظهر زر «تذكير الموظف» فقط للمتأخرة فعلًا.
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      {/* The read-only history panel — identical timeline grammar, zero
          editing affordances: no textarea, no save button, nothing. */}
      <section
        id="manager-followups-drawer-history"
        className={styles.historyPanel}
        role="tabpanel"
        aria-labelledby="manager-followups-drawer-tabs-tab-history"
        hidden={tabId !== 'history'}
      >
        <div className={styles.drawerSubjectList}>
          {activeGroup.subjects.map((subject) => {
            const snapshot = snapshots.find(
              (row) => row.subjectId === subject.id,
            );
            const entries = snapshot?.data?.entries ?? null;
            return (
              <article key={subject.id} className={styles.drawerSubject}>
                <div className={styles.drawerSubjectHead}>
                  <h4 className={styles.historyHeading}>
                    سجل متابعة {subject.label}
                  </h4>
                  <span className={styles.badge} data-bucket={subject.bucket}>
                    {BUCKET_LABELS[subject.bucket]}
                  </span>
                </div>
                {!snapshot ? (
                  <p className={styles.state}>جارٍ تحميل السجل…</p>
                ) : snapshot.error ? (
                  <Card>
                    <p className={styles.errorText}>{snapshot.error}</p>
                  </Card>
                ) : entries && entries.length > 0 ? (
                  <FollowUpHistoryTimeline
                    entries={entries}
                    focusEntryId={
                      subject.id === focusSubjectId ? focusEntryId : null
                    }
                  />
                ) : (
                  <p className={styles.state}>
                    لا توجد متابعات مسجلة لهذا الموضوع حتى الآن.
                  </p>
                )}
                <p className={managerStyles.reminderHint}>
                  سجل المتابعات للقراءة فقط — لا يمكن للمدير تعديله.
                </p>
              </article>
            );
          })}
        </div>
      </section>
      <section
        id="manager-followups-drawer-associations"
        role="tabpanel"
        aria-labelledby="manager-followups-drawer-tabs-tab-associations"
        hidden={tabId !== 'associations'}
      >
        <PersonAssociationsPanel
          categories={associations}
          currentSubjectId={
            subjectScoped && activeSubject ? activeSubject.id : null
          }
          onSwitchSubject={(next) => {
            onSubjectSwitch(next);
            setTabId('history');
          }}
        />
      </section>

      <Toast message={notice} onDismiss={() => setNotice('')} />
    </PropertyOverlay>
  );
}
