import {
  CLIENT_REVIEW_QUERY_PARAM,
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
    eventKey: null,
    clientReviewId: null,
    followUpSubjectId: null,
    read: false,
    readAt: null,
    createdAt: '2026-10-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('notificationRoute — deep links', () => {
  it('keeps the property deep-link contract for both roles', () => {
    const propertyId = '11111111-1111-4111-8111-111111111111';
    expect(notificationRoute({ ...item({ propertyId }) }, 'MANAGER')).toEqual({
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
      expect(
        notificationRoute({ ...item({ type, clientId }) }, 'MANAGER'),
      ).toEqual({
        path: `/manager/clients?${MANAGER_CLIENT_CLIENT_QUERY_PARAM}=${clientId}`,
      });
    }
  });

  it('routes owner and broker cards to the right manager tab', () => {
    const contactId = '33333333-3333-4333-8333-333333333333';
    expect(
      notificationRoute(
        {
          ...item({ type: 'CONTACT_CREATED', contactId, contactType: 'OWNER' }),
        },
        'MANAGER',
      ),
    ).toEqual({
      path: `/manager/clients?${MANAGER_CLIENT_OWNER_QUERY_PARAM}=${contactId}`,
    });
    expect(
      notificationRoute(
        {
          ...item({
            type: 'CONTACT_UPDATED',
            contactId,
            contactType: 'BROKER',
          }),
        },
        'MANAGER',
      ),
    ).toEqual({
      path: `/manager/clients?${MANAGER_CLIENT_BROKER_QUERY_PARAM}=${contactId}`,
    });
  });

  it('routes client-review rows to the shared «تحت المراجعة» tab for BOTH roles', () => {
    const reviewId = '66666666-6666-4666-8666-666666666666';
    // A review row carries NO record id: the tab is the only authorized
    // landing point, and it is authorized by the row's recipient alone.
    expect(
      notificationRoute(
        {
          ...item({
            type: 'CLIENT_REVIEW_SUBMITTED',
            clientReviewId: reviewId,
          }),
        },
        'MANAGER',
      ),
    ).toEqual({
      path: `/manager/clients?${CLIENT_REVIEW_QUERY_PARAM}=${reviewId}`,
    });
    expect(
      notificationRoute(
        {
          ...item({ type: 'CLIENT_REVIEW_APPROVED', clientReviewId: reviewId }),
        },
        'EMPLOYEE',
      ),
    ).toEqual({
      path: `/employee/clients?${CLIENT_REVIEW_QUERY_PARAM}=${reviewId}`,
    });
  });

  it('never routes a record-activity row for an employee and never invents access', () => {
    const clientId = '44444444-4444-4444-8444-444444444444';
    expect(notificationRoute({ ...item({ clientId }) }, 'EMPLOYEE')).toBeNull();
    // A manager row without any authorized reference stays unusable, too.
    expect(notificationRoute(item(), 'MANAGER')).toBeNull();
    // A contact row with an unknown card kind has no tab to land on.
    expect(
      notificationRoute(
        {
          ...item({
            contactId: '55555555-5555-4555-8555-555555555555',
            contactType: null,
          }),
        },
        'MANAGER',
      ),
    ).toBeNull();
  });

  it('deep-links a follow-up late warning to the employee follow-ups subject', () => {
    const subjectId = '77777777-7777-4777-8777-777777777777';
    // The late-follow-up row references its property AND its subject: the
    // SUBJECT must win (the employee lands on the exact follow-up panel).
    const row = item({
      type: 'FOLLOWUP_EMPLOYEE_LATE',
      propertyId: '11111111-1111-4111-8111-111111111111',
      followUpSubjectId: subjectId,
    });
    expect(notificationRoute(row, 'EMPLOYEE')).toEqual({
      path: `/employee/followups?follow-up=${subjectId}`,
    });
    // A monitor row WITHOUT a subject id (legacy payload) falls back to the
    // existing authorized properties deep link.
    expect(
      notificationRoute(
        {
          ...item({
            type: 'FOLLOWUP_MANAGER_ESCALATION',
            propertyId: '11111111-1111-4111-8111-111111111111',
          }),
        },
        'MANAGER',
      ),
    ).toEqual({
      path: '/manager/properties?property=11111111-1111-4111-8111-111111111111',
    });
  });

  it('routes a manager follow-up creation to the monitoring section subject', () => {
    const propertyId = '11111111-1111-4111-8111-111111111111';
    const subjectId = '88888888-8888-4888-8888-888888888888';
    // The FOLLOWUP_CREATED row is addressed to the monitoring MANAGER, so the
    // api no longer masks its subject id: the SUBJECT must win over the
    // property reference.
    expect(
      notificationRoute(
        item({
          type: 'FOLLOWUP_CREATED',
          propertyId,
          followUpSubjectId: subjectId,
        }),
        'MANAGER',
      ),
    ).toEqual({
      path: `/manager/followups?follow-up=${subjectId}`,
    });
  });

  it('carries the exact FollowUpEntry in the follow-up deep link when present', () => {
    const subjectId = '88888888-8888-4888-8888-888888888888';
    // The entry id lives in the stored dedup key `FOLLOWUP_CREATED:<entryId>`.
    const entryId = '99999999-9999-4999-9999-999999999999';
    expect(
      notificationRoute(
        item({
          type: 'FOLLOWUP_CREATED',
          followUpSubjectId: subjectId,
          eventKey: `FOLLOWUP_CREATED:${entryId}`,
        }),
        'MANAGER',
      ),
    ).toEqual({
      path: `/manager/followups?follow-up=${subjectId}&follow-up-entry=${entryId}`,
    });
    expect(
      notificationRoute(
        item({
          type: 'FOLLOWUP_EMPLOYEE_LATE',
          followUpSubjectId: subjectId,
          eventKey: `FOLLOWUP_EMPLOYEE_LATE:${subjectId}:2`,
        }),
        'EMPLOYEE',
      ),
    ).toEqual({
      path: `/employee/followups?follow-up=${subjectId}`,
    });
  });
});
