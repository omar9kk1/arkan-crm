import {
  BUCKET_LABELS,
  TABS,
  associationCountLabel,
  associationTotal,
  currentSubjectIdentity,
  displayDate,
  displayDue,
  entryCountLabel,
  filterSubjects,
  focusPersonGroup,
  groupByPerson,
  personAssociations,
  personGroupKey,
  subjectCategoryLabel,
  subjectCountLabel,
  subjectDueDisplay,
  subjectDueLine,
  subjectHaystack,
  type FollowUpStatusFilter,
  type FollowUpTabId,
} from '../../frontend/features/employee-followups/model';
import {
  MANAGER_BUCKET_LABELS,
  MANAGER_STATUS_FILTERS,
  employeeFilterOptions,
  filterSupervision,
  groupSupervision,
  overdueDurationLabel,
  reminderAllowed,
  supervisionHaystack,
  supervisionMatchesEmployee,
  supervisionMatchesStatus,
  type SupervisionStatusFilter,
} from '../../frontend/features/manager-followups/model';
import type {
  FollowUpSubjectDto,
  FollowUpSupervisionSubjectDto,
} from '../../frontend/lib/api/followup-types';

/**
 * Pure unit tests for the employee follow-ups page model: the eight tabs, the
 * status filters, the search and the SMART PERSON GROUPING (§1, §2). No React
 * runner is involved — the real module is exercised directly.
 */

let sequence = 0;

function subject(
  overrides: Partial<FollowUpSubjectDto> = {},
): FollowUpSubjectDto {
  sequence += 1;
  const row: FollowUpSubjectDto = {
    id: `s-${sequence}`,
    kind: 'PROPERTY_OWNER',
    requestType: null,
    label: 'مالك العقار A-000012',
    tabs: ['owners', 'sellers'],
    person: { type: 'CONTACT', id: 'c1', name: 'أحمد', phone: '66001001' },
    propertyId: `p-${sequence}`,
    propertyReference: 'A-000012',
    propertyTitle: 'بيت',
    area: 'الفروانية',
    clientId: null,
    dueAt: '2026-10-20T09:00:00.000Z',
    bucket: 'UPCOMING',
    responsible: null,
    lastSavedAt: null,
    entryCount: 0,
    latest: null,
  };
  // Same semantics as `{ ...row, ...overrides }` but WITHOUT the TS quirk
  // where a `Partial` spread can turn a required field's type into
  // `field | undefined`.
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      (row as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return row;
}

/** Strips the invisible bidi marks and whitespace runs ICU may inject around
 * Arabic-Indic digits, so display strings can be compared exactly. */
const normalize = (text: string): string =>
  text.replace(/[\u200E\u200F\u061C\s]+/g, ' ').trim();

describe('the eight follow-up tabs', () => {
  it('lists the tabs in the contractual order with Arabic labels', () => {
    expect(TABS.map((tab) => tab.label)).toEqual([
      'الكل',
      'الملاك',
      'المشترين',
      'البائعين',
      'المستأجرين',
      'المؤجرين',
      'الاستفسارات',
      'البدل',
    ]);
  });

  it('shows ONE subject in EVERY relevant tab without duplicating it', () => {
    // A selling owner also appears under «البائعين» (same underlying subject).
    const seller = subject({ tabs: ['owners', 'sellers'] });
    const rentingOwner = subject({ tabs: ['owners', 'lessors'] });
    for (const tabId of ['owners', 'sellers'] as FollowUpTabId[])
      expect(filterSubjects([seller], tabId, 'all', '')).toEqual([seller]);
    expect(filterSubjects([seller], 'buyers', 'all', '')).toEqual([]);
    for (const tabId of ['owners', 'lessors'] as FollowUpTabId[])
      expect(filterSubjects([rentingOwner], tabId, 'all', '')).toEqual([
        rentingOwner,
      ]);
    // «الكل» is implicit everywhere.
    expect(filterSubjects([seller, rentingOwner], 'all', 'all', '')).toEqual([
      seller,
      rentingOwner,
    ]);
  });
});

describe('status filters and search', () => {
  it('filters by the SERVER bucket and «لم تتم متابعتها»', () => {
    const overdue = subject({ bucket: 'OVERDUE' });
    const today = subject({ bucket: 'TODAY' });
    const upcoming = subject({
      bucket: 'UPCOMING',
      lastSavedAt: '2026-10-19T09:00:00.000Z',
    });
    const rows = [overdue, today, upcoming];
    const pick = (status: FollowUpStatusFilter) =>
      filterSubjects(rows, 'all', status, '').map((row) => row.id);
    expect(pick('OVERDUE')).toEqual([overdue.id]);
    expect(pick('TODAY')).toEqual([today.id]);
    expect(pick('UPCOMING')).toEqual([upcoming.id]);
    expect(pick('NEVER')).toEqual([overdue.id, today.id]);
    expect(pick('all')).toEqual([overdue.id, today.id, upcoming.id]);
    expect(Object.keys(BUCKET_LABELS)).toEqual([
      'OVERDUE',
      'TODAY',
      'UPCOMING',
    ]);
  });

  it('searches by person name, phone and property code — never by notes', () => {
    const row = subject();
    expect(filterSubjects([row], 'all', 'all', 'أحمد')).toHaveLength(1);
    expect(filterSubjects([row], 'all', 'all', '66001001')).toHaveLength(1);
    expect(filterSubjects([row], 'all', 'all', 'A-000012')).toHaveLength(1);
    expect(filterSubjects([row], 'all', 'all', 'الفروانية')).toHaveLength(1);
    expect(filterSubjects([row], 'all', 'all', 'لا يوجد')).toHaveLength(0);
  });
});

describe('smart person grouping (§2)', () => {
  it('groups the SAME person across selling AND buying activities', () => {
    const samePerson = {
      person: {
        type: 'CONTACT' as const,
        id: 'c1',
        name: 'أحمد محمد',
        phone: '66001001',
      },
    };
    const selling = subject({ ...samePerson, label: 'مالك العقار A-000012' });
    const buying = subject({
      ...samePerson,
      kind: 'CLIENT_REQUEST',
      requestType: 'BUYER',
      tabs: ['buyers'],
      label: 'طلب شراء — أحمد محمد',
      propertyId: null,
      propertyReference: null,
      clientId: 'cl1',
    });
    const groups = groupByPerson([selling, buying]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.categories).toEqual(['بائع', 'مشتري']);
    expect(groups[0]?.subjects).toHaveLength(2);
    // ONE conversation card, but every subject keeps its OWN identity.
    expect(groups[0]?.subjects.map((s) => s.id)).toEqual([
      selling.id,
      buying.id,
    ]);
    expect(groupByPerson([selling])[0]?.categories).toEqual(['بائع']);
    expect(groupByPerson([buying])[0]?.categories).toEqual(['مشتري']);
  });

  it('never merges two different people with SIMILAR names', () => {
    const ahmadOne = subject({
      person: {
        type: 'CONTACT',
        id: 'c1',
        name: 'أحمد محمد',
        phone: '66001001',
      },
    });
    const ahmadTwo = subject({
      person: {
        type: 'CONTACT',
        id: 'c2',
        name: 'أحمد محمد',
        phone: '66001002',
      },
    });
    const groups = groupByPerson([ahmadOne, ahmadTwo]);
    expect(groups).toHaveLength(2);
    // A different registry row of the SAME person table is also a different
    // card — grouping follows the identity, never the display name.
    expect(groups.map((group) => group.key)).toEqual([
      personGroupKey(ahmadOne),
      personGroupKey(ahmadTwo),
    ]);
  });

  it('never groups across DIFFERENT identity tables', () => {
    const contact = subject({
      person: {
        type: 'CONTACT',
        id: 'c1',
        name: 'أحمد محمد',
        phone: '66001001',
      },
    });
    const clientRow = subject({
      person: {
        type: 'CLIENT',
        id: 'c1',
        name: 'أحمد محمد',
        phone: '66001001',
      },
      kind: 'CLIENT',
      tabs: [],
    });
    // Same textual identity, but CONTACT rows and CLIENT rows are different
    // databases tables without a reliable link — two standalone cards.
    expect(groupByPerson([contact, clientRow])).toHaveLength(2);
  });

  it('leaves a subject without a reliable person identity standing alone', () => {
    const orphan = subject({ person: null });
    expect(groupByPerson([orphan])).toHaveLength(1);
    expect(personGroupKey(orphan)).toBe(`SUBJECT:${orphan.id}`);
  });

  it('orders the person cards by the earliest due subject (overdue first)', () => {
    const later = subject({
      person: { type: 'CONTACT', id: 'c1', name: 'أحمد', phone: '66001001' },
      dueAt: '2026-10-25T09:00:00.000Z',
    });
    const earlier = subject({
      person: { type: 'CONTACT', id: 'c2', name: 'خالد', phone: '66001002' },
      dueAt: '2026-10-18T09:00:00.000Z',
    });
    const groups = groupByPerson([later, earlier]);
    expect(groups[0]?.name).toBe('خالد');
  });
});

describe('category labels and display', () => {
  it('labels each subject kind from structured data only', () => {
    expect(
      subjectCategoryLabel('PROPERTY_OWNER', null, ['owners', 'sellers']),
    ).toBe('بائع');
    expect(
      subjectCategoryLabel('PROPERTY_OWNER', null, ['owners', 'lessors']),
    ).toBe('مؤجر');
    expect(subjectCategoryLabel('PROPERTY_OWNER', null, ['owners'])).toBe(
      'مالك',
    );
    expect(subjectCategoryLabel('CLIENT_REQUEST', 'BUYER', ['buyers'])).toBe(
      'مشتري',
    );
    expect(
      subjectCategoryLabel('CLIENT_REQUEST', 'EXCHANGER', ['exchanges']),
    ).toBe('بدل');
    expect(subjectCategoryLabel('INQUIRY', null, ['inquiries'])).toBe(
      'استفسار',
    );
    expect(subjectCategoryLabel('CLIENT', null, [])).toBe('متابعة عميل');
  });

  it('renders due instants in Kuwait time (UTC+3, Arabic-Indic digits)', () => {
    // 09:30Z == 12:30 Kuwait.
    expect(displayDue('2026-10-20T09:30:00.000Z')).toContain('١٢:٣٠');
  });

  it('renders the compact card date in Kuwait time (day + month only)', () => {
    // 09:00Z == 12:00 Kuwait — the same calendar day, no clock time on cards.
    expect(normalize(displayDate('2026-10-27T09:00:00.000Z'))).toBe(
      '٢٧ أكتوبر',
    );
  });

  it('renders one compact due cell (label over value) per subject', () => {
    const upcoming = subjectDueDisplay(
      subject({
        bucket: 'UPCOMING',
        lastSavedAt: null,
        dueAt: '2026-10-27T09:00:00.000Z',
      }),
    );
    expect(upcoming.label).toBe('المتابعة القادمة');
    expect(normalize(upcoming.value)).toBe('٢٧ أكتوبر');
    const today = subjectDueDisplay(
      subject({ bucket: 'TODAY', lastSavedAt: '2026-10-19T09:00:00.000Z' }),
    );
    expect(today.label).toBe('المتابعة اليوم');
    expect(normalize(today.value)).toBe('٢٠ أكتوبر');
    // Overdue shows the MISSED instant (default dueAt = 2026-10-20 Kuwait).
    const overdue = subjectDueDisplay(
      subject({ bucket: 'OVERDUE', lastSavedAt: '2026-10-19T09:00:00.000Z' }),
    );
    expect(overdue.label).toBe('متأخرة');
    expect(normalize(overdue.value)).toBe('منذ ٢٠ أكتوبر');
  });
});

describe('search haystack', () => {
  it('contains the person, label and property fields', () => {
    const row = subject();
    expect(subjectHaystack(row)).toContain('أحمد');
    expect(subjectHaystack(row)).toContain('A-000012');
    expect(subjectHaystack(row)).toContain('بيت');
  });
});

/** The manager supervision feed: an employee-owned subject + its responsible
 * employee name and the latest manual reminder (the cooldown state). */
function supervSubject(
  overrides: Partial<FollowUpSupervisionSubjectDto> = {},
): FollowUpSupervisionSubjectDto {
  return {
    ...subject(),
    responsible: {
      userId: overrides.responsible?.userId ?? 'u-employee-1',
      name: overrides.responsible?.name ?? 'سالم الموظف',
    },
    lastReminderAt: null,
    ...overrides,
  } as FollowUpSupervisionSubjectDto;
}

describe('manager supervision model', () => {
  it('uses the supervision bucket wording — NEVER the employee «مستحقة»', () => {
    expect(MANAGER_BUCKET_LABELS).toEqual({
      OVERDUE: 'متأخرة',
      TODAY: 'متابعة اليوم',
      UPCOMING: 'قادمة',
    });
    expect(Object.values(MANAGER_BUCKET_LABELS).join(' ')).not.toContain(
      'مستحقة',
    );
    expect(MANAGER_STATUS_FILTERS.map((item) => item.label)).toEqual([
      'الكل',
      'متأخرة',
      'متابعة اليوم',
      'قادمة',
      'لم تتم متابعتها',
    ]);
  });

  it('filters by the SERVER bucket and «لم تتم متابعتها» (server decisions)', () => {
    const overdue = supervSubject({ bucket: 'OVERDUE' });
    const today = supervSubject({
      bucket: 'TODAY',
      lastSavedAt: '2026-10-19T09:00:00.000Z',
    });
    const upcoming = supervSubject({
      bucket: 'UPCOMING',
      lastSavedAt: '2026-10-19T09:00:00.000Z',
    });
    const untouched = supervSubject({ bucket: 'UPCOMING', lastSavedAt: null });
    const rows = [overdue, today, upcoming, untouched];
    const pick = (status: SupervisionStatusFilter) =>
      rows
        .filter((row) => supervisionMatchesStatus(row, status))
        .map((row) => row.id);
    expect(pick('OVERDUE')).toEqual([overdue.id]);
    expect(pick('TODAY')).toEqual([today.id]);
    expect(pick('UPCOMING')).toEqual([upcoming.id, untouched.id]);
    // «لم تتم متابعتها» is lastSavedAt-based and composes with the bucket:
    // an overdue subject never followed up appears in BOTH.
    expect(pick('NEVER')).toEqual([overdue.id, untouched.id]);
    expect(pick('all')).toHaveLength(4);
  });

  it('filters by the responsible employee; "" = جميع الموظفين', () => {
    const salem = supervSubject({});
    const fahad = supervSubject({
      responsible: { userId: 'u-employee-2', name: 'فهد' },
    });
    expect(supervisionMatchesEmployee(salem, '')).toBe(true);
    expect(supervisionMatchesEmployee(salem, 'u-employee-1')).toBe(true);
    expect(supervisionMatchesEmployee(salem, 'u-employee-2')).toBe(false);
    // «جميع الموظفين» first, then the derived ACTUAL employees, name order
    // (Arabic collation: س precedes ف).
    const options = employeeFilterOptions([salem, fahad, salem]);
    expect(options).toEqual([
      { userId: 'u-employee-1', name: 'سالم الموظف' },
      { userId: 'u-employee-2', name: 'فهد' },
    ]);
  });

  it('searches by the EMPLOYEE name too, besides person/phone/property', () => {
    const row = supervSubject({});
    expect(supervisionHaystack(row)).toContain('سالم الموظف');
    expect(filterSupervision([row], 'all', '', 'سالم')).toHaveLength(1);
    expect(filterSupervision([row], 'all', '', 'أحمد')).toHaveLength(1);
    expect(filterSupervision([row], 'all', '', 'A-000012')).toHaveLength(1);
    expect(filterSupervision([row], 'all', '', '66001001')).toHaveLength(1);
    expect(filterSupervision([row], 'all', '', 'لا يوجد')).toHaveLength(0);
    // Status + employee + search compose.
    expect(
      filterSupervision([row], 'OVERDUE', 'u-employee-1', 'سالم'),
    ).toHaveLength(0);
  });

  it('groups by person like the employee board, keeping each subject employee', () => {
    const first = supervSubject({
      person: {
        type: 'CONTACT',
        id: 'c1',
        name: 'أحمد محمد',
        phone: '66001001',
      },
    });
    const second = supervSubject({
      id: 's-1',
      person: {
        type: 'CONTACT',
        id: 'c1',
        name: 'أحمد محمد',
        phone: '66001001',
      },
      kind: 'CLIENT_REQUEST',
      requestType: 'BUYER',
      tabs: ['buyers'],
      label: 'طلب شراء — أحمد محمد',
      propertyId: null,
      propertyReference: null,
      clientId: 'cl1',
      responsible: { userId: 'u-employee-2', name: 'فهد' },
      dueAt: '2026-10-18T09:00:00.000Z',
    });
    const groups = groupSupervision([first, second]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.subjects.map((s) => s.responsible.name)).toEqual([
      'سالم الموظف',
      'فهد',
    ]);
    // Most overdue first, pinned to the person's earliest due subject.
    expect(groups[0]?.nextDueAt).toBe(second.dueAt);
  });

  it('formats the Arabic overdue duration (single/dual/plural)', () => {
    const now = new Date('2026-10-24T12:00:00.000Z');
    expect(overdueDurationLabel('2026-10-24T09:00:00.000Z', now)).toBe(
      '3 ساعات',
    );
    expect(overdueDurationLabel('2026-10-24T11:00:00.000Z', now)).toBe('ساعة');
    expect(overdueDurationLabel('2026-10-24T10:00:00.000Z', now)).toBe(
      'ساعتين',
    );
    expect(overdueDurationLabel('2026-10-23T12:00:00.000Z', now)).toBe('يوم');
    expect(overdueDurationLabel('2026-10-22T12:00:00.000Z', now)).toBe('يومين');
    expect(overdueDurationLabel('2026-10-21T12:00:00.000Z', now)).toBe(
      '3 أيام',
    );
    expect(overdueDurationLabel('not-a-date', now)).toBe('');
  });

  it('allows the manual reminder ONLY for actually overdue subjects', () => {
    expect(reminderAllowed(supervSubject({ bucket: 'OVERDUE' }))).toBe(true);
    expect(reminderAllowed(supervSubject({ bucket: 'TODAY' }))).toBe(false);
    expect(reminderAllowed(supervSubject({ bucket: 'UPCOMING' }))).toBe(false);
  });

  it('renders each subject due line from its OWN server bucket', () => {
    const iso = '2026-10-24T09:00:00.000Z';
    expect(subjectDueLine(subject({ bucket: 'UPCOMING', dueAt: iso }))).toBe(
      `المتابعة القادمة: ${displayDate(iso)}`,
    );
    expect(subjectDueLine(subject({ bucket: 'TODAY', dueAt: iso }))).toBe(
      `المتابعة اليوم: ${displayDate(iso)}`,
    );
    expect(subjectDueLine(subject({ bucket: 'OVERDUE', dueAt: iso }))).toBe(
      `المتابعة المتأخرة: ${displayDate(iso)}`,
    );
  });

  it('labels the saved-entry counts of ONE subject only', () => {
    expect(entryCountLabel(0)).toBe('0 متابعات');
    expect(entryCountLabel(1)).toBe('متابعة واحدة');
    expect(entryCountLabel(2)).toBe('متابعتان');
    expect(entryCountLabel(3)).toBe('3 متابعات');
    expect(entryCountLabel(11)).toBe('11 متابعة');
  });

  it('labels person subject counts', () => {
    expect(subjectCountLabel(1)).toBe('موضوع متابعة واحد');
    expect(subjectCountLabel(2)).toBe('موضوعا متابعة');
    expect(subjectCountLabel(3)).toBe('3 مواضيع متابعة');
    expect(subjectCountLabel(11)).toBe('11 موضوع متابعة');
  });

  it('focuses a person group on EXACTLY the clicked subject (per-subject drawer)', () => {
    const a = subject({
      person: { type: 'CONTACT', id: 'p', name: 'موستو', phone: '3344' },
    });
    const b = subject({
      person: { type: 'CONTACT', id: 'p', name: 'موستو', phone: '3344' },
    });
    const group = groupByPerson([a, b])[0]!;
    // Row click → the drawer sees ONLY that subject.
    const focused = focusPersonGroup(group, a.id);
    expect(focused.subjects.map((row) => row.id)).toEqual([a.id]);
    expect(focused.name).toBe(group.name);
    expect(focused.key).toBe(group.key);
    // Another subject, fresh selection.
    expect(focusPersonGroup(group, b.id).subjects.map((r) => r.id)).toEqual([
      b.id,
    ]);
    // An unknown/deleted id safely degrades to the WHOLE person.
    const fallback = focusPersonGroup(group, 'not-in-feed');
    expect(fallback.subjects.map((row) => row.id)).toEqual([a.id, b.id]);
    // A deep link with no subject id keeps the whole group.
    expect(focusPersonGroup(group, null).subjects.length).toBe(2);
  });

  const CATEGORY_IDS = [
    'properties',
    'buyers',
    'renters',
    'inquiries',
    'exchanges',
    'clients',
  ] as const;

  it('returns every category while only real records carry items', () => {
    const a = subject({ propertyId: 'P-1', propertyReference: 'A-000001' });
    const b = subject({ propertyId: 'P-2', propertyReference: 'A-000004' });
    const categories = personAssociations([a, b]);
    expect(categories.map((row) => row.id)).toEqual(CATEGORY_IDS);
    const properties = categories.find((row) => row.id === 'properties');
    expect(properties?.label).toBe('العقارات');
    expect(properties?.items).toHaveLength(2);
    expect(associationTotal(categories)).toBe(2);
  });

  it('places a lone buyer subject in the purchase-request category', () => {
    const categories = personAssociations([
      subject({
        kind: 'CLIENT_REQUEST',
        requestType: 'BUYER',
        clientId: 'c-9',
        propertyId: null,
        propertyReference: null,
        label: 'طلب شراء — أحمد',
      }),
    ]);
    expect(categories.map((row) => row.id)).toEqual(CATEGORY_IDS);
    const buyers = categories.find((row) => row.id === 'buyers');
    expect(buyers?.items[0]?.label).toBe('طلب شراء — أحمد');
    expect(buyers?.items[0]?.subjectId).toBeTruthy();
  });

  it('counts properties ONCE across an owner subject and inquiries on it', () => {
    const categories = personAssociations([
      subject({ propertyId: 'P-1', propertyReference: 'A-000001' }),
      subject({
        kind: 'INQUIRY',
        propertyId: 'P-1',
        propertyReference: 'A-000001',
        clientId: 'c-7',
        label: 'استفسار عن العقار A-000001',
      }),
      subject({
        kind: 'INQUIRY',
        propertyId: 'P-1',
        propertyReference: 'A-000001',
        clientId: 'c-7',
        label: 'استفسار عن العقار A-000001 (ثانية)',
      }),
    ]);
    expect(categories.map((row) => row.id)).toEqual(CATEGORY_IDS);
    // The PROPERTY is ONE record; the inquiries are TWO distinct records.
    expect(
      categories.find((row) => row.id === 'properties')?.items.length,
    ).toBe(1);
    expect(
      categories.find((row) => row.id === 'inquiries')?.items.length,
    ).toBe(2);
    expect(associationTotal(categories)).toBe(3);
  });

  it('keeps empty categories present without inventing records', () => {
    const categoryIds = personAssociations([
      subject({
        kind: 'CLIENT_REQUEST',
        requestType: 'BUYER',
        clientId: 'c-9',
        propertyId: null,
        propertyReference: null,
        label: 'طلب شراء — أحمد',
      }),
    ]).map((row) => row.id);
    expect(categoryIds).toEqual(CATEGORY_IDS);
    expect(
      personAssociations([
        subject({
          kind: 'CLIENT_REQUEST',
          requestType: 'BUYER',
          clientId: 'c-9',
          propertyId: null,
          propertyReference: null,
          label: 'طلب شراء — أحمد',
        }),
      ]).find((row) => row.id === 'buyers')?.items,
    ).toHaveLength(1);
    // The client identity is ALREADY represented by its BUYER request — a
    // legacy CLIENT subject for it must NOT count the client again.
    const withLegacy = personAssociations([
      subject({
        kind: 'CLIENT_REQUEST',
        requestType: 'BUYER',
        clientId: 'c-9',
        propertyId: null,
        propertyReference: null,
        label: 'طلب شراء — أحمد',
      }),
      subject({
        kind: 'CLIENT',
        clientId: 'c-9',
        propertyId: null,
        propertyReference: null,
        label: 'متابعة عميل أحمد',
      }),
    ]);
    expect(withLegacy.map((row) => row.id)).toEqual(CATEGORY_IDS);
    expect(
      withLegacy.find((row) => row.id === 'clients')?.items,
    ).toEqual([]);
  });

  it('keeps legacy-only subjects reachable without double counting', () => {
    const categories = personAssociations([
      subject({
        kind: 'CLIENT',
        clientId: 'c-33',
        propertyId: null,
        propertyReference: null,
        label: 'متابعة عميل ماجد',
      }),
    ]);
    expect(categories.map((row) => row.id)).toEqual(CATEGORY_IDS);
    const clients = categories.find((row) => row.id === 'clients');
    expect(clients?.label).toBe('متابعات العملاء');
    expect(clients?.items).toHaveLength(1);
    expect(associationTotal(categories)).toBe(1);
  });

  it('returns all categories with real zeros when nothing is countable', () => {
    // A legacy subject with NO reliable record identity (no client id): no
    // invented associations — every category stays empty.
    const categories = personAssociations([
      subject({
        kind: 'CLIENT',
        clientId: null,
        propertyId: null,
        propertyReference: null,
      }),
    ]);
    expect(categories.map((row) => row.id)).toEqual(CATEGORY_IDS);
    expect(categories.every((row) => row.items.length === 0)).toBe(true);
    expect(associationTotal(categories)).toBe(0);
  });

  it('labels the associations chip counts', () => {
    expect(associationCountLabel(1)).toBe('ارتباط واحد');
    expect(associationCountLabel(2)).toBe('ارتباطان');
    expect(associationCountLabel(7)).toBe('7 ارتباطات');
    expect(associationCountLabel(11)).toBe('11 ارتباط');
  });

  it('identifies the current-subject header identity per subject kind', () => {
    expect(
      currentSubjectIdentity(
        subject({
          propertyReference: 'A-000004',
          label: 'مالك العقار A-000004',
        }),
      ),
    ).toBe('مالك العقار A-000004');
    expect(
      currentSubjectIdentity(
        subject({
          kind: 'CLIENT_REQUEST',
          requestType: 'BUYER',
          clientId: 'c-9',
          propertyId: null,
          propertyReference: null,
          person: { type: 'CLIENT', id: 'c-9', name: 'أحمد', phone: '66' },
        }),
      ),
    ).toBe('طلب شراء');
    expect(
      currentSubjectIdentity(
        subject({
          kind: 'INQUIRY',
          propertyReference: 'A-000005',
          propertyId: null,
          label: 'استفسار عن العقار A-000005',
        }),
      ),
    ).toBe('استفسار عن العقار A-000005');
    expect(
      currentSubjectIdentity(
        subject({
          kind: 'INQUIRY',
          propertyReference: null,
          propertyId: null,
          label: '',
        }),
      ),
    ).toBe('استفسار عن عقار');
  });
});
