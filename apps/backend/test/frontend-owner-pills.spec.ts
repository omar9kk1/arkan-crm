import {
  OWNER_TYPE_LABEL,
  ownerTypePills,
  toRegistryContact,
} from '../../frontend/lib/contact-registry';
import { ownerFromRegistryContact } from '../../frontend/features/manager-clients/client-model';
import type { ContactDto, DealType } from '../../frontend/lib/api/property-types';

/**
 * Pure unit tests for the owner-card transaction-type pills. No React runner is
 * installed, so the grouping logic that turns the authorized backend rows into
 * "2 بايع / 1 مؤجّر" pills is exercised directly.
 */

function link(id: string, listingType: DealType) {
  return { id, reference: `K-${id}`, listingType };
}

describe('ownerTypePills — grouped counts', () => {
  it('one pill per type, in the stable SALE/RENT/EXCHANGE order', () => {
    const pills = ownerTypePills([
      link('p1', 'SALE'),
      link('p2', 'SALE'),
      link('p3', 'RENT'),
      link('p4', 'EXCHANGE'),
    ]);
    expect(pills).toHaveLength(3);
    expect(pills.map((pill) => pill.type)).toEqual(['SALE', 'RENT', 'EXCHANGE']);
    expect(pills.map((pill) => pill.count)).toEqual([2, 1, 1]);
    expect(pills.map((pill) => pill.label)).toEqual([
      OWNER_TYPE_LABEL.SALE,
      OWNER_TYPE_LABEL.RENT,
      OWNER_TYPE_LABEL.EXCHANGE,
    ]);
  });

  it('hides types with zero counts', () => {
    const pills = ownerTypePills([link('p1', 'RENT')]);
    expect(pills).toHaveLength(1);
    expect(pills[0]).toEqual({ type: 'RENT', label: 'مؤجّر', count: 1 });
  });

  it('produces no pills for an owner with no linked properties', () => {
    expect(ownerTypePills([])).toEqual([]);
  });

  it('counts DISTINCT properties: a repeated id is never counted twice', () => {
    const pills = ownerTypePills([
      link('p1', 'SALE'),
      link('p1', 'SALE'), // duplicate of the same property row
      link('p2', 'SALE'),
    ]);
    expect(pills).toEqual([{ type: 'SALE', label: 'بايع', count: 2 }]);
  });

  it('skips a row that somehow carries no type instead of inventing a count', () => {
    const pills = ownerTypePills([
      link('p1', 'SALE'),
      // The real contract always sends listingType; a defensive skip keeps the
      // counts honest rather than guessing a type for the unclassified row.
      { id: 'p2', reference: 'K-p2', listingType: undefined as unknown as DealType },
    ]);
    expect(pills).toEqual([{ type: 'SALE', label: 'بايع', count: 1 }]);
  });

  it('the pill counts always sum to the classified linked rows', () => {
    const rows = [
      link('p1', 'SALE'),
      link('p2', 'RENT'),
      link('p3', 'RENT'),
      link('p4', 'EXCHANGE'),
      link('p5', 'SALE'),
      link('p6', 'SALE'),
      link('p7', 'EXCHANGE'),
    ];
    const sum = ownerTypePills(rows).reduce((acc, pill) => acc + pill.count, 0);
    // `listingType` is required on every Property row, so all rows classify
    // and the sum equals the existing accessible linked-property count.
    expect(sum).toBe(rows.length);
  });
});

describe('toRegistryContact — dealTypes travel with the link rows', () => {
  function contactDto(overrides: Partial<ContactDto> = {}): ContactDto {
    return {
      id: 'contact-1',
      type: 'OWNER',
      name: 'Owner Person',
      phone: '66660000',
      notes: null,
      responsibleUserId: 'user-1',
      responsibleEmployeeName: 'mohamed',
      properties: [link('prop-1', 'SALE'), link('prop-2', 'RENT')],
      createdAt: '2026-10-20T00:00:00.000Z',
      updatedAt: '2026-10-20T00:00:00.000Z',
      ...overrides,
    };
  }

  it('maps the backend listingTypes index-parallel to the linked properties', () => {
    const registry = toRegistryContact(contactDto());
    expect(registry.dealTypes).toEqual(['SALE', 'RENT']);
    expect(registry.propertyIds).toEqual(['prop-1', 'prop-2']);
    expect(registry.dealTypes).toHaveLength(registry.propertyIds.length);
  });

  it('keeps the counts empty when the authorized response carries no rows', () => {
    const registry = toRegistryContact(
      contactDto({
        responsibleUserId: null,
        responsibleEmployeeName: null,
        properties: [],
      }),
    );
    expect(registry.dealTypes).toEqual([]);
  });
});

describe('ownerFromRegistryContact — pills reach the owner card', () => {
  function registryContact(
    overrides: Partial<
      Parameters<typeof ownerFromRegistryContact>[0]
    > = {},
  ) {
    return {
      id: 'contact-1',
      type: 'OWNER' as const,
      name: 'Owner Person',
      phone: '66660000',
      scope: 'EMPLOYEE' as const,
      ownerUserId: 'user-1',
      ownerName: 'mohamed',
      propertyIds: ['p1', 'p2', 'p3'],
      propertyCodes: ['K1', 'K2', 'K3'],
      dealTypes: ['SALE', 'SALE', 'RENT'] as DealType[],
      notes: '',
      createdAt: '2026-10-20',
      ...overrides,
    };
  }

  it('carries the grouped pills on the owner view model', () => {
    const owner = ownerFromRegistryContact(registryContact());
    expect(owner.typePills.map((pill) => `${pill.count} ${pill.label}`)).toEqual([
      '2 بايع',
      '1 مؤجّر',
    ]);
  });

  it('carries no pills when the owner has no linked properties', () => {
    const owner = ownerFromRegistryContact(
      registryContact({ propertyIds: [], propertyCodes: [], dealTypes: [] }),
    );
    expect(owner.typePills).toEqual([]);
  });
});
