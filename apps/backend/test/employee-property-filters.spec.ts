import {
  filterProperties,
  matchesTab,
  type Property,
} from '../../frontend/features/employee-properties/model';

/**
 * Lightweight unit tests for the approved employee property TAB rules.
 *
 * These import the real frontend filter module directly (the same technique the
 * adapter spec uses) and assert the exact visibility rules, so a regression in
 * the filter logic fails here instead of silently mis-filing a row in the
 * browser. No React, no database, no network.
 */

function row(overrides: Partial<Property>): Property {
  return {
    id: 'id',
    code: 'AK-000000-0000000000',
    title: 'عقار',
    owner: '',
    phone: '',
    ownerNotes: '',
    operation: 'بيع',
    region: 'غرناطة',
    address: '',
    area: '400',
    rooms: '5',
    price: '100',
    description: '',
    status: 'معتمد',
    mine: true,
    assignment: '',
    managerNotes: '',
    followers: [],
    ...overrides,
  };
}

const availableOwn = row({
  id: 'available-own',
  apiStatus: 'AVAILABLE',
  mine: true,
  status: 'معتمد',
});
const availableOther = row({
  id: 'available-other',
  apiStatus: 'AVAILABLE',
  mine: false,
  status: 'معتمد',
});
const pendingOwn = row({
  id: 'pending-own',
  apiStatus: 'PENDING',
  reviewStatus: 'PENDING',
  mine: true,
  status: 'بانتظار الموافقة',
});
const changesOwn = row({
  id: 'changes-own',
  apiStatus: 'PENDING',
  reviewStatus: 'CHANGES_REQUESTED',
  mine: true,
  status: 'مطلوب تعديل',
});
const rejectedOwn = row({
  id: 'rejected-own',
  apiStatus: 'REJECTED',
  reviewStatus: 'REJECTED',
  mine: true,
  status: 'مرفوض',
});
const soldOwn = row({
  id: 'sold-own',
  apiStatus: 'SOLD',
  mine: true,
  status: 'تم البيع',
});

const all: Property[] = [
  availableOwn,
  availableOther,
  pendingOwn,
  changesOwn,
  rejectedOwn,
  soldOwn,
];

const ids = (items: Property[]) => items.map((item) => item.id).sort();

describe('employee property tab filters', () => {
  it('shows ONLY AVAILABLE properties under «كل العقارات»', () => {
    expect(ids(filterProperties(all, 'all', ''))).toEqual([
      'available-other',
      'available-own',
    ]);
    // Pending / rejected / changes-requested rows are excluded.
    expect(filterProperties(all, 'all', '').map((p) => p.apiStatus)).toEqual([
      'AVAILABLE',
      'AVAILABLE',
    ]);
  });

  it('shows only the viewer’s own AVAILABLE properties under «عقاراتي»', () => {
    expect(ids(filterProperties(all, 'mine', ''))).toEqual(['available-own']);
    // Another employee's AVAILABLE row must not be "mine".
    expect(ids(filterProperties(all, 'mine', ''))).not.toContain(
      'available-other',
    );
  });

  it('shows every authorized unapproved own row under «تحت المراجعة»', () => {
    // PENDING, PENDING + CHANGES_REQUESTED and REJECTED are all unapproved.
    expect(ids(filterProperties(all, 'review', ''))).toEqual([
      'changes-own',
      'pending-own',
      'rejected-own',
    ]);
    // An approved row never belongs to the review queue.
    expect(ids(filterProperties(all, 'review', ''))).not.toContain(
      'available-own',
    );
    // Nor does another employee's unapproved row (never authorized anyway).
    expect(
      matchesTab(row({ id: 'other-pending', apiStatus: 'PENDING', mine: false }), 'review'),
    ).toBe(false);
  });

  it('shows CHANGES_REQUESTED and REJECTED own rows under «مطلوب تعديل»', () => {
    expect(ids(filterProperties(all, 'changes', ''))).toEqual([
      'changes-own',
      'rejected-own',
    ]);
  });

  it('never files a review item under «كل العقارات» or «عقاراتي»', () => {
    const published = ids(filterProperties(all, 'all', ''));
    const mine = ids(filterProperties(all, 'mine', ''));
    for (const id of ['pending-own', 'changes-own', 'rejected-own']) {
      expect(published).not.toContain(id);
      expect(mine).not.toContain(id);
    }
  });

  it('still applies the search query inside a tab', () => {
    const items = [
      availableOwn,
      row({
        id: 'available-other-2',
        apiStatus: 'AVAILABLE',
        mine: false,
        region: 'الفروانية',
        code: 'AK-999999-FFFFFFFFF0',
        title: 'بيت المطلاع',
      }),
    ];
    const q = filterProperties(items, 'all', 'المطلاع');
    expect(ids(q)).toEqual(['available-other-2']);
    // A non-matching query empties the tab.
    expect(filterProperties(items, 'all', 'لا-يوجد')).toHaveLength(0);
  });

  it('keeps matchesTab and filterProperties in agreement (counts share the rule)', () => {
    for (const tab of ['all', 'mine', 'review', 'changes', 'assigned']) {
      const direct = all.filter((p) => matchesTab(p, tab));
      expect(ids(filterProperties(all, tab, ''))).toEqual(ids(direct));
    }
  });

  it('treats a row without a backend status as not published', () => {
    const legacy = row({ id: 'legacy', mine: true });
    expect(matchesTab(legacy, 'all')).toBe(false);
    expect(matchesTab(legacy, 'mine')).toBe(false);
    expect(matchesTab(legacy, 'review')).toBe(false);
    expect(matchesTab(legacy, 'changes')).toBe(false);
  });
});
