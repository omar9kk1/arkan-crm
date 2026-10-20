import { ownerFromRegistryContact } from '../../frontend/features/manager-clients/client-model';
import {
  consumeOpenProperty,
  peekOpenPropertyRequest,
  requestOpenProperty,
} from '../../frontend/features/notifications/open-property';
import type { RegistryContact } from '../../frontend/lib/contact-registry';

/**
 * Pure unit tests for the owner details drawer behind the "responsible employee"
 * and "clickable linked property" work — no React runner is installed, so these
 * exercise the real mapping and the real deep-link store directly.
 */

function registryContact(
  overrides: Partial<RegistryContact> = {},
): RegistryContact {
  return {
    id: 'contact-1',
    type: 'OWNER',
    name: 'Owner Person',
    phone: '66660000',
    scope: 'EMPLOYEE',
    ownerUserId: 'user-1',
    ownerName: 'mohamed',
    propertyIds: ['prop-1', 'prop-2'],
    propertyCodes: ['AK-1', 'AK-2'],
    dealTypes: ['SALE', 'RENT'],
    notes: '',
    createdAt: '2026-10-20',
    ...overrides,
  };
}

describe('ownerFromRegistryContact — responsible employee', () => {
  it('shows the real responsible employee name as a single follower entry', () => {
    const owner = ownerFromRegistryContact(registryContact());
    expect(owner.employee).toBe('mohamed');
    expect(owner.employees).toHaveLength(1);
    expect(owner.employees[0]?.name).toBe('mohamed');
    expect(owner.employees[0]?.id).toBe('user-1');
  });

  it('never invents followers when no employee is assigned', () => {
    const owner = ownerFromRegistryContact(
      registryContact({ ownerName: '', ownerUserId: '', scope: 'COMPANY' }),
    );
    expect(owner.employee).toBe('غير مُسند');
    expect(owner.employees).toEqual([]);
  });

  it('never uses the owner name as the responsible employee name', () => {
    const owner = ownerFromRegistryContact(
      registryContact({
        name: 'Owner Person',
        ownerName: '',
        ownerUserId: '',
        scope: 'COMPANY',
      }),
    );
    expect(owner.employee).not.toBe('Owner Person');
    expect(owner.employees).toEqual([]);
  });

  it('reflects a renamed employee after refetch (no caching in the mapping)', () => {
    const renamed = ownerFromRegistryContact(
      registryContact({ ownerName: 'mohamed updated' }),
    );
    expect(renamed.employee).toBe('mohamed updated');
    expect(renamed.employees[0]?.name).toBe('mohamed updated');
  });
});

describe('ownerFromRegistryContact — linked properties carry stable ids', () => {
  it('pairs each property with its stable Property.id', () => {
    const owner = ownerFromRegistryContact(registryContact());
    expect(owner.properties.map((p) => p.id)).toEqual(['prop-1', 'prop-2']);
    expect(owner.properties.map((p) => p.code)).toEqual(['AK-1', 'AK-2']);
  });

  it('falls back to an empty id (never the code) when no id is available', () => {
    const owner = ownerFromRegistryContact(
      registryContact({ propertyIds: [], propertyCodes: ['AK-9'] }),
    );
    expect(owner.properties[0]?.id).toBe('');
    expect(owner.properties[0]?.id).not.toBe('AK-9');
  });

  it('keeps a 1:1 parallel mapping between codes and stable ids', () => {
    const owner = ownerFromRegistryContact(
      registryContact({
        propertyIds: ['prop-1', 'prop-2', 'prop-3'],
        propertyCodes: ['AK-1', 'AK-2', 'AK-3'],
      }),
    );
    expect(owner.properties.map((p) => p.code)).toEqual([
      'AK-1',
      'AK-2',
      'AK-3',
    ]);
    expect(owner.properties.map((p) => p.id)).toEqual([
      'prop-1',
      'prop-2',
      'prop-3',
    ]);
  });
});

/**
 * The deep link is what makes a linked-property card open the EXISTING drawer.
 * These tests read the store's real snapshot through `peekOpenPropertyRequest`
 * (the same state the `useOpenPropertyRequest` hook renders) — no React runner
 * is needed, and the mapping tests above cover the id plumbing.
 */
describe('open-property deep link channel (used by the owner drawer)', () => {
  afterEach(() => {
    // Leave no pending request behind for other tests.
    const pending = peekOpenPropertyRequest();
    if (pending) consumeOpenProperty(pending.propertyId);
  });

  it('publishes the exact stable property id', () => {
    requestOpenProperty('prop-42');
    expect(peekOpenPropertyRequest()?.propertyId).toBe('prop-42');
  });

  it('does NOT clear a pending request when a different id is consumed', () => {
    requestOpenProperty('prop-42');
    consumeOpenProperty('prop-other');
    expect(peekOpenPropertyRequest()?.propertyId).toBe('prop-42');
    consumeOpenProperty('prop-42');
    expect(peekOpenPropertyRequest()).toBeNull();
  });

  it('bumps the nonce so a repeated click still notifies subscribers', () => {
    requestOpenProperty('prop-1');
    const first = peekOpenPropertyRequest()?.nonce ?? 0;
    requestOpenProperty('prop-1');
    const second = peekOpenPropertyRequest()?.nonce ?? 0;
    expect(second).toBeGreaterThan(first);
    expect(peekOpenPropertyRequest()?.propertyId).toBe('prop-1');
  });

  it('carries a Property.id (uuid), never a code or an array index', () => {
    const uuid = '11111111-2222-3333-4444-555555555555';
    requestOpenProperty(uuid);
    const pending = peekOpenPropertyRequest();
    expect(pending?.propertyId).toBe(uuid);
    expect(pending?.propertyId).not.toBe('AK-1');
    expect(pending?.propertyId).not.toBe('0');
  });
});
