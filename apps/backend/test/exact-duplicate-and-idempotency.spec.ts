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
import { notificationRoute } from '../../frontend/features/notifications/notification-target';

jest.setTimeout(180000);

const image = [{ buffer: pngBytes(), filename: 'photo.png' }];
const DUPLICATE_MESSAGE =
  'لا يمكن إضافة العقار، لأنه مسجّل بالفعل في النظام.';

describeWithDatabase('Exact duplicate blocking and create idempotency', () => {
  let ctx: TestContext;
  let managerToken: string;
  let managerId: string;
  let employeeAToken: string;
  let employeeBToken: string;
  const api = () => request(ctx.app.getHttpServer());

  const payload = (overrides: Record<string, unknown> = {}) => ({
    listingType: 'SALE',
    governorate: 'الجهراء',
    district: 'مدينة المطلاع',
    block: '8',
    plotNumber: '910001',
    sizeSqm: '400.00',
    floorCount: 1,
    askingPrice: '250000.00',
    negotiable: true,
    description: 'بيت مستقل للبيع',
    floors: [{ type: 'GROUND', details: 'صالة ومجلس' }],
    newContact: { type: 'OWNER', name: 'Same Owner', phone: '61112222' },
    ...overrides,
  });

  /** Multipart create with the same optional idempotency header the UI sends. */
  const post = (
    token: string,
    body: Record<string, unknown>,
    idempotencyKey?: string,
  ) => {
    let req = api()
      .post('/properties')
      .set(auth(token))
      .field('payload', JSON.stringify(body));
    if (idempotencyKey) req = req.set('Idempotency-Key', idempotencyKey);
    return req.attach('image', pngBytes(), 'photo.png');
  };

  const counts = async () => ({
    properties: await ctx.prisma.property.count(),
    approvals: await ctx.prisma.propertyApprovalRequest.count(),
    notifications: await ctx.prisma.notification.count(),
  });

  const sequence = async () =>
    (
      await ctx.prisma.propertyCodeSequence.findUnique({
        where: { id: 2 },
        select: { value: true },
      })
    )?.value ?? BigInt(0);

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'duplicate-manager@test.local',
      name: 'Duplicate Manager',
      role: Role.MANAGER,
    });
    const a = await createUser(ctx.prisma, {
      email: 'duplicate-a@test.local',
      name: 'Duplicate A',
      role: Role.EMPLOYEE,
    });
    const b = await createUser(ctx.prisma, {
      email: 'duplicate-b@test.local',
      name: 'Duplicate B',
      role: Role.EMPLOYEE,
    });
    managerId = manager.id;
    managerToken = await login(ctx.app, manager.email);
    employeeAToken = await login(ctx.app, a.email);
    employeeBToken = await login(ctx.app, b.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('rejects an exact block+plot duplicate with 409, creates nothing, and keeps P/A sequences untouched', async () => {
    const original = await postProperty(
      ctx.app,
      employeeAToken,
      payload({ plotNumber: '910001' }),
      image,
    );
    expect(original.status).toBe(201);
    const originalId = original.body.data.id as string;
    const originalRef = original.body.data.reference as string;

    const before = await counts();
    const pBefore = await sequence();

    const dup = await post(employeeBToken, payload({ plotNumber: '910001' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error?.message).toBe(DUPLICATE_MESSAGE);
    const after = await counts();
    expect(after.properties).toBe(before.properties);
    expect(after.approvals).toBe(before.approvals);
    // The durable Manager alert is the ONLY new row.
    expect(after.notifications).toBe(before.notifications + 1);
    expect(await sequence()).toBe(pBefore);

    const notification = await ctx.prisma.notification.findFirst({
      where: {
        userId: managerId,
        title: 'محاولة تسجيل عقار مكرر',
        propertyId: originalId,
      },
    });
    expect(notification).toBeTruthy();
    expect(notification!.body).toContain('Duplicate B');
    expect(notification!.body).toContain(originalRef);
    expect(notification!.body).toContain('التاريخ:');
    expect(notification!.body).toContain('الحالة: تم منع التسجيل');
    expect(notification!.eventKey).toMatch(/^DUPLICATE_ATTEMPT:/);

    // Employees cannot read the other employee's existing property.
    expect(
      (await api().get(`/properties/${originalId}`).set(auth(employeeBToken)))
        .status,
    ).toBe(404);
    // The Manager can, and the alert routes to that authorized property.
    expect(
      (await api().get(`/properties/${originalId}`).set(auth(managerToken)))
        .status,
    ).toBe(200);
    expect(
      notificationRoute(
        {
          propertyId: originalId,
          eventKey: notification!.eventKey,
          clientId: null,
          contactId: null,
          contactType: null,
          clientReviewId: null,
          followUpSubjectId: null,
        },
        'MANAGER',
      )?.path,
    ).toBe(`/manager/properties?property=${originalId}`);
  });

  it('confirms the screenshot scenario: same plot with the block omitted and real owner evidence', async () => {
    const owner = { type: 'OWNER', name: 'Plot Owner', phone: '61113333' };
    const original = await postProperty(
      ctx.app,
      employeeAToken,
      payload({
        block: '8',
        plotNumber: '910002',
        sizeSqm: '300.00',
        floorCount: 2,
        floors: [
          { type: 'GROUND', details: 'مجلس + ديوانية' },
          { type: 'FIRST', details: ' ثلاث غرف' },
        ],
        newContact: owner,
      }),
      image,
    );
    expect(original.status).toBe(201);
    const originalId = original.body.data.id as string;

    const dup = await post(
      employeeBToken,
      payload({
        block: '',
        plotNumber: '910002',
        sizeSqm: '300.00',
        floorCount: 2,
        floors: [
          { type: 'GROUND', details: 'مجلس + ديوانية' },
          { type: 'FIRST', details: ' ثلاث غرف' },
        ],
        newContact: owner,
      }),
    );
    expect(dup.status).toBe(409);
    expect(dup.body.error?.message).toBe(DUPLICATE_MESSAGE);
    expect(
      await ctx.prisma.property.count({ where: { plotNumber: '910002' } }),
    ).toBe(1);

    const notification = await ctx.prisma.notification.findFirst({
      where: {
        userId: managerId,
        title: 'محاولة تسجيل عقار مكرر',
        propertyId: originalId,
      },
    });
    expect(notification).toBeTruthy();
  });

  it('does not confirm mostly-empty records; creates ONE PENDING potential review', async () => {
    const original = await postProperty(
      ctx.app,
      employeeAToken,
      payload({
        block: '',
        plotNumber: '910003',
        sizeSqm: undefined,
        floorCount: 0,
        floors: [],
        newContact: { type: 'OWNER', name: 'Owner One', phone: '61114444' },
      }),
      image,
    );
    expect(original.status).toBe(201);
    const originalId = original.body.data.id as string;

    const potential = await post(
      employeeBToken,
      payload({
        block: '',
        plotNumber: '910003',
        sizeSqm: undefined,
        floorCount: 0,
        floors: [],
        newContact: { type: 'OWNER', name: 'Owner Two', phone: '61115555' },
      }),
    );
    expect(potential.status).toBe(201);
    const potentialId = potential.body.data.id as string;
    expect(
      await ctx.prisma.property.count({ where: { plotNumber: '910003' } }),
    ).toBe(2);
    expect(
      await ctx.prisma.propertyApprovalRequest.count({
        where: { propertyId: potentialId },
      }),
    ).toBe(1);
    const approval = await ctx.prisma.propertyApprovalRequest.findFirst({
      where: { propertyId: potentialId },
    });
    expect(approval!.duplicateCandidateIds).toContain(originalId);

    // The normal approve-as-distinct gate still applies.
    expect(
      (
        await api()
          .post(`/properties/${potentialId}/approve`)
          .set(auth(managerToken))
          .send({})
      ).status,
    ).toBe(400);
    expect(
      (
        await api()
          .post(`/properties/${potentialId}/approve`)
          .set(auth(managerToken))
          .send({ approveAsDistinct: true })
      ).status,
    ).toBe(200);
  });

  it('is idempotent for concurrent retries with the same operation id', async () => {
    const body = payload({ block: '8', plotNumber: '910004' });
    const key = 'retry-operation-910004';
    const before = await counts();
    const pBefore = await sequence();

    const [first, second] = await Promise.all([
      post(employeeAToken, body, key),
      post(employeeAToken, body, key),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(first.body.data.id).toBe(second.body.data.id);
    expect(await counts()).toEqual({
      ...before,
      properties: before.properties + 1,
      approvals: before.approvals + 1,
      notifications: before.notifications + 1,
    });
    expect(await sequence()).toBe(pBefore + BigInt(1));
    expect(
      await ctx.prisma.property.count({ where: { plotNumber: '910004' } }),
    ).toBe(1);
    expect(
      await ctx.prisma.propertyApprovalRequest.count({
        where: { propertyId: first.body.data.id },
      }),
    ).toBe(1);
  });

  it('replays the committed result for the same operation id even with changed payload', async () => {
    const key = 'replay-operation-910005';
    const first = await post(
      employeeAToken,
      payload({ plotNumber: '910005' }),
      key,
    );
    expect(first.status).toBe(201);
    const second = await post(
      employeeAToken,
      payload({ plotNumber: '910006' }),
      key,
    );
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(
      await ctx.prisma.property.count({ where: { plotNumber: '910006' } }),
    ).toBe(0);
  });

  it('deduplicates identical blocked alerts but alerts again for a materially changed attempt', async () => {
    const original = await postProperty(
      ctx.app,
      employeeAToken,
      payload({ block: '8', plotNumber: '910007' }),
      image,
    );
    expect(original.status).toBe(201);
    const originalId = original.body.data.id as string;

    for (const key of ['blocked-1-910007', 'blocked-2-910007', 'blocked-3-910007']) {
      expect(
        (await post(employeeBToken, payload({ block: '8', plotNumber: '910007' }), key))
          .status,
      ).toBe(409);
    }
    expect(
      await ctx.prisma.notification.count({
        where: {
          userId: managerId,
          title: 'محاولة تسجيل عقار مكرر',
          propertyId: originalId,
        },
      }),
    ).toBe(1);

    // Same physical identifiers, but a materially changed attempt (new owner)
    // is a new fingerprint and must be visible to the Manager.
    expect(
      (
        await post(
          employeeBToken,
          payload({
            block: '8',
            plotNumber: '910007',
            newContact: {
              type: 'OWNER',
              name: 'Changed Owner',
              phone: '61116666',
            },
          }),
          'blocked-changed-910007',
        )
      ).status,
    ).toBe(409);
    expect(
      await ctx.prisma.notification.count({
        where: {
          userId: managerId,
          title: 'محاولة تسجيل عقار مكرر',
          propertyId: originalId,
        },
      }),
    ).toBe(2);
  });

  it('allows a corrected submission after a blocked attempt', async () => {
    const original = await postProperty(
      ctx.app,
      employeeAToken,
      payload({ block: '8', plotNumber: '910008' }),
      image,
    );
    expect(original.status).toBe(201);

    expect(
      (await post(employeeBToken, payload({ block: '8', plotNumber: '910008' }))).status,
    ).toBe(409);

    const corrected = await post(
      employeeBToken,
      payload({ block: '8', plotNumber: '910009' }),
    );
    expect(corrected.status).toBe(201);
    expect(corrected.body.data.status).toBe('PENDING');
  });

  it('keeps the Manager bell/notification row authorized and ready for the existing synchronization', async () => {
    const original = await postProperty(
      ctx.app,
      employeeAToken,
      payload({ plotNumber: '910010' }),
      image,
    );
    const dup = await post(employeeBToken, payload({ plotNumber: '910010' }));
    expect(dup.status).toBe(409);

    const inbox = await api()
      .get('/notifications?limit=100')
      .set(auth(managerToken));
    expect(inbox.status).toBe(200);
    const row = inbox.body.data.items.find(
      (item: { propertyId: string | null; title: string }) =>
        item.propertyId === original.body.data.id &&
        item.title === 'محاولة تسجيل عقار مكرر',
    );
    expect(row).toBeTruthy();
    expect(row.message).toContain('Duplicate B');
    expect(row.message).toContain('تم منع التسجيل');
    // The row points at the EXISTING property, not a rejected submission.
    const property = await ctx.prisma.property.findUnique({
      where: { id: original.body.data.id },
      select: { id: true },
    });
    expect(property?.id).toBe(original.body.data.id);
  });
});
