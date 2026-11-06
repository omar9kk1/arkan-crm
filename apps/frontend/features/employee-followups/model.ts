import type {
  FollowUpBucketApi,
  FollowUpSubjectDto,
  FollowUpSubjectKindApi,
} from '../../lib/api/followup-types';

/**
 * Pure presentation helpers of the employee follow-ups page.
 *
 * Everything here is a derivation over the ALREADY-authorized server feed —
 * no second scope check, no fabricated schedule, no category guessed from
 * free text (the server derives `tabs` from structured facts only).
 */

/** The eight tabs, in the contractual order (server adds «الكل» implicitly). */
export type FollowUpTabId =
  | 'all'
  | 'owners'
  | 'buyers'
  | 'sellers'
  | 'renters'
  | 'lessors'
  | 'inquiries'
  | 'exchanges';

export const TABS: ReadonlyArray<{ id: FollowUpTabId; label: string }> = [
  { id: 'all', label: 'الكل' },
  { id: 'owners', label: 'الملاك' },
  { id: 'buyers', label: 'المشترين' },
  { id: 'sellers', label: 'البائعين' },
  { id: 'renters', label: 'المستأجرين' },
  { id: 'lessors', label: 'المؤجرين' },
  { id: 'inquiries', label: 'الاستفسارات' },
  { id: 'exchanges', label: 'البدل' },
];

/** The due-state filter options («لم تتم متابعتها» is a real server state). */
export type FollowUpStatusFilter =
  'all' | 'OVERDUE' | 'TODAY' | 'UPCOMING' | 'NEVER';

export const STATUS_FILTERS: ReadonlyArray<{
  id: FollowUpStatusFilter;
  label: string;
}> = [
  { id: 'all', label: 'الكل' },
  { id: 'OVERDUE', label: 'متأخرة' },
  { id: 'TODAY', label: 'مستحقة اليوم' },
  { id: 'UPCOMING', label: 'قادمة' },
  { id: 'NEVER', label: 'لم تتم متابعتها' },
];

/** Human Arabic phrase of each server bucket (the badge texts). */
export const BUCKET_LABELS: Record<FollowUpBucketApi, string> = {
  OVERDUE: 'متأخرة',
  TODAY: 'مستحقة اليوم',
  UPCOMING: 'قادمة',
};

/**
 * Which tab a subject belongs to. «الكل» is implicit everywhere; the other
 * tabs consume the structured `tabs` the server derived — never a guess.
 */
export function subjectMatchesTab(
  subject: FollowUpSubjectDto,
  tab: FollowUpTabId,
): boolean {
  if (tab === 'all') return true;
  return subject.tabs.includes(tab);
}

/** True when the status filter selects this subject. */
export function subjectMatchesStatus(
  subject: FollowUpSubjectDto,
  filter: FollowUpStatusFilter,
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

/**
 * The search haystack: person name/phone, the subject's label, the property
 * code/title/area. Free-text server notes are NOT searched — a saved note is
 * a conversation record, not a search index.
 */
export function subjectHaystack(subject: FollowUpSubjectDto): string {
  return [
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

/** Applies tab + status + search to the authorized feed. */
export function filterSubjects(
  subjects: FollowUpSubjectDto[],
  tab: FollowUpTabId,
  status: FollowUpStatusFilter,
  query: string,
): FollowUpSubjectDto[] {
  const needle = query.trim();
  return subjects.filter((subject) => {
    if (!subjectMatchesTab(subject, tab)) return false;
    if (!subjectMatchesStatus(subject, status)) return false;
    if (!needle || subjectHaystack(subject).includes(needle)) return true;
    return false;
  });
}

/**
 * The reliable person identity a subject was derived from. `CONTACT`/`OWNER`
 * registry records and `Client` rows are DIFFERENT tables — they are grouped
 * only by their OWN (type,id), so two similar names are NEVER merged (§2:
 * grouping only when the identity relationship itself is reliable).
 */
export function personGroupKey(subject: FollowUpSubjectDto): string {
  if (!subject.person) return `SUBJECT:${subject.id}`;
  return `PERSON:${subject.person.type}:${subject.person.id}`;
}

/** Category badge text of one subject inside its person card. */
export function subjectCategoryLabel(
  kind: FollowUpSubjectKindApi,
  requestType: string | null,
  tabs: string[],
): string {
  if (kind === 'PROPERTY_OWNER')
    return tabs.includes('lessors')
      ? 'مؤجر'
      : tabs.includes('sellers')
        ? 'بائع'
        : 'مالك';
  if (kind === 'INQUIRY') return 'استفسار';
  if (kind === 'CLIENT_REQUEST') {
    if (requestType === 'BUYER') return 'مشتري';
    if (requestType === 'RENTER') return 'مستأجر';
    if (requestType === 'EXCHANGER') return 'بدل';
  }
  return 'متابعة عميل';
}

/**
 * The WORST server bucket across the person's subjects — the compact card
 * shows one aggregated due state while every subject keeps its own badge.
 * All buckets are real server decisions; nothing is computed on the device.
 */
export function personDueState(
  subjects: FollowUpSubjectDto[],
): FollowUpBucketApi {
  if (subjects.some((subject) => subject.bucket === 'OVERDUE'))
    return 'OVERDUE';
  if (subjects.some((subject) => subject.bucket === 'TODAY')) return 'TODAY';
  return 'UPCOMING';
}

export interface PersonGroup {
  /** Stable person identity (`PERSON:CONTACT:<id>`…) or the subject itself. */
  key: string;
  name: string;
  phone: string;
  /** The distinct category labels (بائع + مشتري …) in stable order. */
  categories: string[];
  /** Every authorized subject of this person oldest-due first. */
  subjects: FollowUpSubjectDto[];
  /** The earliest due instant — drives the card ordering. */
  nextDueAt: string;
}

/**
 * Groups the subjects of ONE TAB into person panels (§2). Grouping is a UI
 * convenience ONLY: each subject keeps its own due date, note and history,
 * and subjects with a reliable identity are merged only when their (type,id)
 * match exactly. A subject without a reliable person stands alone, so a name
 * match can NEVER create a group.
 */
export function groupByPerson(subjects: FollowUpSubjectDto[]): PersonGroup[] {
  const groups = new Map<string, FollowUpSubjectDto[]>();
  for (const subject of subjects) {
    const key = personGroupKey(subject);
    const bucket = groups.get(key);
    if (bucket) bucket.push(subject);
    else groups.set(key, [subject]);
  }
  return (
    [...groups.entries()]
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
          nextDueAt: subjects[0]?.dueAt ?? new Date(0).toISOString(),
        };
      })
      // Overdue-first ordering on the final feed: the server already returns
      // due-ascending subjects, so the group keeps that order and the OLDEST
      // due group comes first.
      .sort((a, b) => a.nextDueAt.localeCompare(b.nextDueAt))
  );
}

/** Date+time in Kuwait (UTC+3) as a plain display string — buckets stay the
 * server's decision; this is only the human rendering of the instant. */
export function displayDue(iso: string): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return '';
  return new Intl.DateTimeFormat('ar-KW', {
    timeZone: 'Asia/Kuwait',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

/** The Kuwait DATE ONLY («27 أكتوبر») for the compact card due lines — the
 * same timezone and calendar convention as `displayDue`, without the time. */
const DATE_ONLY_FORMAT = new Intl.DateTimeFormat('ar-KW', {
  timeZone: 'Asia/Kuwait',
  day: 'numeric',
  month: 'long',
});

export function displayDate(iso: string): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return '';
  return DATE_ONLY_FORMAT.format(new Date(timestamp));
}

/**
 * The SERVER bucket of one subject rendered as the card's compact due cell —
 * a label over its value («المتابعة القادمة» / «المتابعة اليوم» / «متأخرة»),
 * never a long metadata line. The bucket stays the server's single decision;
 * this only renders it read-only.
 */
export interface SubjectDueDisplay {
  label: string;
  value: string;
}

export function subjectDueDisplay(
  subject: FollowUpSubjectDto,
): SubjectDueDisplay {
  const date = displayDate(subject.dueAt);
  switch (subject.bucket) {
    case 'OVERDUE':
      return { label: 'متأخرة', value: `منذ ${date}` };
    case 'TODAY':
      return { label: 'المتابعة اليوم', value: date };
    default:
      return { label: 'المتابعة القادمة', value: date };
  }
}

/**
 * The due line of ONE subject ROW in the redesigned card — «المتابعة
 * القادمة: 29 أكتوبر» … — the server bucket rendered as ONE quiet phrase.
 * Each row renders its OWN subject's bucket; a person's rows never inherit
 * one shared status.
 */
export function subjectDueLine(subject: FollowUpSubjectDto): string {
  const date = displayDate(subject.dueAt);
  switch (subject.bucket) {
    case 'OVERDUE':
      return `المتابعة المتأخرة: ${date}`;
    case 'TODAY':
      return `المتابعة اليوم: ${date}`;
    default:
      return `المتابعة القادمة: ${date}`;
  }
}

/**
 * «0 متابعات / 1 متابعة / 3 متابعات» — the saved `FollowUpEntry` records of
 * ONE subject (`entryCount` comes straight from the server payload; never a
 * guess, never another subject's count).
 */
export function entryCountLabel(count: number): string {
  if (count === 0) return '0 متابعات';
  if (count === 1) return 'متابعة واحدة';
  if (count === 2) return 'متابعتان';
  if (count <= 10) return `${count} متابعات`;
  return `${count} متابعة`;
}

/**
 * «موضوع متابعة واحد / موضوعا متابعة / 3 مواضيع متابعة» — a person's subject
 * count for the card header and the drawer subtitle.
 */
export function subjectCountLabel(count: number): string {
  if (count === 1) return 'موضوع متابعة واحد';
  if (count === 2) return 'موضوعا متابعة';
  if (count <= 10) return `${count} مواضيع متابعة`;
  return `${count} موضوع متابعة`;
}

/**
 * The SUBJECT-FOCUSED view of ONE person group: when a subject row (or a
 * deep link) opens the drawer, it shows ONLY that subject. An id that is no
 * longer in the group's feed (e.g. after a refresh) safely degrades to the
 * whole person — nothing stale is ever rendered or saved blind to it.
 */
export function focusPersonGroup<
  G extends {
    key: string;
    name: string;
    phone: string;
    categories: readonly string[];
    subjects: ReadonlyArray<{ id: string }>;
  },
>(group: G, subjectId?: string | null): G {
  const focused = subjectId
    ? group.subjects.filter((subject) => subject.id === subjectId)
    : group.subjects;
  return focused.length > 0
    ? { ...group, subjects: focused as G['subjects'] }
    : group;
}

// ---------------------------------------------------------------------------
// REAL person associations (the drawer's collapsed dropdown)
// ---------------------------------------------------------------------------

export type PersonAssociationCategoryId =
  'properties' | 'buyers' | 'renters' | 'inquiries' | 'exchanges' | 'clients';

export interface PersonAssociationItem {
  /** Stable unique record identity (never a note, never a duplicate row). */
  key: string;
  /** The linked follow-up subject, when one exists (the switch target). */
  subjectId: string | null;
  /** The human identifier shown in the row (code — title, request summary…). */
  label: string;
  /** Quiet secondary line under `label` (the property's area, when known). */
  secondary?: string | null;
  /** Set for property associations (informational only since in-place switching). */
  propertyId: string | null;
}

export interface PersonAssociationCategory {
  id: PersonAssociationCategoryId;
  label: string;
  items: PersonAssociationItem[];
}

const ASSOCIATION_CATEGORY_LABELS: Record<PersonAssociationCategoryId, string> =
  {
    properties: 'العقارات',
    buyers: 'طلبات الشراء',
    renters: 'طلبات الإيجار',
    inquiries: 'الاستفسارات',
    exchanges: 'طلبات البدل',
    clients: 'متابعات العملاء',
  };

/**
 * The DISTINCT real associations of ONE person, derived ONLY from the
 * already-authorized follow-up feed (server-derived subjects — never mock,
 * never free-text guesses):
 *
 *  - العقارات: distinct `propertyId` values (an owner subject AND an inquiry
 *    on the same property still count THE PROPERTY once);
 *  - طلبات الشراء/الإيجار/البدل: the structured `CLIENT_REQUEST` subjects
 *    (one per stored wizard request type — distinct by construction);
 *  - الاستفسارات: the `INQUIRY` subjects (one per saved interest);
 *  - متابعات العملاء: legacy `CLIENT` subjects whose client identity is NOT
 *    already represented by a structured request above (so the same client
 *    is never counted twice).
 *
 * Every fixed category is returned so the drawer can render a stable list and
 * its explicit empty state; a category with no real records simply carries an
 * empty `items` array (no invented rows). The data is THE AUTHORIZED FEED
 * itself, so a caller can never see (or count) records outside their scope.
 */
export function personAssociations(
  subjects: readonly FollowUpSubjectDto[],
): PersonAssociationCategory[] {
  const buckets = new Map<
    PersonAssociationCategoryId,
    PersonAssociationItem[]
  >();
  const add = (
    category: PersonAssociationCategoryId,
    item: PersonAssociationItem,
  ) => {
    const bucket = buckets.get(category) ?? [];
    bucket.push(item);
    buckets.set(category, bucket);
  };

  const properties = new Map<string, PersonAssociationItem>();
  const structuredClientIds = new Set<string>();
  for (const subject of subjects) {
    if (subject.kind === 'INQUIRY' || subject.kind === 'CLIENT_REQUEST')
      structuredClientIds.add(subject.clientId ?? '');
    if (subject.propertyId && !properties.has(subject.propertyId)) {
      properties.set(subject.propertyId, {
        key: `PROPERTY:${subject.propertyId}`,
        subjectId: subject.id,
        label: subject.propertyReference
          ? `${subject.propertyReference}${subject.propertyTitle ? ` — ${subject.propertyTitle}` : ''}`
          : subject.propertyTitle || 'عقار',
        secondary: subject.area || null,
        propertyId: subject.propertyId,
      });
    }
  }
  for (const item of properties.values()) add('properties', item);

  for (const subject of subjects) {
    if (subject.kind === 'CLIENT_REQUEST' && subject.requestType) {
      add(
        subject.requestType === 'BUYER'
          ? 'buyers'
          : subject.requestType === 'RENTER'
            ? 'renters'
            : 'exchanges',
        {
          key: `REQUEST:${subject.id}`,
          subjectId: subject.id,
          label: subject.label,
          propertyId: null,
        },
      );
    } else if (subject.kind === 'INQUIRY') {
      add('inquiries', {
        key: `INQUIRY:${subject.id}`,
        subjectId: subject.id,
        label: subject.label,
        propertyId: null,
      });
    } else if (
      subject.kind === 'CLIENT' &&
      subject.clientId &&
      !structuredClientIds.has(subject.clientId)
    ) {
      add('clients', {
        key: `CLIENT:${subject.id}`,
        subjectId: subject.id,
        label: subject.label,
        propertyId: null,
      });
    }
  }

  const order: PersonAssociationCategoryId[] = [
    'properties',
    'buyers',
    'renters',
    'inquiries',
    'exchanges',
    'clients',
  ];
  return order.map((id) => ({
    id,
    label: ASSOCIATION_CATEGORY_LABELS[id],
    items: buckets.get(id) ?? [],
  }));
}

/** The total of DISTINCT association records behind the «N ارتباطات» chip. */
export function associationTotal(
  categories: readonly PersonAssociationCategory[],
): number {
  return categories.reduce(
    (total, category) => total + category.items.length,
    0,
  );
}

/** «ارتباط واحد / ارتباطان / 3 ارتباطات». */
export function associationCountLabel(count: number): string {
  if (count === 1) return 'ارتباط واحد';
  if (count === 2) return 'ارتباطان';
  if (count <= 10) return `${count} ارتباطات`;
  return `${count} ارتباط`;
}

/** The wizard request type of one `CLIENT_REQUEST` subject, phrased exactly. */
const REQUEST_CHIP_LABELS: Record<string, string> = {
  BUYER: 'طلب شراء',
  RENTER: 'طلب إيجار',
  EXCHANGER: 'طلب بدل',
};

/**
 * SECTION 2 identity of the approved header («المتابعة الحالية: …»): the
 * subject's OWN server label for an owner («مالك العقار A-000004» — the code
 * is already inside it, never repeated), the bare wizard request type
 * («طلب شراء»), a stated inquiry phrase, and the neutral subject label for
 * legacy rows. One identity, said once.
 */
export function currentSubjectIdentity(subject: FollowUpSubjectDto): string {
  switch (subject.kind) {
    case 'PROPERTY_OWNER':
      return subject.label;
    case 'CLIENT_REQUEST':
      return subject.requestType
        ? (REQUEST_CHIP_LABELS[subject.requestType] ?? subject.label)
        : subject.label;
    case 'INQUIRY':
      return subject.propertyReference
        ? `استفسار عن العقار ${subject.propertyReference}`
        : subject.label || 'استفسار عن عقار';
    default:
      return subject.label;
  }
}
