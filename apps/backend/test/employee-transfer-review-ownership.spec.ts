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
  resetRateLimiting,
  type TestContext,
} from './support/test-app';

jest.setTimeout(180000);

const image = [{ buffer: pngBytes(), filename: 'photo.png' }];

interface ReviewRow {
  id: string;
  status: string;
  assignedReviewerId: string | null;
  reviewedById: string | null;
}

interface SystemLogItem {
  id: string;
  action: string;
  title: string;
  description: string;
  entity: { id: string } | null;
}

describeWithDatabase('Employee transfer review ownership', () => {
  let ctx: TestContext;
  let managerAId: string;
  let managerBId: string;
  let inactiveManagerId: string;
  let employeeId: string;
  let ownerToken: string;
  let managerAToken: string;
  let managerBToken: string;
  let employeeToken: string;
  let sequence = 0;

  const api = () => request(ctx.app.getHttpServer());

  const propertyPayload = () => ({
    listingType: 'SALE',
    governorate: 'العاصمة',
    district: 'الشرق',
    block: 'T',
    plotNumber: String(880000 + ++sequence),
    sizeSqm: '400.00',
    askingPrice: '250000.00',
    negotiable: true,
    description: 'عقار لاختبار نقل ملكية المراجعة',
    floors: [{ type: 'GROUND', details: 'دور أرضي' }],
    newContact: {
      type: 'BROKER',
      name: 'Transfer Broker',
      phone: `662${String(10000 + sequence).padStart(5, '0')}`,
    },
  });

  const createProperty = async () => {
    const response = await postProperty(
      ctx.app,
      employeeToken,
      propertyPayload(),
      image,
    );
    expect(response.status).toBe(201);
    return response.body.data as { id: string; reference: string };
  };

  const submitReview = async (name: string) => {
    const response = await api()
      .post('/client-reviews')
      .set(auth(employeeToken))
      .send({
        kind: 'CREATION',
        name,
        phone: `663${String(10000 + sequence).padStart(5, '0')}`,
      });
    expect(response.status).toBe(201);
    return (response.body.data as { id: string }).id;
  };

  const decideReview = (
    id: string,
    action: 'approve' | 'reject',
    token = managerAToken,
  ) =>
    api()
      .post(`/client-reviews/${id}/${action}`)
      .set(auth(token))
      .send(action === 'reject' ? { reviewNotes: 'رفض للاختبار' } : {});

  const transfer = (
    managerUserId: string | null,
    token = ownerToken,
  ) =>
    api()
      .patch(`/employees/${employeeId}/manager`)
      .set(auth(token))
      .send({ managerUserId });

  const reviewList = async (token: string) => {
    const response = await api()
      .get('/client-reviews')
      .set(auth(token));
    expect(response.status).toBe(200);
    return response.body.data.items as ReviewRow[];
  };

  const countPending = async (token: string) => {
    const response = await api()
      .get('/client-reviews/count')
      .set(auth(token));
    expect(response.status).toBe(200);
    return response.body.data.pending as number;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    resetRateLimiting(ctx.app);
    sequence = 0;
    const owner = await createUser(ctx.prisma, {
      email: 'transfer.owner@test.local',
      name: 'Transfer Owner',
      role: Role.OWNER,
    });
    const managerA = await createUser(ctx.prisma, {
      email: 'transfer.manager.a@test.local',
      name: 'Manager Alpha',
      role: Role.MANAGER,
    });
    const managerB = await createUser(ctx.prisma, {
      email: 'transfer.manager.b@test.local',
      name: 'Manager Beta',
      role: Role.MANAGER,
    });
    const inactiveManager = await createUser(ctx.prisma, {
      email: 'transfer.manager.off@test.local',
      name: 'Inactive Manager',
      role: Role.MANAGER,
    });
    await ctx.prisma.user.update({
      where: { id: inactiveManager.id },
      data: { isActive: false },
    });
    const employee = await createUser(ctx.prisma, {
      email: 'transfer.employee@test.local',
      name: 'Mohamed Transfer',
      role: Role.EMPLOYEE,
      managerUserId: managerA.id,
    });
    managerAId = managerA.id;
    managerBId = managerB.id;
    inactiveManagerId = inactiveManager.id;
    employeeId = employee.id;
    ownerToken = await login(ctx.app, owner.email);
    managerAToken = await login(ctx.app, managerA.email);
    managerBToken = await login(ctx.app, managerB.email);
    employeeToken = await login(ctx.app, employee.email);
  });

  it('moves pending client reviews, preserves decided history, and notifies only the new manager', async () => {
    const pending1 = await submitReview('عميل معلق 1');
    const pending2 = await submitReview('عميل معلق 2');
    const approved = await submitReview('عميل معتمد');
    const rejected = await submitReview('عميل مرفوض');
    expect((await decideReview(approved, 'approve')).status).toBe(201);
    expect((await decideReview(rejected, 'reject')).status).toBe(201);
    await ctx.prisma.notification.deleteMany({});

    const moved = await transfer(managerBId);
    expect(moved.status).toBe(200);
    expect(moved.body.data.managerUserId).toBe(managerBId);

    const rows = await ctx.prisma.clientReviewRequest.findMany({
      select: {
        id: true,
        status: true,
        assignedReviewerId: true,
        reviewedById: true,
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(pending1)?.assignedReviewerId).toBe(managerBId);
    expect(byId.get(pending2)?.assignedReviewerId).toBe(managerBId);
    expect(byId.get(approved)?.assignedReviewerId).toBe(managerAId);
    expect(byId.get(rejected)?.assignedReviewerId).toBe(managerAId);
    expect(byId.get(approved)?.reviewedById).toBe(managerAId);
    expect(byId.get(rejected)?.reviewedById).toBe(managerAId);

    const managerARows = await reviewList(managerAToken);
    expect(managerARows.map((row) => row.id).sort()).toEqual(
      [approved, rejected].sort(),
    );
    expect(await countPending(managerAToken)).toBe(0);
    const managerBRows = await reviewList(managerBToken);
    expect(managerBRows.map((row) => row.id).sort()).toEqual(
      [pending1, pending2].sort(),
    );
    expect(await countPending(managerBToken)).toBe(2);
    expect(await reviewList(ownerToken)).toHaveLength(0);

    expect(
      (await api().get(`/client-reviews/${pending1}`).set(auth(managerAToken)))
        .status,
    ).toBe(404);
    expect(
      (await api().get(`/client-reviews/${pending1}`).set(auth(managerBToken)))
        .status,
    ).toBe(200);
    expect((await decideReview(pending1, 'approve', managerAToken)).status).toBe(
      404,
    );
    expect((await decideReview(pending1, 'approve', managerBToken)).status).toBe(
      201,
    );

    const afterTransfer = await submitReview('عميل بعد النقل');
    expect(
      (await reviewList(managerBToken)).some((row) => row.id === afterTransfer),
    ).toBe(true);
    expect(
      (await reviewList(managerAToken)).some((row) => row.id === afterTransfer),
    ).toBe(false);

    const managerBNotifications = await ctx.prisma.notification.findMany({
      where: { userId: managerBId, eventKey: { startsWith: 'REVIEW_TRANSFER:' } },
    });
    expect(managerBNotifications).toHaveLength(1);
    expect(
      await ctx.prisma.notification.count({
        where: {
          userId: managerAId,
          eventKey: { startsWith: 'REVIEW_TRANSFER:' },
        },
      }),
    ).toBe(0);

    const log = await api()
      .get('/notifications/system-log?limit=100')
      .set(auth(ownerToken));
    expect(log.status).toBe(200);
    const entry = (log.body.data.items as SystemLogItem[]).find(
      (row) =>
        row.action === 'EMPLOYEE_ASSIGN_MANAGER' &&
        row.entity?.id === employeeId,
    );
    expect(entry).toBeTruthy();
    expect(entry?.title).toContain('نقل الموظف Mohamed Transfer');
    expect(entry?.title).toContain('Manager Alpha');
    expect(entry?.title).toContain('Manager Beta');
    expect(entry?.description).toContain('2');
  });

  it('moves pending property review to the new manager and preserves historical reviewer', async () => {
    const pendingProperty = await createProperty();
    const historicalProperty = await createProperty();
    const approved = await api()
      .post(`/properties/${historicalProperty.id}/approve`)
      .set(auth(managerAToken))
      .send({});
    expect(approved.status).toBe(200);
    // OWNER cannot decide a managed employee's pending property review.
    expect(
      (
        await api()
          .post(`/properties/${pendingProperty.id}/approve`)
          .set(auth(ownerToken))
          .send({})
      ).status,
    ).toBe(403);
    await ctx.prisma.notification.deleteMany({});

    expect((await transfer(managerBId)).status).toBe(200);

    expect(
      (await api().get(`/properties/${pendingProperty.id}`).set(auth(managerAToken)))
        .status,
    ).toBe(404);
    expect(
      (await api().get(`/properties/${pendingProperty.id}`).set(auth(managerBToken)))
        .status,
    ).toBe(200);
    expect(
      (
        await api()
          .post(`/properties/${pendingProperty.id}/approve`)
          .set(auth(managerAToken))
          .send({})
      ).status,
    ).toBe(404);
    expect(
      (
        await api()
          .post(`/properties/${pendingProperty.id}/approve`)
          .set(auth(managerBToken))
          .send({})
      ).status,
    ).toBe(200);

    const historicalApproval =
      await ctx.prisma.propertyApprovalRequest.findFirstOrThrow({
        where: { propertyId: historicalProperty.id, status: 'APPROVED' },
        orderBy: { createdAt: 'desc' },
        select: { reviewedById: true },
      });
    expect(historicalApproval.reviewedById).toBe(managerAId);

    const freshProperty = await createProperty();
    expect(
      (await api().get(`/properties/${freshProperty.id}`).set(auth(managerAToken)))
        .status,
    ).toBe(404);
    expect(
      (
        await api()
          .post(`/properties/${freshProperty.id}/approve`)
          .set(auth(managerBToken))
          .send({})
      ).status,
    ).toBe(200);

    const notifications = await ctx.prisma.notification.findMany({
      where: { userId: managerBId, eventKey: { startsWith: 'REVIEW_TRANSFER:' } },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.body).toContain('طلب مراجعة معلّق واحد');
  });

  it('moves pending reviews to OWNER and back to a Manager with history split correctly', async () => {
    const firstPending = await submitReview('عميل إلى المالك');
    await ctx.prisma.notification.deleteMany({});
    expect((await transfer(null)).status).toBe(200);
    expect(
      (
        await ctx.prisma.clientReviewRequest.findUniqueOrThrow({
          where: { id: firstPending },
          select: { assignedReviewerId: true },
        })
      ).assignedReviewerId,
    ).toBeNull();
    expect(
      (await reviewList(ownerToken)).some((row) => row.id === firstPending),
    ).toBe(true);
    expect(
      (await reviewList(managerAToken)).some((row) => row.id === firstPending),
    ).toBe(false);
    expect((await decideReview(firstPending, 'approve', ownerToken)).status).toBe(
      201,
    );

    const directProperty = await createProperty();
    expect(
      (
        await api()
          .post(`/properties/${directProperty.id}/approve`)
          .set(auth(ownerToken))
          .send({})
      ).status,
    ).toBe(200);

    const secondPending = await submitReview('عميل عائد إلى مدير');
    expect((await transfer(managerBId)).status).toBe(200);
    expect(
      (
        await ctx.prisma.clientReviewRequest.findUniqueOrThrow({
          where: { id: secondPending },
          select: { assignedReviewerId: true },
        })
      ).assignedReviewerId,
    ).toBe(managerBId);
    const ownerRows = await reviewList(ownerToken);
    expect(ownerRows.some((row) => row.id === firstPending)).toBe(true);
    expect(ownerRows.some((row) => row.id === secondPending)).toBe(false);
    expect(
      (await reviewList(managerBToken)).some((row) => row.id === secondPending),
    ).toBe(true);

    const future = await submitReview('عميل مستقبلي');
    expect(
      (await reviewList(managerBToken)).some((row) => row.id === future),
    ).toBe(true);
    expect(
      (await reviewList(ownerToken)).some((row) => row.id === future),
    ).toBe(false);
  });

  it('rolls back completely for an invalid destination and denies MANAGER transfer', async () => {
    const review = await submitReview('عميل قبل نقل فاشل');
    await ctx.prisma.notification.deleteMany({});
    const auditBefore = await ctx.prisma.auditLog.count({
      where: { action: 'EMPLOYEE_ASSIGN_MANAGER', entityId: employeeId },
    });

    const inactive = await transfer(inactiveManagerId);
    expect(inactive.status).toBe(400);
    expect(String(inactive.body.error?.message ?? '')).toContain('غير نشط');
    const missing = await transfer(randomUUID());
    expect(missing.status).toBe(400);

    const profile = await ctx.prisma.employeeProfile.findUniqueOrThrow({
      where: { userId: employeeId },
      select: { managerUserId: true },
    });
    expect(profile.managerUserId).toBe(managerAId);
    expect(
      (
        await ctx.prisma.clientReviewRequest.findUniqueOrThrow({
          where: { id: review },
          select: { assignedReviewerId: true },
        })
      ).assignedReviewerId,
    ).toBe(managerAId);
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'EMPLOYEE_ASSIGN_MANAGER', entityId: employeeId },
      }),
    ).toBe(auditBefore);
    expect(
      await ctx.prisma.notification.count({
        where: { eventKey: { startsWith: 'REVIEW_TRANSFER:' } },
      }),
    ).toBe(0);

    const denied = await transfer(managerBId, managerAToken);
    expect(denied.status).toBe(403);
  });

  it('serializes repeated/concurrent transfers into one reassignment and one notification', async () => {
    const reviews = await Promise.all([
      submitReview('عميل متزامن 1'),
      submitReview('عميل متزامن 2'),
    ]);
    await ctx.prisma.notification.deleteMany({});
    const [first, second] = await Promise.all([
      transfer(managerBId),
      transfer(managerBId),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'EMPLOYEE_ASSIGN_MANAGER', entityId: employeeId },
      }),
    ).toBe(1);
    expect(
      await ctx.prisma.notification.count({
        where: {
          userId: managerBId,
          eventKey: { startsWith: 'REVIEW_TRANSFER:' },
        },
      }),
    ).toBe(1);
    const assigned = await ctx.prisma.clientReviewRequest.findMany({
      where: { id: { in: reviews } },
      select: { assignedReviewerId: true },
    });
    expect(assigned.every((row) => row.assignedReviewerId === managerBId)).toBe(
      true,
    );
    expect(await countPending(managerBToken)).toBe(2);
    expect(await countPending(managerAToken)).toBe(0);
  });
});
