import {
  MANAGER_CLIENT_BROKER_QUERY_PARAM,
  MANAGER_CLIENT_CLIENT_QUERY_PARAM,
  MANAGER_CLIENT_OWNER_QUERY_PARAM,
  notificationRoute,
} from '../../frontend/features/notifications/notification-target';
import type { NotificationDto } from '../../frontend/lib/api/notification-types';

/**
 * Pure unit tests for the bell's deep-link routing behind the centralized
 * employee-activity notifications — no React runner is installed, so these
 * exercise the real decision module directly. The route is derived ONLY from
 * the authorized references the API echoed back; an employee receiving a
 * record-activity row (impossible by design) must get NO route at all.
 */

function item(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: 'n-1',
    type: 'CLIENT_CREATED',
    title: 'عميل جديد',
    message: 'موظف — أنشأ عميلًا جديدًا',
    propertyId: null,
    propertyReference: null,
    clientId: null,
    contactId: null,
    contactType: null,
    followUpId: null,
    read: false,
    readAt: null,
    createdAt: '2026-10-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('notificationRoute — deep links', () => {
  it('keeps the property deep-link contract for both roles', () => {
    const propertyId = '11111111-1111-4111-8111-111111111111';
    expect(
      notificationRoute({ ...item({ propertyId }) }, 'MANAGER'),
    ).toEqual({
      path: `/manager/properties?property=${propertyId}`,
    });
    expect(notificationRoute({ ...item({ propertyId }) }, 'EMPLOYEE')).toEqual({
      path: `/employee/properties?property=${propertyId}`,
    });
  });

  it('routes client, interest and follow-up activity to the exact client drawer', () => {
    const clientId = '22222222-2222-4222-8222-222222222222';
    for (const type of [
      'CLIENT_CREATED',
      'CLIENT_UPDATED',
      'CLIENT_INTEREST_UPDATED',
      'FOLLOWUP_CREATED',
    ] as const) {
      expect(notificationRoute({ ...item({ type, clientId }) }, 'MANAGER'))
        .toEqual({
          path: `/manager/clients?${MANAGER_CLIENT_CLIENT_QUERY_PARAM}=${clientId}`,
        });
    }
  });

  it('routes owner and broker cards to the right manager tab', () => {
    const contactId = '33333333-3333-4333-8333-333333333333';
    expect(
      notificationRoute(
        { ...item({ type: 'CONTACT_CREATED', contactId, contactType: 'OWNER' }) },
        'MANAGER',
      ),
    ).toEqual({
      path: `/manager/clients?${MANAGER_CLIENT_OWNER_QUERY_PARAM}=${contactId}`,
    });
    expect(
      notificationRoute(
        { ...item({ type: 'CONTACT_UPDATED', contactId, contactType: 'BROKER' }) },
        'MANAGER',
      ),
    ).toEqual({
      path: `/manager/clients?${MANAGER_CLIENT_BROKER_QUERY_PARAM}=${contactId}`,
    });
  });

  it('never routes a record-activity row for an employee and never invents access', () => {
    const clientId = '44444444-4444-4444-8444-444444444444';
    expect(
      notificationRoute({ ...item({ clientId }) }, 'EMPLOYEE'),
    ).toBeNull();
    // A manager row without any authorized reference stays unusable, too.
    expect(notificationRoute(item(), 'MANAGER')).toBeNull();
    // A contact row with an unknown card kind has no tab to land on.
    expect(
      notificationRoute(
        { ...item({ contactId: '55555555-5555-4555-8555-555555555555', contactType: null }) },
        'MANAGER',
      ),
    ).toBeNull();
  });
});
