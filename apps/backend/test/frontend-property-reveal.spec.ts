import {
  PROPERTY_QUERY_PARAM,
  employeeTabForRow,
  managerTabForStatus,
  readPropertyParam,
  withRevealedRow,
} from '../../frontend/lib/property-reveal';
import { matchesTab, tabs, type Property } from '../../frontend/features/employee-properties/model';
import type { PreviewProperty } from '../../frontend/features/manager-properties/preview-data';

/**
 * Pure unit tests for the deep-link target decisions behind "open the EXACT
 * property card". No React runner is installed, so the URL parsing, the tab
 * choice and the row merge — the logic that actually decides WHICH card is
 * highlighted and WHICH tab shows it — are exercised directly, reusing the
 * employee pages' real `matchesTab` rule so the reveal can never disagree with
 * the panel filter.
 */

const UUID = '5f2a1b3c-4d5e-6f70-8a9b-0c1d2e3f4a5b';

describe('readPropertyParam', () => {
  const read = (raw: string | null) =>
    readPropertyParam(
      raw === null ? null : { get: (name: string) => (name === PROPERTY_QUERY_PARAM ? raw : null) },
    );

  it('accepts a well-formed UUID from the ?property= parameter', () => {
    expect(read(UUID)).toBe(UUID);
  });

  it('returns null when the parameter is missing entirely', () => {
    expect(read(null as string | null)).toBeNull();
    expect(readPropertyParam(null)).toBeNull();
  });

  it('rejects a property code so the target is never resolved by code', () => {
    expect(read('K0331')).toBeNull();
  });

  it('rejects an array index so the target is never resolved by position', () => {
    expect(read('0')).toBeNull();
    expect(read('3')).toBeNull();
  });

  it('rejects free text (an owner name can never select a target)', () => {
    expect(read('owner mohamed')).toBeNull();
  });

  it('rejects uuids malformed beyond a safe trim', () => {
    expect(read('  ')).toBeNull();
    expect(read(`${UUID};drop`)).toBeNull();
  });
});

describe('managerTabForStatus', () => {
  it('sends an AVAILABLE target to the approved program tab', () => {
    expect(managerTabForStatus('AVAILABLE')).toBe('program');
  });

  it('sends PENDING and REJECTED targets to the review tab', () => {
    expect(managerTabForStatus('PENDING')).toBe('approval');
    expect(managerTabForStatus('REJECTED')).toBe('approval');
  });

  it('returns null for a status the manager surface does not list', () => {
    expect(managerTabForStatus(undefined)).toBeNull();
    expect(managerTabForStatus('ARCHIVED')).toBeNull();
  });
});

function employeeRow(overrides: Partial<Property>): Property {
  return {
    ...({} as Property),
    apiStatus: 'AVAILABLE',
    mine: false,
    reviewStatus: null,
    ...overrides,
  };
}

describe('employeeTabForRow (uses the page real matchesTab rule)', () => {
  const ordered = tabs.map((t) => t.id);
  const matches = (row: unknown, tab: string) => matchesTab(row as Property, tab);

  it('shows an approved target on the broad inventory tab', () => {
    expect(
      employeeTabForRow(employeeRow({ apiStatus: 'AVAILABLE' }), matches, ordered),
    ).toBe('all');
  });

  it('shows own pending work on the review tab, never on the inventory tab', () => {
    const row = employeeRow({ apiStatus: 'PENDING', mine: true });
    const chosen = employeeTabForRow(row, matches, ordered);
    expect(chosen).toBe('review');
    expect(matchesTab(row, 'all')).toBe(false);
  });

  it('shows a rejected target on the review tab', () => {
    expect(
      employeeTabForRow(
        employeeRow({ apiStatus: 'REJECTED', mine: true }),
        matches,
        ordered,
      ),
    ).toBe('review');
  });

  it('returns null when no tab can show an unauthorized row', () => {
    expect(
      employeeTabForRow(
        employeeRow({ apiStatus: 'PENDING', mine: false }),
        matches,
        ordered,
      ),
    ).toBeNull();
  });
});

describe('withRevealedRow', () => {
  const preview = (id: string): PreviewProperty => ({
    id,
    code: `K-${id}`,
    title: `t-${id}`,
    region: 'غرناطة',
    price: '100000',
    area: 400,
    rooms: '5',
    status: 'معتمد',
    owner: 'أبو فهد',
    description: '',
    employees: [],
  });

  it('appends the real resolved row when it is outside the loaded window', () => {
    const items = [preview('a'), preview('b')];
    const merged = withRevealedRow(items, preview(UUID));
    expect(merged).toHaveLength(3);
    expect(merged[merged.length - 1]?.id).toBe(UUID);
    // The loaded rows are never mutated.
    expect(items).toHaveLength(2);
  });

  it('never duplicates a row the window already contains', () => {
    const items = [preview('a'), preview(UUID)];
    const merged = withRevealedRow<PreviewProperty>(items, preview(UUID));
    expect(merged).toHaveLength(2);
    expect(merged.filter((p) => p.id === UUID)).toHaveLength(1);
  });

  it('passes rows through untouched when no target is active', () => {
    const items = [preview('a')];
    expect(withRevealedRow(items, null)).toEqual(items);
    expect(withRevealedRow(items, null)).not.toBe(items);
  });
});
