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

jest.setTimeout(180000);

const image = [{ buffer: pngBytes(), filename: 'photo.png' }];

interface NotificationItem {
  id: string;
  type: string;
  title: string;
}

interface SystemLogItem {
  id: string;
  action: string;
  title: string;
  description: string;
  actor: { id: string; name: string; role: Role };
  recipients: Array<{ id: string; name: string; role: Role }>;
  entity: {
    type: string;
    label: string;
    id: string;
    code: string | null;
    name: string | null;
  } | null;
  details: { type: 'CLIENT_REVIEW' | 'PROPERTY'; id: string } | null;
  createdAt: string;
}

describeWithDatabase('Direct review routing + owner system log', () => {
  let ctx: TestContext;
  let ownerId: string;
  let managerId: string;
  let inactiveManagerId: string;
  let managedEmployeeId: string;
  let directEmployeeId: string;
  let inactiveManagedEmployeeId: string;
  let ownerToken: string;
  let managerToken: string;
  let managedToken: string;
  let directToken: string;
  let inactiveManagedToken: string;
  let sequence = 0;

  const api = () => request(ctx.app.getHttpServer());

  const propertyPayload = () => ({
    listingType: 'SALE',
    governorate: 'العاصمة',
    district: 'الشرق',
    block: '7',
    plotNumber: String(970000 + ++sequence),
    sizeSqm: '420.00',
    askingPrice: '310000.00',
    negotiable: true,
    description: 'عقار لاختبار مسار المراجعة',
    floors: [{ type: 'GROUND', details: 'دور أرضي' }],
    newContact: {
      type: 'BROKER',
      name: 'مالك اختبار المسار',
      phone: `661${String(10000 + sequence).padStart(5, '0')}`,
    },
  });

  const createProperty = async (token: string) => {
    const response = await postProperty(
      ctx.app,
      token,
      propertyPayload(),
      image,
    );
    expect(response.status).toBe(201);
    return response.body.data as { id: string; reference: string };
  };

  const inbox = async (token: string): Promise<NotificationItem[]> => {
    const response = await api()
      .get('/notifications?limit=100')
      .set(auth(token));
    expect(response.status).toBe(200);
    return response.body.data.items as NotificationItem[];
  };

  const submitClientReview = (token: string, name: string, phone: string) =>
    api().post('/client-reviews').set(auth(token)).send({
      kind: 'CREATION',
      name,
      phone,
      notes: 'طلب مراجعة لاختبار المسار',
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const owner = await createUser(ctx.prisma, {
      email: 'routing.owner@test.local',
      name: 'مالك الاختبار',
      role: Role.OWNER,
    });
    const manager = await createUser(ctx.prisma, {
      email: 'routing.manager@test.local',
      name: 'مدير الاختبار',
      role: Role.MANAGER,
    });
    const managed = await createUser(ctx.prisma, {
      email: 'routing.managed@test.local',
      name: 'موظف تابع للمدير',
      role: Role.EMPLOYEE,
      managerUserId: manager.id,
    });
    const direct = await createUser(ctx.prisma, {
      email: 'routing.direct@test.local',
      name: 'موظف تابع للمالك',
      role: Role.EMPLOYEE,
      managerUserId: null,
    });
    const inactiveManager = await createUser(ctx.prisma, {
      email: 'routing.inactive.manager@test.local',
      name: 'مدير غير نشط',
      role: Role.MANAGER,
    });
    await ctx.prisma.user.update({
      where: { id: inactiveManager.id },
      data: { isActive: false },
    });
    const inactiveManaged = await createUser(ctx.prisma, {
      email: 'routing.inactive.managed@test.local',
      name: 'موظف تابع لمدير غير نشط',
      role: Role.EMPLOYEE,
      managerUserId: inactiveManager.id,
    });
    ownerId = owner.id;
    managerId = manager.id;
    inactiveManagerId = inactiveManager.id;
    managedEmployeeId = managed.id;
    directEmployeeId = direct.id;
    inactiveManagedEmployeeId = inactiveManaged.id;
    ownerToken = await login(ctx.app, owner.email);
    managerToken = await login(ctx.app, manager.email);
    managedToken = await login(ctx.app, managed.email);
    directToken = await login(ctx.app, direct.email);
    inactiveManagedToken = await login(ctx.app, inactiveManaged.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.prisma.notification.deleteMany({});
  });

  it('routes a managed employee property review to the Manager only', async () => {
    const property = await createProperty(managedToken);
    const managerItems = await inbox(managerToken);
    expect(managerItems).toHaveLength(1);
    expect(managerItems[0]).toMatchObject({
      type: 'PROPERTY_SUBMITTED',
      title: 'عقار جديد بانتظار المراجعة',
    });
    expect(await inbox(ownerToken)).toHaveLength(0);
    expect(
      await ctx.prisma.notification.count({
        where: {
          eventKey: `PROPERTY_SUBMITTED:${property.id}`,
          userId: { in: [managerId, ownerId] },
        },
      }),
    ).toBe(1);
  });

  it('routes a directly-assigned employee property review to the OWNER only', async () => {
    const property = await createProperty(directToken);
    const ownerItems = await inbox(ownerToken);
    expect(ownerItems).toHaveLength(1);
    expect(ownerItems[0]).toMatchObject({
      type: 'PROPERTY_SUBMITTED',
      title: 'عقار جديد بانتظار المراجعة',
    });
    expect(await inbox(managerToken)).toHaveLength(0);
    expect(await inbox(directToken)).toHaveLength(0);
    expect(
      await ctx.prisma.notification.count({
        where: {
          eventKey: `PROPERTY_SUBMITTED:${property.id}`,
          userId: { in: [managerId, ownerId] },
        },
      }),
    ).toBe(1);
  });

  it('routes client review submissions to the direct supervisor only', async () => {
    const managedReview = await submitClientReview(
      managedToken,
      'عميل تابع للمدير',
      '97010001',
    );
    expect(managedReview.status).toBe(201);
    const managerItems = await inbox(managerToken);
    expect(managerItems).toHaveLength(1);
    expect(managerItems[0]?.type).toBe('CLIENT_REVIEW_SUBMITTED');
    expect(await inbox(ownerToken)).toHaveLength(0);

    await ctx.prisma.notification.deleteMany({});
    const directReview = await submitClientReview(
      directToken,
      'عميل تابع للمالك',
      '97010002',
    );
    expect(directReview.status).toBe(201);
    const ownerItems = await inbox(ownerToken);
    expect(ownerItems).toHaveLength(1);
    expect(ownerItems[0]?.type).toBe('CLIENT_REVIEW_SUBMITTED');
    expect(await inbox(managerToken)).toHaveLength(0);
  });

  it('fails without fallback when the assigned Manager is inactive', async () => {
    const property = await postProperty(
      ctx.app,
      inactiveManagedToken,
      propertyPayload(),
      image,
    );
    expect(property.status).toBe(400);
    expect(String(property.body.error?.message ?? '')).toContain(
      'المشرف المباشر غير نشط',
    );
    expect(await inbox(ownerToken)).toHaveLength(0);
    expect(await inbox(managerToken)).toHaveLength(0);
    expect(
      await ctx.prisma.notification.count({
        where: {
          userId: { in: [ownerId, managerId, inactiveManagerId] },
        },
      }),
    ).toBe(0);

    const review = await submitClientReview(
      inactiveManagedToken,
      'عميل بلا مدير نشط',
      '97010004',
    );
    expect(review.status).toBe(400);
    expect(String(review.body.error?.message ?? '')).toContain(
      'المشرف المباشر غير نشط',
    );
    expect(
      await ctx.prisma.clientReviewRequest.count({
        where: { requestedById: inactiveManagedEmployeeId },
      }),
    ).toBe(0);
    expect(await inbox(ownerToken)).toHaveLength(0);
    expect(await inbox(managerToken)).toHaveLength(0);
    expect(inactiveManagedEmployeeId).toBeTruthy();
  });

  it('serves a real newest-first system log to the OWNER and denies Manager/Employee', async () => {
    const property = await createProperty(managedToken);
    const review = await submitClientReview(
      directToken,
      'عميل للسجل',
      '97010003',
    );
    expect(review.status).toBe(201);
    const reviewId = (review.body.data as { id: string }).id;

    const beforeDetail = await api()
      .get(`/client-reviews/${reviewId}`)
      .set(auth(ownerToken));
    expect(beforeDetail.status).toBe(200);
    expect((beforeDetail.body.data as { status: string }).status).toBe(
      'PENDING',
    );

    const approved = await api()
      .post(`/client-reviews/${reviewId}/approve`)
      .set(auth(ownerToken))
      .send({});
    expect(approved.status).toBe(201);

    const afterDetail = await api()
      .get(`/client-reviews/${reviewId}`)
      .set(auth(ownerToken));
    expect(afterDetail.status).toBe(200);
    expect((afterDetail.body.data as { status: string }).status).toBe(
      'APPROVED',
    );
    const propertyDetail = await api()
      .get(`/properties/${property.id}`)
      .set(auth(ownerToken));
    expect(propertyDetail.status).toBe(200);
    expect((propertyDetail.body.data as { id: string }).id).toBe(property.id);

    const countsBeforeReads = {
      reviews: await ctx.prisma.clientReviewRequest.count(),
      clients: await ctx.prisma.client.count(),
      notifications: await ctx.prisma.notification.count(),
      properties: await ctx.prisma.property.count(),
    };

    const response = await api()
      .get('/notifications/system-log?limit=100')
      .set(auth(ownerToken));
    expect(response.status).toBe(200);
    const items = response.body.data.items as SystemLogItem[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.action !== 'AUTH_LOGIN')).toBe(true);
    expect(items.every((item) => item.action !== 'AUTH_REFRESH')).toBe(true);

    const propertyEntry = items.find(
      (item) =>
        item.action === 'PROPERTY_CREATE' &&
        item.entity?.id === property.id,
    );
    expect(propertyEntry).toBeTruthy();
    expect(propertyEntry?.title).toContain('موظف تابع للمدير');
    expect(propertyEntry?.title).toContain('أرسل عقاراً للمراجعة');
    expect(propertyEntry?.entity).toMatchObject({
      type: 'PROPERTY',
      label: 'عقار',
    });
    expect(propertyEntry?.entity?.code).toBe(property.reference);
    expect(propertyEntry?.details).toEqual({
      type: 'PROPERTY',
      id: property.id,
    });
    expect(propertyEntry?.recipients.map((party) => party.id)).toEqual([
      managerId,
    ]);
    expect(propertyEntry?.createdAt).toBeTruthy();

    const reviewEntry = items.find(
      (item) =>
        item.action === 'CLIENT_REVIEW_SUBMIT' &&
        item.actor.id === directEmployeeId,
    );
    expect(reviewEntry).toBeTruthy();
    expect(reviewEntry?.title).toContain('أرسل عميلاً للمراجعة');
    expect(reviewEntry?.entity?.type).toBe('CLIENT_REVIEW');
    expect(reviewEntry?.details).toEqual({
      type: 'CLIENT_REVIEW',
      id: reviewId,
    });
    expect(reviewEntry?.recipients.map((party) => party.id)).toEqual([
      ownerId,
    ]);

    const decisionEntry = items.find(
      (item) =>
        item.action === 'CLIENT_REVIEW_APPLY' && item.actor.id === ownerId,
    );
    expect(decisionEntry?.details).toEqual({
      type: 'CLIENT_REVIEW',
      id: reviewId,
    });

    expect({
      reviews: await ctx.prisma.clientReviewRequest.count(),
      clients: await ctx.prisma.client.count(),
      notifications: await ctx.prisma.notification.count(),
      properties: await ctx.prisma.property.count(),
    }).toEqual(countsBeforeReads);

    const timestamps = items.map((item) => Date.parse(item.createdAt));
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));

    const firstPage = await api()
      .get('/notifications/system-log?limit=2')
      .set(auth(ownerToken));
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data.items).toHaveLength(2);
    expect(firstPage.body.data.nextCursor).toEqual(expect.any(String));
    const secondPage = await api()
      .get(
        `/notifications/system-log?limit=2&cursor=${firstPage.body.data.nextCursor}`,
      )
      .set(auth(ownerToken));
    expect(secondPage.status).toBe(200);
    const firstIds = new Set(
      (firstPage.body.data.items as SystemLogItem[]).map((item) => item.id),
    );
    for (const item of secondPage.body.data.items as SystemLogItem[])
      expect(firstIds.has(item.id)).toBe(false);

    for (const token of [managerToken, managedToken]) {
      const denied = await api()
        .get('/notifications/system-log')
        .set(auth(token));
      expect(denied.status).toBe(403);
    }
    expect(
      (await api().get('/notifications/system-log')).status,
    ).toBe(401);
    expect(managedEmployeeId).toBeTruthy();
  });

  it('does not invent a details link for a historic audit row without a record', async () => {
    const orphan = await ctx.prisma.auditLog.create({
      data: {
        actorId: ownerId,
        action: 'CLIENT_REVIEW_SUBMIT',
        entityType: 'ClientReviewRequest',
        entityId: randomUUID(),
        after: { kind: 'CREATION' },
      },
      select: { id: true },
    });
    const response = await api()
      .get('/notifications/system-log?limit=100')
      .set(auth(ownerToken));
    expect(response.status).toBe(200);
    const entry = (response.body.data.items as SystemLogItem[]).find(
      (item) => item.id === orphan.id,
    );
    expect(entry).toBeTruthy();
    expect(entry?.details).toBeNull();
    expect(entry?.entity?.type).toBe('CLIENT_REVIEW');
  });
});
