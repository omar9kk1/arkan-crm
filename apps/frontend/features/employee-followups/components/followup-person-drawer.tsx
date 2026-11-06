'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { AnimatedCount } from '../../../components/ui/animated-count';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { Toast } from '../../../components/ui/toast';
import {
  BUCKET_LABELS,
  displayDue,
  focusPersonGroup,
  personAssociations,
  subjectCategoryLabel,
  type PersonGroup,
} from '../model';
import {
  followUpApiMessage,
  getFollowUpHistory,
  saveFollowUpBatch,
} from '../../../lib/api/followups-api';
import { requestOpenProperty } from '../../notifications/open-property';
import { PROPERTY_QUERY_PARAM } from '../../../lib/property-reveal';
import { PersonAssociationsPanel } from './person-associations';
import type {
  FollowUpEntryDto,
  FollowUpHistoryDto,
  FollowUpSubjectDto,
} from '../../../lib/api/followup-types';
import styles from './followups.module.css';

/** The drawer's EXACTLY two tabs («تسجيل متابعة» is the default). */
const DRAWER_TABS = [
  { id: 'record', label: 'بيانات المتابعة' },
  { id: 'history', label: 'سجل المتابعات' },
  { id: 'associations', label: 'الارتباطات' },
] as const;
type DrawerTabId = (typeof DRAWER_TABS)[number]['id'];

/** Kuwait (UTC+3) formatters — the project's established display convention. */
const DATE_FORMAT = new Intl.DateTimeFormat('ar-KW', {
  timeZone: 'Asia/Kuwait',
  dateStyle: 'medium',
});
const TIME_FORMAT = new Intl.DateTimeFormat('ar-KW', {
  timeZone: 'Asia/Kuwait',
  timeStyle: 'short',
});

/**
 * ONE immutable history snapshot at a time, PER SUBJECT — histories are never
 * merged: every subject keeps its own heading, entries and schedule effects.
 */
interface SubjectHistorySnapshot {
  subjectId: string;
  data: FollowUpHistoryDto | null;
  error: string | null;
}

/** The drawer's fact tile (label over value). */
export function DrawerFact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.detailsRow}>
      <span className={styles.factLabel}>{label}</span>
      <span className={styles.factValue}>{children}</span>
    </div>
  );
}

/**
 * A due/last-follow-up instant as TWO short readable lines (date, then time)
 * in Kuwait time — same timezone conventions as the rest of the project, with
 * bidi isolation so Arabic-Indic digits and «ص/م」 never reorder.
 */
export function DueValue({ iso }: { iso: string | null }) {
  if (!iso) return <span>لم تتم متابعتها</span>;
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return <span>—</span>;
  const date = new Date(timestamp);
  return (
    <>
      <span className={styles.factDate}>{DATE_FORMAT.format(date)}</span>
      <span className={styles.factTime}>{TIME_FORMAT.format(date)}</span>
    </>
  );
}

/**
 * THE numbered vertical timeline of ONE subject's history — shared verbatim
 * by the employee drawer, the manager's personal board and the read-only
 * supervision drawer so all three show the EXACT same grammar:
 *
 *  - Newest entry on top, oldest at the bottom (the server's order).
 *  - Number «1» belongs to the OLDEST (bottom) entry; the newest carries the
 *    largest number. Numbering is INDEPENDENT per subject.
 *  - Neutral surfaces only (no gold): plain numbered nodes joined by the
 *    vertical connector, which stops at the last (oldest) node.
 *  - Inside each card the note is the primary element; the meta block below
 *    the hairline keeps a fixed order: الكاتب، تاريخ الإنشاء، الموعد القادم،
 *    النوع. Long notes wrap without breaking the card.
 */
export function FollowUpHistoryTimeline({
  entries,
  focusEntryId,
}: {
  entries: FollowUpEntryDto[];
  /**
   * The FollowUpEntry a notification deep link focused: it is scrolled into
   * view and carries a subtle fading highlight. Null = the plain timeline.
   */
  focusEntryId?: string | null;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!focusEntryId) return;
    if (!entries.some((entry) => entry.id === focusEntryId)) return;
    const node = listRef.current?.querySelector(
      `li[data-entry-id="${focusEntryId}"]`,
    );
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusEntryId, entries]);
  return (
    <ol ref={listRef} className={styles.timelineList}>
      {entries.map((entry, index) => (
        <li
          key={entry.id}
          data-entry-id={entry.id}
          className={`${styles.timelineItem}${
            entry.id === focusEntryId ? ` ${styles.timelineEntryFocus}` : ''
          }`}
        >
          {/* Newest first; number «1» belongs to the OLDEST (bottom) entry
              of THIS subject's own history. */}
          <span className={styles.timelineNode}>{entries.length - index}</span>
          <div className={styles.timelineCard}>
            <p className={styles.timelineNote}>{entry.note}</p>
            <dl className={styles.timelineMeta}>
              <div className={styles.timelineMetaItem}>
                <dt className={styles.timelineMetaLabel}>الكاتب</dt>
                <dd className={styles.timelineMetaValue}>
                  {entry.authorName ?? 'مستخدم'}
                </dd>
              </div>
              <div className={styles.timelineMetaItem}>
                <dt className={styles.timelineMetaLabel}>تاريخ الإنشاء</dt>
                <dd className={styles.timelineMetaValue}>
                  {displayDue(entry.createdAt)}
                </dd>
              </div>
              {entry.nextDueAt ? (
                <div className={styles.timelineMetaItem}>
                  <dt className={styles.timelineMetaLabel}>الموعد القادم</dt>
                  <dd className={styles.timelineMetaValue}>
                    {displayDue(entry.nextDueAt)}
                  </dd>
                </div>
              ) : null}
              {entry.batchId ? (
                <div className={styles.timelineMetaItem}>
                  <dt className={styles.timelineMetaLabel}>النوع</dt>
                  <dd className={styles.timelineMetaValue}>مكالمة مشتركة</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * The side drawer of ONE person: compact header identity (name, phone,
 * activity badges), exactly two full-width tabs, and all note writing +
 * history reading INSIDE it. Every subject's notes editor starts COLLAPSED
 * and opens independently via its own «إضافة متابعة» button (several can be
 * open at once). Drafts live OUT of this component (page-level state) —
 * collapsing an editor, switching tabs, closing the drawer or a failed save
 * can never lose them; an empty textarea is never submitted, so it can never
 * reset its schedule. `propertyBase` routes the property deep link to the
 * caller's own account area ('/employee' by default — the manager personal
 * board passes '/manager').
 */
export function FollowUpPersonDrawer({
  group,
  subjectId,
  tab,
  propertyBase = '/employee',
  notes,
  onNoteChange,
  onClearNotes,
  onSaved,
  onSubjectSwitch,
  onClose,
}: {
  group: PersonGroup;
  /**
   * The EXACT subject this drawer opened for (a clicked subject row or a
   * deep link). The drawer then shows ONLY that subject — its facts, its
   * editor and its own history — while the person's other subjects stay out.
   * A subject that vanished from a refreshed feed falls back safely to the
   * whole person (nothing stale is ever saved).
   */
  subjectId?: string | null;
  /** Initial tab (the deep link opens the history side directly). */
  tab: string;
  /** The account area of the property deep link ('/employee' | '/manager'). */
  propertyBase?: string;
  notes: Record<string, string>;
  onNoteChange: (subjectId: string, value: string) => void;
  onClearNotes: (subjectIds: readonly string[]) => void;
  /** Reload the page feed (after a committed save). */
  onSaved: () => Promise<void>;
  /** An associations-row click that switches the drawer's exact subject. */
  onSubjectSwitch: (subjectId: string) => void;
  onClose: () => void;
}) {
  /**
   * The SUBJECT-FOCUSED view of the person: when a subject row was clicked,
   * every list/effect/save below runs against exactly that subject. Derived
   * in a memo so ids stay stable, and an unknown id (e.g. a refresh changed
   * the feed) safely degrades to the whole person instead of saving blind.
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
  // derived from the same authorized feed, so no extra API round-trip and no
  // data outside this caller's scope is ever read or counted.
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
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [snapshots, setSnapshots] = useState<SubjectHistorySnapshot[]>([]);
  /**
   * Note editors start COLLAPSED for every subject; each «إضافة متابعة»
   * opens ONLY its own editor (several can be open at once for one call).
   * Collapsing never touches `notes` — drafts are page-level — so a collapsed
   * editor keeps everything typed in it, and a committed save collapses
   * exactly the subjects it saved.
   */
  const [openEditors, setOpenEditors] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggleEditor = useCallback((subjectId: string) => {
    setOpenEditors((prev) => {
      const next = new Set(prev);
      if (next.has(subjectId)) next.delete(subjectId);
      else next.add(subjectId);
      return next;
    });
  }, []);
  const router = useRouter();

  const draftOf = useCallback(
    (subjectId: string) => (notes[subjectId] ?? '').trim(),
    [notes],
  );
  const hasDrafts = useMemo(
    () =>
      activeGroup.subjects.some((subject) => draftOf(subject.id).length > 0),
    [activeGroup.subjects, draftOf],
  );

  /**
   * The property tile → the project's OWN property deep-link convention
   * (same channel the follow-ups page uses): reveal + exact `Property.id`.
   * Only subjects holding a real `propertyId` get here — a client request
   * without a linked property never invents a link. Unsaved drafts trigger
   * the same confirmation the drawer close uses before navigating away.
   */
  const openSubjectProperty = useCallback(
    (subject: FollowUpSubjectDto) => {
      if (!subject.propertyId) return;
      if (
        hasDrafts &&
        !window.confirm(
          'لديك ملاحظات لم تُحفظ بعد — فتح العقار سيغادر الصفحة ويفقدها. هل تريد المتابعة؟',
        )
      )
        return;
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
        `${propertyBase}/properties?${PROPERTY_QUERY_PARAM}=${encodeURIComponent(subject.propertyId)}`,
      );
    },
    [hasDrafts, propertyBase, router],
  );

  /**
   * The associations panel's subject switch — IN-PLACE inside this same
   * drawer: the caller (board) updates the drawer's subjectId; the drawer
   * stays mounted, never navigates, and the history effect below re-fetches
   * ONLY the new subject (the old request dies with the cleanup flag, so no
   * stale data can ever overwrite the freshly selected subject). Drafts are
   * page-level and keyed per subject — switching preserves every draft, so
   * nothing is silently lost (closing the drawer itself keeps the same
   * guard).
   */
  const switchSubjectInPlace = useCallback(
    (nextSubjectId: string) => {
      // Reset the subject-scoped editor/timeline bookkeeping that belongs to
      // the OLD selection (drafts stay at board level).
      onSubjectSwitch(nextSubjectId);
    },
    [onSubjectSwitch],
  );

  // Complaint-free dismissal UNLESS drafts would be lost — Escape, the close
  // button and the backdrop all pass through this same guard.
  const guardClose = useCallback(() => {
    if (!activeGroup.subjects.some((subject) => draftOf(subject.id).length > 0))
      return true;
    return window.confirm(
      'لديك ملاحظات لم تُحفظ بعد — الإغلاق الآن سيفقدها. هل تريد الإغلاق؟',
    );
  }, [activeGroup.subjects, draftOf]);

  // REAL per-subject history, loaded INDEPENDENTLY (§4): fulfilled → data,
  // rejected → its own error, so one failure never hides the rest. Every
  // reload of the authorized feed (e.g. after a saved note) refetches.
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
    // Re-fetch when the person's subject list changes — which a committed
    // save also causes (the caller reloads the authorized feed). Loaded for
    // BOTH tabs, so switching tabs never refetches.
  }, [activeGroup.subjects]);

  /**
   * The EXISTING atomic batch save: ONE conversation may cover several
   * subjects; every subject WITH a note earns its own immutable entry and its
   * own server-computed next due (+3d owner / +5d request). Empty textareas
   * are NOT submitted — they cannot reset a schedule. Drafts survive failures.
   */
  const saveBatch = useCallback(async () => {
    const batch = activeGroup.subjects
      .map((subject) => ({ subjectId: subject.id, note: draftOf(subject.id) }))
      .filter((row) => row.note.length > 0);
    if (batch.length === 0) return;
    setSaving(true);
    setActionError('');
    try {
      const result = await saveFollowUpBatch(
        crypto.randomUUID(),
        batch.map((row) => ({ subjectId: row.subjectId, note: row.note })),
      );
      // Confirmation ONLY after the server commits (or replays).
      onClearNotes(batch.map((row) => row.subjectId));
      // ...and collapse exactly the editors just saved. Every other editor
      // keeps its expanded state, drafts elsewhere are untouched, and a
      // failure below changes nothing.
      setOpenEditors((prev) => {
        const next = new Set(prev);
        for (const row of batch) next.delete(row.subjectId);
        return next;
      });
      setNotice(
        result.replayed
          ? 'تم التحقق من المتابعات المحفوظة مسبقًا (لم تُكرَّر).'
          : result.savedCount === 1
            ? 'تم حفظ المتابعة وتحديد الموعد القادم.'
            : `تم حفظ ${result.savedCount} متابعات وتحديد مواعيدها القادمة.`,
      );
      // Fresh feed → fresh subject list → history effect refetches itself.
      await onSaved();
    } catch (cause) {
      setActionError(
        followUpApiMessage(cause, 'تعذر حفظ المتابعة. حاول مرة أخرى.'),
      );
    } finally {
      setSaving(false);
    }
  }, [activeGroup.subjects, draftOf, onClearNotes, onSaved]);

  return (
    <PropertyOverlay
      className={styles.personDrawer}
      drawer
      /* Slide in/out from the PHYSICAL left edge (see `.personDrawer`
         entry keyframes + `slideFromLeft` in the overlay). */
      slideFromLeft
      /* SECTION 1: the PERSON is the drawer's headline; the selected subject
         lives in its own «المتابعة الحالية» block below (approved structure,
         no crowded single-line collisions). */
      title={group.name}
      guardClose={guardClose}
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
      /* The pinned bottom action row: it exists ONLY while there is
         something to save (or a save is running) — no blank footer ever.
         The save button never scrolls away and never overlaps the
         textareas being written. */
      footer={
        hasDrafts || saving ? (
          <div className={styles.drawerFooter}>
            <Button
              className={styles.drawerSave}
              onClick={() => void saveBatch()}
              disabled={saving}
            >
              {saving ? 'جارٍ الحفظ…' : 'حفظ المتابعات'}
            </Button>
            <p className={styles.saveHint}>
              يُحفظ كل موضوع كتبت له ملاحظة كمدخل مستقل؛ الحقول الفارغة لا
              تُرسل.
            </p>
          </div>
        ) : undefined
      }
    >
      {/* The tabs sit at the TOP of the scroll body's own content box — the
          same `padding-inline` box the subject cards occupy — so both edges
          of the tabs container and of the cards below align EXACTLY (desktop
          and mobile), with one small gap between them. */}
      <div className={styles.drawerTabs}>
        <SegmentedTabs
          id="followup-person-drawer-tabs"
          label="أقسام المتابعة"
          value={tabId}
          onChange={(value) => setTabId(value as DrawerTabId)}
          items={DRAWER_TABS}
        />
      </div>
      {/* Both panels stay MOUNTED (hidden), so drafts survive tab switches. */}
      <section
        id="followup-person-drawer-record"
        role="tabpanel"
        aria-labelledby="followup-person-drawer-tabs-tab-record"
        hidden={tabId !== 'record'}
      >
        <div className={styles.drawerSubjectList}>
          {activeGroup.subjects.map((subject) => (
            <SubjectRecordSection
              key={subject.id}
              subject={subject}
              open={openEditors.has(subject.id)}
              onToggleOpen={() => toggleEditor(subject.id)}
              note={notes[subject.id] ?? ''}
              onNoteChange={(value) => onNoteChange(subject.id, value)}
              onOpenProperty={() => openSubjectProperty(subject)}
            />
          ))}
        </div>
      </section>
      <section
        id="followup-person-drawer-history"
        className={styles.historyPanel}
        role="tabpanel"
        aria-labelledby="followup-person-drawer-tabs-tab-history"
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
                  <FollowUpHistoryTimeline entries={entries} />
                ) : (
                  <p className={styles.state}>
                    لا توجد متابعات مسجلة لهذا الموضوع حتى الآن.
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </section>
      <section
        id="followup-person-drawer-associations"
        role="tabpanel"
        aria-labelledby="followup-person-drawer-tabs-tab-associations"
        hidden={tabId !== 'associations'}
      >
        <PersonAssociationsPanel
          categories={associations}
          currentSubjectId={
            subjectScoped && activeSubject ? activeSubject.id : null
          }
          onSwitchSubject={(next) => {
            switchSubjectInPlace(next);
            setTabId('record');
          }}
        />
      </section>

      <Toast message={notice} onDismiss={() => setNotice('')} />
      {actionError ? (
        <Toast message={actionError} onDismiss={() => setActionError('')} />
      ) : null}
    </PropertyOverlay>
  );
}

/**
 * ONE compact record section per subject: heading (label + type + due
 * badge), a tidy two-column facts grid — ALWAYS visible — and the subject's
 * OWN notes editor behind «إضافة متابعة» / «إخفاء الملاحظات», collapsed by
 * default. Only THIS subject's editor toggles; drafts are page-level, so
 * collapsing can never lose what was typed.
 */
function SubjectRecordSection({
  subject,
  open,
  onToggleOpen,
  note,
  onNoteChange,
  onOpenProperty,
}: {
  subject: FollowUpSubjectDto;
  /** Is THIS subject's notes editor expanded? */
  open: boolean;
  /** Expand/collapse ONLY this subject's editor. */
  onToggleOpen: () => void;
  note: string;
  onNoteChange: (value: string) => void;
  onOpenProperty: () => void;
}) {
  // A REAL linked property only: client requests/inquiries without a
  // `propertyId` never receive a navigation affordance.
  const propertyLink = Boolean(subject.propertyId && subject.propertyReference);
  return (
    <article className={styles.drawerSubject}>
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

      {/* The facts block: small «تفاصيل المتابعة» heading with the subject's
          OWN status chip beside it, then ONE softly tinted details panel of
          compact horizontal label/value rows with subtle separators (no
          independent card/background for each fact). The property link keeps
          its real route WITHOUT repeating the code the header already shows. */}
      <div className={styles.factsHead}>
        <span className={styles.factsTitle}>تفاصيل المتابعة</span>
        <span className={styles.badge} data-bucket={subject.bucket}>
          {BUCKET_LABELS[subject.bucket]}
        </span>
      </div>
      <div className={styles.detailsPanel}>
        <DrawerFact label="آخر متابعة">
          <DueValue iso={subject.lastSavedAt} />
        </DrawerFact>
        <DrawerFact label="المتابعة القادمة">
          <DueValue iso={subject.dueAt} />
        </DrawerFact>
        {propertyLink ? (
          <div className={styles.detailsRow}>
            <span className={styles.factLabel}>العقار</span>
            <div className={styles.factValue}>
              <span dir="ltr">
                {subject.propertyReference}
                {subject.propertyTitle ? ` · ${subject.propertyTitle}` : ''}
              </span>
              <button
                type="button"
                className={styles.detailsLink}
                onClick={onOpenProperty}
                aria-label={`فتح العقار ${subject.propertyReference}`}
              >
                عرض تفاصيل العقار ←
              </button>
            </div>
          </div>
        ) : null}
        {subject.area ? (
          <DrawerFact label="المنطقة">{subject.area}</DrawerFact>
        ) : null}
        <DrawerFact label="عدد المتابعات">
          <AnimatedCount value={subject.entryCount} />
        </DrawerFact>
      </div>

      {/* Disclosure chip right beneath the always-visible details: ghost +
          neutral (never gold-filled); swaps its label while open. */}
      <Button
        type="button"
        variant="ghost"
        className={styles.noteToggle}
        onClick={onToggleOpen}
        aria-expanded={open}
        aria-controls={`followup-note-editor-${subject.id}`}
      >
        {open ? 'إخفاء الملاحظات' : 'إضافة متابعة'}
      </Button>
      {/* Stays MOUNTED while collapsed (only hidden), so the controlled draft
          and every id/label association survive collapse and reopen
          untouched — unsaved text can never be lost. */}
      <div
        id={`followup-note-editor-${subject.id}`}
        className={styles.noteEditor}
        hidden={!open}
      >
        <label
          className={styles.noteLabel}
          htmlFor={`followup-note-${subject.id}`}
        >
          ملاحظات المتابعة
        </label>
        <textarea
          id={`followup-note-${subject.id}`}
          className={styles.noteArea}
          placeholder="اكتب نتيجة التواصل مع العميل أو المالك..."
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          aria-label={`ملاحظات المتابعة — ${subject.label}`}
          maxLength={5000}
        />
        <p className={styles.noteHint}>
          سيتم تحديد موعد المتابعة القادمة تلقائيًا بعد الحفظ.
        </p>
      </div>
    </article>
  );
}
