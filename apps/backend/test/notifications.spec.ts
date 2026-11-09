import { randomUUID } from 'node:crypto';
import { Role } from '@arkan/shared';
import request from 'supertest';
import {
  auth,
  createTestApp,
  createUser,
  describeWithDatabase,
  login,
  pngBytes,
  postProperty,
  resetDatabase,
  type TestContext,
} from './support/test-app';

jest.setTimeout(120000);

const image = [{ buffer: pngBytes(), filename: 'photo.png' }];

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  propertyId: string | null;
  clientId: string | null;
  contactId: string | null;
  contactType: string | null;
  followUpId: string | null;
  clientReviewId: string | null;
  followUpSubjectId: string | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

interface CreatedProperty {
  id: string;
  reference: string;
  version: number;
  status: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The persistent in-app notification system, exercised through the REAL Nest
 * application against the ISOLATED test database and the public HTTP contract.
 *
 * They prove the six property events, the recipient sets, the dedup/failure
 * guarantees, the per-recipient inbox isolation and the payload privacy — not
 * mocked calls.
 */
describeWithDatabase('In-app notifications', () => {
  let ctx: TestContext;
  let managerId: string;
  let manager2Id: string;
  let inactiveManagerId: string;
  let employeeAId: string;
  let employeeBId: string;
  let employeeCId: string;
  let managerToken: string;
  let manager2Token: string;
  let employeeAToken: string;
  let employeeBToken: string;
  let employeeCEmail: string;

  const api = () => request(ctx.app.getHttpServer());

  let seq = 0;
  const payload = (overrides: Record<string, unknown> = {}) => ({
    listingType: 'SALE',
    governorate: 'الفروانية',
    district: 'غرناطة',
    block: '3',
    plotNumber: String(900000 + ++seq),
    sizeSqm: '400.00',
    askingPrice: '250000.00',
    negotiable: true,
    description: 'بيت مستقل للبيع',
    floors: [{ type: 'GROUND', details: 'صالة ومجلس' }],
    // A private contact that must NEVER appear in a notification payload.
    newContact: { type: 'BROKER', name: 'وسيط خاص', phone: '66661111' },
    ...overrides,
  });

  /** Creates a property as whoever `token` belongs to. */
  const createProperty = async (
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<CreatedProperty> => {
    const response = await postProperty(ctx.app, token, payload(overrides), image);
    expect(response.status).toBe(201);
    return response.body.data as CreatedProperty;
  };

  const requestChanges = (token: string, id: string, reason = 'يرجى مراجعة السعر') =>
    api()
      .post(`/properties/${id}/request-changes`)
      .set(auth(token))
      .send({ reason });

  const approve = (token: string, id: string, body: Record<string, unknown> = {}) =>
    api().post(`/properties/${id}/approve`).set(auth(token)).send(body);

  const reject = (token: string, id: string, reason = 'بيانات غير مكتملة') =>
    api().post(`/properties/${id}/reject`).set(auth(token)).send({ reason });

  const resubmit = (token: string, id: string) =>
    api().post(`/properties/${id}/resubmit`).set(auth(token));

  /** GET /notifications for a token (limit defaults to the max page size). */
  const inbox = async (token: string): Promise<NotificationItem[]> => {
    const response = await api()
      .get('/notifications?limit=100')
      .set(auth(token));
    expect(response.status).toBe(200);
    return response.body.data.items as NotificationItem[];
  };

  const unreadCount = async (token: string): Promise<number> => {
    const response = await api()
      .get('/notifications/unread-count')
      .set(auth(token));
    expect(response.status).toBe(200);
    return response.body.data.count as number;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'manager@notifications.local',
      name: 'Manager One',
      role: Role.MANAGER,
    });
    const manager2 = await createUser(ctx.prisma, {
      email: 'manager.two@notifications.local',
      name: 'Manager Two',
      // Second management recipient: OWNER receives company-wide events, while
      // the assigned Manager receives only their team's events.
      role: Role.OWNER,
    });
    const inactiveManager = await createUser(ctx.prisma, {
      email: 'manager.off@notifications.local',
      name: 'Manager Off',
      role: Role.MANAGER,
    });
    await ctx.prisma.user.update({
      where: { id: inactiveManager.id },
      data: { isActive: false },
    });
    const employeeA = await createUser(ctx.prisma, {
      email: 'employee.a@notifications.local',
      name: 'Employee A',
      role: Role.EMPLOYEE,
    });
    const employeeB = await createUser(ctx.prisma, {
      email: 'employee.b@notifications.local',
      name: 'Employee B',
      role: Role.EMPLOYEE,
    });
    const employeeC = await createUser(ctx.prisma, {
      email: 'employee.c@notifications.local',
      name: 'Employee C',
      role: Role.EMPLOYEE,
    });
    managerId = manager.id;
    manager2Id = manager2.id;
    inactiveManagerId = inactiveManager.id;
    employeeAId = employeeA.id;
    employeeBId = employeeB.id;
    employeeCId = employeeC.id;
    employeeCEmail = employeeC.email;
    managerToken = await login(ctx.app, manager.email);
    manager2Token = await login(ctx.app, manager2.email);
    employeeAToken = await login(ctx.app, employeeA.email);
    employeeBToken = await login(ctx.app, employeeB.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  // Each test starts from an empty notification table so assertions can be exact.
  beforeEach(async () => {
    await ctx.prisma.notification.deleteMany({});
  });

  // ---------------------------------------------------------------------------
  // Event 1 — employee submission
  // ---------------------------------------------------------------------------
  it('notifies every ACTIVE manager when an employee submits a property, and nobody else', async () => {
    const created = await createProperty(employeeAToken);
    expect(created.status).toBe('PENDING');

    for (const token of [managerToken, manager2Token]) {
      const items = await inbox(token);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: 'PROPERTY_SUBMITTED',
        title: 'عقار جديد بانتظار المراجعة',
        propertyId: created.id,
        read: false,
      });
    }

    // The inactive manager is skipped.
    expect(
      await ctx.prisma.notification.count({ where: { userId: inactiveManagerId } }),
    ).toBe(0);
    // The creator and the other employees are NOT told about their own submission.
    expect(await inbox(employeeAToken)).toHaveLength(0);
    expect(await inbox(employeeBToken)).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Event 6 — manager creates a directly-AVAILABLE property
  // ---------------------------------------------------------------------------
  it('notifies the employees (not the creator) when an OWNER creates an AVAILABLE property', async () => {
    // Managers no longer create AVAILABLE rows directly; OWNER does.
    const created = await createProperty(manager2Token);
    expect(created.status).toBe('AVAILABLE');

    for (const token of [employeeAToken, employeeBToken]) {
      const items = await inbox(token);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: 'PROPERTY_AVAILABLE',
        title: 'عقار جديد متاح في البرنامج',
        propertyId: created.id,
      });
    }
    // The creating manager is never notified of their own action.
    expect(await inbox(managerToken)).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Event 2 — changes requested
  // ---------------------------------------------------------------------------
  it('notifies only the creator when a manager requests changes, with correction wording and no instructions', async () => {
    const created = await createProperty(employeeAToken);
    await ctx.prisma.notification.deleteMany({});
    const response = await requestChanges(
      managerToken,
      created.id,
      'يرجى مراجعة السعر وتفاصيل الدور الأول',
    );
    expect(response.status).toBe(200);

    const items = await inbox(employeeAToken);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'PROPERTY_CHANGES_REQUESTED',
      title: 'مطلوب تعديل بيانات العقار',
      propertyId: created.id,
    });
    // The manager's free-text instructions are never copied into the notification.
    expect(JSON.stringify(items[0])).not.toContain('يرجى مراجعة السعر وتفاصيل الدور الأول');
    expect(items[0]?.message).toContain('رقم العقار:');
    // Managers receive nothing for their own decision.
    expect(await inbox(managerToken)).toHaveLength(0);
    expect(await inbox(manager2Token)).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Event 3 — rejection
  // ---------------------------------------------------------------------------
  it('notifies only the creator on rejection with the reason and decision details', async () => {
    const created = await createProperty(employeeAToken);
    await ctx.prisma.notification.deleteMany({});
    const response = await reject(managerToken, created.id, 'السعر غير منطقي 5555');
    expect(response.status).toBe(200);

    const items = await inbox(employeeAToken);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'PROPERTY_REJECTED',
      title: 'تم رفض تسجيل العقار',
      propertyId: created.id,
    });
    expect(items[0]?.message).toContain('السعر غير منطقي 5555');
    expect(items[0]?.message).toContain('رقم العقار:');
    expect(await inbox(managerToken)).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Event 4 — resubmission (and the "saved correction is silent" rule)
  // ---------------------------------------------------------------------------
  it('stays silent while a correction is only SAVED, then notifies managers on a real resubmission', async () => {
    const created = await createProperty(employeeAToken);
    const requested = await requestChanges(managerToken, created.id);
    expect(requested.status).toBe(200);
    const afterRequest = requested.body.data as { version: number };
    await ctx.prisma.notification.deleteMany({});

    // Saving a genuine correction notifies the managers ONCE per manager; it
    // still does not put the row back into the actionable queue.
    const patched = await api()
      .patch(`/properties/${created.id}`)
      .set(auth(employeeAToken))
      .send({ version: afterRequest.version, sizeSqm: '450.00' });
    expect(patched.status).toBe(200);
    expect(
      await ctx.prisma.notification.count({
        where: { title: 'تم تعديل عقار تحت المراجعة' },
      }),
    ).toBe(2); // one per active manager

    const response = await resubmit(employeeAToken, created.id);
    expect(response.status).toBe(200);
    for (const token of [managerToken, manager2Token]) {
      const items = (await inbox(token)).filter(
        (item) => item.type === 'PROPERTY_RESUBMITTED',
      );
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: 'PROPERTY_RESUBMITTED',
        title: 'تمت إعادة إرسال عقار للمراجعة',
        propertyId: created.id,
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Event 5 — approval (creator) + event 6 (other employees)
  // ---------------------------------------------------------------------------
  it('on approval tells the creator once and the other employees about the new available property', async () => {
    const created = await createProperty(employeeAToken);
    await ctx.prisma.notification.deleteMany({});
    const response = await approve(managerToken, created.id);
    expect(response.status).toBe(200);

    const creator = await inbox(employeeAToken);
    expect(creator).toHaveLength(1);
    expect(creator[0]).toMatchObject({
      type: 'PROPERTY_APPROVED',
      title: 'تمت الموافقة على عقارك',
      propertyId: created.id,
    });
    // No redundant second (AVAILABLE) notification for the creator.
    expect(creator.some((item) => item.type === 'PROPERTY_AVAILABLE')).toBe(false);

    for (const token of [employeeBToken, await login(ctx.app, employeeCEmail)]) {
      const items = await inbox(token);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: 'PROPERTY_AVAILABLE',
        title: 'عقار جديد متاح في البرنامج',
        propertyId: created.id,
      });
    }
    expect(await ctx.prisma.notification.count({ where: { userId: employeeCId } })).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Failure / conflict safety
  // ---------------------------------------------------------------------------
  it('creates no notification for failed, forbidden or conflicting transitions', async () => {
    const created = await createProperty(employeeAToken);
    await ctx.prisma.notification.deleteMany({});

    // An employee may not approve.
    expect((await approve(employeeBToken, created.id)).status).toBe(403);
    // A stale version is refused.
    expect((await approve(managerToken, created.id, { version: created.version + 9 })).status).toBe(409);
    // A blank reason is refused.
    expect((await reject(managerToken, created.id, '   ')).status).toBe(400);
    // Blank change instructions are refused.
    expect((await requestChanges(managerToken, created.id, '   ')).status).toBe(400);
    // A non-creator may not resubmit.
    expect((await resubmit(employeeBToken, created.id)).status).toBe(403);
    // An unreviewed PENDING property is already awaiting review.
    expect((await resubmit(employeeAToken, created.id)).status).toBe(409);

    expect(await ctx.prisma.notification.count()).toBe(0);
    // And the property itself is untouched.
    const after = await ctx.prisma.property.findUnique({ where: { id: created.id } });
    expect(after?.status).toBe('PENDING');
    expect(after?.version).toBe(1);
  });

  it('never creates a second notification for a duplicated action or a repeated click', async () => {
    const created = await createProperty(employeeAToken);
    await ctx.prisma.notification.deleteMany({});

    // Approve twice: the second is a conflict, not a second notification.
    expect((await approve(managerToken, created.id)).status).toBe(200);
    expect((await approve(managerToken, created.id)).status).toBe(409);
    const creator = await inbox(employeeAToken);
    expect(creator.filter((item) => item.type === 'PROPERTY_APPROVED')).toHaveLength(1);
    expect(
      await ctx.prisma.notification.count({ where: { userId: employeeAId, type: 'PROPERTY_APPROVED' } }),
    ).toBe(1);

    // A double resubmission is serialised: the second click is a conflict.
    const second = await createProperty(employeeAToken);
    await requestChanges(managerToken, second.id);
    await ctx.prisma.notification.deleteMany({});
    expect((await resubmit(employeeAToken, second.id)).status).toBe(200);
    expect((await resubmit(employeeAToken, second.id)).status).toBe(409);
    expect(
      await ctx.prisma.notification.count({ where: { type: 'PROPERTY_RESUBMITTED' } }),
    ).toBe(2); // one per active manager, from the single successful resubmission

    // Reading twice is idempotent and does not duplicate anything.
    const target = (await inbox(managerToken))[0] as NotificationItem;
    expect((await api().patch(`/notifications/${target.id}/read`).set(auth(managerToken))).status).toBe(200);
    expect((await api().patch(`/notifications/${target.id}/read`).set(auth(managerToken))).status).toBe(200);
    expect(
      await ctx.prisma.notification.count({ where: { userId: managerId, id: target.id } }),
    ).toBe(1);
  });

  it('creates no notification for unrelated read operations', async () => {
    const created = await createProperty(employeeAToken);
    const before = await ctx.prisma.notification.count();
    expect(before).toBe(2); // both active managers

    await api().get('/properties?limit=100').set(auth(managerToken));
    await api().get(`/properties/${created.id}`).set(auth(managerToken));
    await api().get(`/properties/${created.id}`).set(auth(employeeAToken));
    await api().get(`/properties/${created.id}/image`).set(auth(managerToken));
    await api().get('/notifications?limit=20').set(auth(managerToken));

    expect(await ctx.prisma.notification.count()).toBe(before);
  });

  // ---------------------------------------------------------------------------
  // Ownership isolation
  // ---------------------------------------------------------------------------
  it('only ever exposes a user’s own inbox and refuses another user’s notification id', async () => {
    const created = await createProperty(employeeAToken);
    const managerItems = await inbox(managerToken);
    const managerNotificationId = managerItems[0]?.id as string;

    // The creator's inbox is empty and never contains the manager's row.
    expect(await inbox(employeeAToken)).toHaveLength(0);

    // The MANAGER role does not widen access to another user's inbox.
    expect(
      (await api().patch(`/notifications/${managerNotificationId}/read`).set(auth(employeeAToken))).status,
    ).toBe(404);
    expect(
      (await api().patch(`/notifications/${managerNotificationId}/read`).set(auth(manager2Token))).status,
    ).toBe(404);
    // …including for an employee-property notification owned by the creator.
    await requestChanges(managerToken, created.id);
    const creatorItems = await inbox(employeeAToken);
    const creatorNotificationId = creatorItems[0]?.id as string;
    expect(
      (await api().patch(`/notifications/${creatorNotificationId}/read`).set(auth(managerToken))).status,
    ).toBe(404);
    expect(
      (await api().patch(`/notifications/${creatorNotificationId}/read`).set(auth(employeeBToken))).status,
    ).toBe(404);

    // A guessed / unknown UUID is a 404, never a cross-user read.
    expect(
      (await api().patch(`/notifications/${randomUUID()}/read`).set(auth(employeeAToken))).status,
    ).toBe(404);
    // The owner can still read their own row.
    expect(
      (await api().patch(`/notifications/${creatorNotificationId}/read`).set(auth(employeeAToken))).status,
    ).toBe(200);

    // Assert the two users' id sets are disjoint.
    const managerIds = new Set((await inbox(managerToken)).map((item) => item.id));
    for (const item of await inbox(employeeAToken)) expect(managerIds.has(item.id)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Unread count / mark read / mark all read
  // ---------------------------------------------------------------------------
  it('reports the unread count and supports mark-read and mark-all-read idempotently', async () => {
    const first = await createProperty(employeeAToken);
    const second = await createProperty(employeeAToken);
    await requestChanges(managerToken, first.id);
    await requestChanges(managerToken, second.id);

    expect(await unreadCount(employeeAToken)).toBe(2);
    const items = await inbox(employeeAToken);
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.read === false && item.readAt === null)).toBe(true);

    const readOne = await api().patch(`/notifications/${items[0]?.id}/read`).set(auth(employeeAToken));
    expect(readOne.status).toBe(200);
    expect(readOne.body.data).toMatchObject({ read: true });
    expect(await unreadCount(employeeAToken)).toBe(1);

    const refreshed = await inbox(employeeAToken);
    expect(refreshed.filter((item) => item.read)).toHaveLength(1);

    const readAll = await api().patch('/notifications/read-all').set(auth(employeeAToken));
    expect(readAll.status).toBe(200);
    expect(await unreadCount(employeeAToken)).toBe(0);
    expect((await inbox(employeeAToken)).every((item) => item.read === true)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------------
  it('paginates newest-first with a bounded limit', async () => {
    await createProperty(manager2Token);
    await sleep(10);
    await createProperty(manager2Token);
    await sleep(10);
    await createProperty(manager2Token);

    const firstPage = await api().get('/notifications?limit=2').set(auth(employeeBToken));
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data.items).toHaveLength(2);
    expect(firstPage.body.data.nextCursor).toEqual(expect.any(String));

    const times = (firstPage.body.data.items as NotificationItem[]).map((item) =>
      Date.parse(item.createdAt),
    );
    expect(times[0]).toBeGreaterThanOrEqual(times[1] as number);

    const secondPage = await api()
      .get(`/notifications?limit=2&cursor=${firstPage.body.data.nextCursor}`)
      .set(auth(employeeBToken));
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.data.items).toHaveLength(1);
    expect(secondPage.body.data.nextCursor).toBeNull();

    // The page is bounded.
    expect((await api().get('/notifications?limit=101').set(auth(employeeBToken))).status).toBe(400);
    expect((await api().get('/notifications?limit=0').set(auth(employeeBToken))).status).toBe(400);
    // A malformed cursor / id is rejected.
    expect((await api().get('/notifications?cursor=not-a-uuid').set(auth(employeeBToken))).status).toBe(400);
    expect(
      (await api().patch('/notifications/not-a-uuid/read').set(auth(employeeBToken))).status,
    ).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // Link authorization is re-verified on read
  // ---------------------------------------------------------------------------
  it('clears the linked property when the viewer is no longer authorized to open it', async () => {
    const created = await createProperty(employeeAToken);

    // The manager can open the PENDING property, so the link is kept.
    const managerItems = await inbox(managerToken);
    expect(managerItems[0]?.propertyId).toBe(created.id);

    // A stale notification pointing an employee at a property they cannot read
    // (another employee's PENDING property) must come back WITHOUT the link.
    const stale = await ctx.prisma.notification.create({
      data: {
        userId: employeeBId,
        type: 'PROPERTY_AVAILABLE',
        title: 'عقار جديد متاح في البرنامج',
        body: `رقم العقار: ${created.reference}`,
        propertyId: created.id,
        eventKey: `TEST_STALE:${created.id}:${employeeBId}`,
      },
    });
    const items = await inbox(employeeBToken);
    const found = items.find((item) => item.id === stale.id);
    expect(found).toBeDefined();
    expect(found?.propertyId).toBeNull();
    // The row still exists and is listed — only the unusable link is withheld.
    expect(await ctx.prisma.notification.count({ where: { id: stale.id } })).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Payload privacy / shape
  // ---------------------------------------------------------------------------
  it('exposes a fixed, privacy-safe payload with no recipient id and no contact data', async () => {
    const created = await createProperty(employeeAToken);
    const items = await inbox(managerToken);
    const item = items[0] as NotificationItem;

    // Exactly the documented fields — no raw entity, no `userId`.
    expect(Object.keys(item).sort()).toEqual(
      [
        'clientId',
        'clientReviewId',
        'contactId',
        'contactType',
        'createdAt',
        'duplicate',
        'eventKey',
        'followUpId',
        'followUpSubjectId',
        'id',
        'message',
        'propertyId',
        'propertyReference',
        'read',
        'readAt',
        'title',
        'type',
      ].sort(),
    );
    // A property row never carries any record event reference.
    expect(item.clientId).toBeNull();
    expect(item.contactId).toBeNull();
    expect(item.contactType).toBeNull();
    expect(item.followUpId).toBeNull();
    // A follow-up subject deep link is exposed to the RESPONSIBLE EMPLOYEE
    // only; manager copies (and every non-follow-up row) carry null.
    expect(item.followUpSubjectId).toBeNull();
    const serialized = JSON.stringify(item);
    for (const secret of ['66661111', 'وسيط خاص', managerId, employeeAId]) {
      expect(serialized).not.toContain(secret);
    }
    // The short message is a neutral reference, not the description or a note.
    expect(item.message).toBe(`رقم العقار: ${created.reference}`);
    expect(item.message).not.toContain('بيت مستقل للبيع');
  });

  // ---------------------------------------------------------------------------
  // Persistence across sessions
  // ---------------------------------------------------------------------------
  it('persists notifications across a brand-new authenticated API session', async () => {
    const created = await createProperty(employeeAToken);
    const original = await inbox(managerToken);
    expect(original).toHaveLength(1);

    // A fresh login issues a new access token; the stored rows must still be there
    // (they live in PostgreSQL, not in memory or the token).
    const freshToken = await login(ctx.app, 'manager@notifications.local');
    const afterReconnect = await inbox(freshToken);
    expect(afterReconnect.map((item) => item.id)).toEqual(original.map((item) => item.id));
    expect(afterReconnect[0]?.propertyId).toBe(created.id);

    // Read-state also survives a new session.
    await api().patch(`/notifications/${afterReconnect[0]?.id}/read`).set(auth(freshToken));
    const secondToken = await login(ctx.app, 'manager@notifications.local');
    expect((await inbox(secondToken))[0]?.read).toBe(true);
    expect(await unreadCount(secondToken)).toBe(0);

    // And the recipient ids are never shared across managers.
    expect(await ctx.prisma.notification.count({ where: { userId: manager2Id } })).toBe(1);
  });
});
