import { toRegistryContact } from '../../frontend/lib/contact-registry';
import { employeeClientFromDto } from '../../frontend/features/employee-clients/client-model';
import type { ContactDto } from '../../frontend/lib/api/property-types';
import type { ClientApiDto } from '../../frontend/lib/api/client-types';

/**
 * Unit tests for the pure display mappings behind the responsible-employee
 * name. They run in the backend Jest project (no React runner is installed) and
 * import the frontend modules directly, so they exercise the real code.
 */

function contactDto(overrides: Partial<ContactDto> = {}): ContactDto {
  return {
    id: 'contact-1',
    type: 'OWNER',
    name: 'Owner Person',
    phone: '66660000',
    notes: null,
    responsibleUserId: 'user-1',
    responsibleEmployeeName: 'Employee A',
    properties: [],
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('toRegistryContact responsible name', () => {
  it('maps the backend responsibleEmployeeName onto ownerName', () => {
    const registry = toRegistryContact(contactDto());
    expect(registry.ownerName).toBe('Employee A');
    expect(registry.ownerUserId).toBe('user-1');
    expect(registry.scope).toBe('EMPLOYEE');
  });

  it('uses an empty ownerName (never a guess) for an unassigned record', () => {
    const registry = toRegistryContact(
      contactDto({ responsibleUserId: null, responsibleEmployeeName: null }),
    );
    expect(registry.ownerName).toBe('');
    expect(registry.scope).toBe('COMPANY');
  });

  it('never substitutes the owner name for the employee name', () => {
    const registry = toRegistryContact(
      contactDto({
        name: 'Owner Person',
        responsibleUserId: null,
        responsibleEmployeeName: null,
      }),
    );
    expect(registry.ownerName).not.toBe('Owner Person');
  });
});

function clientDto(overrides: Partial<ClientApiDto> = {}): ClientApiDto {
  return {
    id: 'client-1',
    name: 'Client Person',
    phone: '65550000',
    notes: '',
    source: '',
    status: '',
    responsibleUserId: 'user-2',
    responsibleEmployeeName: 'Employee B',
    createdByUserId: 'user-2',
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    nextFollowUp: null,
    followUps: [],
    properties: [],
    propertyInterests: [],
    ...overrides,
  };
}

describe('employeeClientFromDto responsible name', () => {
  it('maps the real responsible employee name', () => {
    expect(employeeClientFromDto(clientDto()).employee).toBe('Employee B');
  });

  it('shows "غير مُسند" when no employee is assigned', () => {
    expect(
      employeeClientFromDto(
        clientDto({ responsibleUserId: null, responsibleEmployeeName: null }),
      ).employee,
    ).toBe('غير مُسند');
  });

  it('uses the follow-up employeeName for the timeline entry', () => {
    const mapped = employeeClientFromDto(
      clientDto({
        followUps: [
          {
            id: 'fu-1',
            dueAt: '2026-10-21',
            createdAt: '2026-10-20T10:00:00.000Z',
            method: 'اتصال',
            outcome: 'تم',
            note: '',
            employeeName: 'Employee B',
          },
        ],
      }),
    );
    expect(mapped.history[0]?.employee).toBe('Employee B');
  });

  it('never uses the client name as the responsible name', () => {
    const mapped = employeeClientFromDto(
      clientDto({
        name: 'Client Person',
        responsibleUserId: null,
        responsibleEmployeeName: null,
      }),
    );
    expect(mapped.employee).not.toBe('Client Person');
  });
});

describe('employeeClientFromDto — interest card facts split', () => {
  /**
   * The drawer's interest card draws the property title, its display code,
   * the district, the price, the reason and the notes as SEPARATE lines:
   * the mapping must hand them over as separate fields (never a merged
   * title+reference line that cramps the card text).
   */
  const title = 'عقار بدل - مدينة المطلاع';
  const reference = 'AK-261016-AAB9635B72';
  const [interest] = employeeClientFromDto(
    clientDto({
      propertyInterests: [
        {
          propertyId: 'b7c1e2f3-0000-4000-8000-00000000000a',
          reference,
          title,
          area: 'مدينة المطلاع',
          askingPrice: '400.000',
          currency: 'KWD',
          reason: 'استفسار',
          notes: 'تفاوض على السعر',
          createdAt: '2026-10-20T06:40:00.000Z',
        },
      ],
    }),
  ).propertyInterests;

  it('keeps the property title clean of the reference', () => {
    expect(interest?.name).toBe(title);
    expect(interest?.name).not.toContain(reference);
  });

  it('carries the reference separately for its own line', () => {
    expect(interest?.code).toBe(reference);
  });

  it('keeps district, reason and notes as separate card facts', () => {
    expect(interest?.area).toBe('مدينة المطلاع');
    expect(interest?.reason).toBe('استفسار');
    expect(interest?.notes).toBe('تفاوض على السعر');
    expect(interest?.price).not.toBe('');
  });
});
