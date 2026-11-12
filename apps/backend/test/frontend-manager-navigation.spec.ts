import {
  OWNER_ONLY_NAV_IDS,
  visibleManagerMoreNavigation,
} from '../../frontend/components/layout/manager/navigation-permissions';

const items = [
  { id: 'employees' },
  { id: 'finance' },
  { id: 'trash' },
  { id: 'reports' },
];

describe('Manager navigation permissions', () => {
  it('never shows Trash or Finance to MANAGER', () => {
    for (const role of ['MANAGER', undefined]) {
      const visible = visibleManagerMoreNavigation(role, items);
      expect(visible.some((item) => item.id === 'trash')).toBe(false);
      expect(visible.some((item) => item.id === 'finance')).toBe(false);
      expect(visible.some((item) => item.id === 'reports')).toBe(true);
    }
  });

  it('keeps the Trash surface for OWNER', () => {
    const visible = visibleManagerMoreNavigation('OWNER', items);
    expect(visible.map((item) => item.id)).toEqual(items.map((item) => item.id));
    expect(OWNER_ONLY_NAV_IDS).toContain('trash');
  });
});
