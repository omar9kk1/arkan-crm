import type {
  FollowUpBucketApi,
  FollowUpSupervisionSubjectDto,
  FollowUpSubjectDto,
} from '../../lib/api/followup-types';
import {
  personGroupKey,
  subjectCategoryLabel,
} from '../employee-followups/model';

/**
 * Pure presentation helpers of the MANAGER follow-ups supervision feed
 * («متابعات الموظفين»).
 *
 * Everything is a derivation over the ALREADY-authorized manager-only feed —
 * no second scope check, no fabricated schedule, and the status words are the
 * supervision dictionary BELOW (deliberately never the employee page's
 * «مستحقة اليوم» wording here).
 */

/** The supervision status words (manager page ONLY — never «مستحقة»). */
export const MANAGER_BUCKET_LABELS: Record<FollowUpBucketApi, string> = {
  OVERDUE: 'متأخرة',
  TODAY: 'متابعة اليوم',
  UPCOMING: 'قادمة',
};

/** The status filter options of the supervision feed (labels as above). */
export type SupervisionStatusFilter = 'all' | 'OVERDUE' | 'TODAY' | 'UPCOMING' | 'NEVER';

export const MANAGER_STATUS_FILTERS: ReadonlyArray<{
  id: SupervisionStatusFilter;
  label: string;
}> = [
  { id: 'all', label: 'الكل' },
  { id: 'OVERDUE', label: 'متأخرة' },
  { id: 'TODAY', label: 'متابعة اليوم' },
  { id: 'UPCOMING', label: 'قادمة' },
  { id: 'NEVER', label: 'لم تتم متابعتها' },
];

/** True when the status filter selects this subject (supervision wording). */
export function supervisionMatchesStatus(
  subject: FollowUpSubjectDto,
  filter: SupervisionStatusFilter,
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'NEVER':
      return subject.lastSavedAt === null;
    default:
      return subject.bucket === filter;
  }
}

/** ONE employee option of the «الموظف المسؤول» filter (identity + name). */
export interface EmployeeFilterOption {
  userId: string;
  name: string;
}

/**
 * «جميع الموظفين» option FIRST, then every ACTUAL responsible employee of the
 * current feed in name order — the filter is derived from real rows, never
 * the employees directory (a stopped employee with in-flight subjects stays
 * visible and filterable exactly because the data says so).
 */
export function employeeFilterOptions(
  items: FollowUpSupervisionSubjectDto[],
): EmployeeFilterOption[] {
  const seen = new Map<string, string>();
  for (const item of items) seen.set(item.responsible.userId, item.responsible.name);
  return [
    ...[...seen.entries()]
      .map(([userId, name]) => ({ userId, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar')),
  ];
}

/** True when the responsible-employee filter selects this subject. */
export function supervisionMatchesEmployee(
  subject: FollowUpSupervisionSubjectDto,
  employeeUserId: string,
): boolean {
  // '' = «جميع الموظفين».
  return !employeeUserId || subject.responsible.userId === employeeUserId;
}

/**
 * The supervision search haystack: the responsible EMPLOYEE name + the
 * person name/phone + the subject label + property code — searching by the
 * employee name is a real use of the overview (find employee X's queue).
 * Notes are never searched (they are conversation records, not an index).
 */
export function supervisionHaystack(subject: FollowUpSupervisionSubjectDto): string {
  return [
    subject.responsible.name,
    subject.person?.name,
    subject.person?.phone,
    subject.label,
    subject.propertyReference,
    subject.propertyTitle,
    subject.area,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Applies status + employee + search to the supervision feed. */
export function filterSupervision(
  items: FollowUpSupervisionSubjectDto[],
  status: SupervisionStatusFilter,
  employeeUserId: string,
  query: string,
): FollowUpSupervisionSubjectDto[] {
  const needle = query.trim();
  return items.filter((subject) => {
    if (!supervisionMatchesStatus(subject, status)) return false;
    if (!supervisionMatchesEmployee(subject, employeeUserId)) return false;
    if (!needle || supervisionHaystack(subject).includes(needle)) return true;
    return false;
  });
}

/**
 * The Arabic OVERDUE duration for the supervision rows («متأخرة منذ …»):
 * hours below a day, whole days on/after it, with the Arabic dual and plural
 * forms — a presentation rendering of the REAL server-side overdue state.
 */
export function overdueDurationLabel(dueAtIso: string, now = new Date()): string {
  const timestamp = Date.parse(dueAtIso);
  if (Number.isNaN(timestamp)) return '';
  const hours = Math.max(0, Math.floor((now.getTime() - timestamp) / 3_600_000));
  const unit = (amount: number, single: string, dual: string, pluralBasis: string) =>
    amount === 1
      ? single
      : amount === 2
        ? dual
        : `${amount} ${pluralBasis}`;
  if (hours < 24) return unit(hours, 'ساعة', 'ساعتين', 'ساعات');
  const days = Math.floor(hours / 24);
  return unit(days, 'يوم', 'يومين', 'أيام');
}

/**
 * ONE supervision person card: grouped by the SAME reliable person identity
 * as the employee board (`CONTACT|OWNER|CLIENT + id`), each subject keeping
 * its own employee, schedule and history — grouping is a UI convenience only
 * and can never merge two employees' notes or schedules.
 */
export interface SupervisionGroup {
  key: string;
  name: string;
  phone: string;
  categories: string[];
  subjects: FollowUpSupervisionSubjectDto[];
  nextDueAt: string;
}

/** Groups the filtered feed into person cards, worst-due first. */
export function groupSupervision(
  subjects: FollowUpSupervisionSubjectDto[],
): SupervisionGroup[] {
  const groups = new Map<string, FollowUpSupervisionSubjectDto[]>();
  for (const subject of subjects) {
    const key = personGroupKey(subject);
    const bucket = groups.get(key);
    if (bucket) bucket.push(subject);
    else groups.set(key, [subject]);
  }
  return [...groups.entries()]
    .map(([key, subjects]) => {
      const categories: string[] = [];
      for (const subject of subjects) {
        const label = subjectCategoryLabel(
          subject.kind,
          subject.requestType,
          subject.tabs,
        );
        if (!categories.includes(label)) categories.push(label);
      }
      const person = subjects[0]?.person ?? null;
      return {
        key,
        name: person?.name ?? subjects[0]?.label ?? '',
        phone: person?.phone ?? '',
        categories,
        subjects,
        // The EARLIEST due of the group — most-overdue-first pinning survives
        // even when the in-memory subject order diverges (the server feed is
        // already ordered).
        nextDueAt: subjects.reduce<string>(
          (min, subject) => (subject.dueAt < min ? subject.dueAt : min),
          subjects[0]?.dueAt ?? new Date(0).toISOString(),
        ),
      };
    })
    .sort((a, b) => a.nextDueAt.localeCompare(b.nextDueAt));
}

/** «تذكير الموظف» is a MANUAL action of the manager for OVERDUE subjects. */
export function reminderAllowed(subject: FollowUpSupervisionSubjectDto): boolean {
  return subject.bucket === 'OVERDUE';
}
