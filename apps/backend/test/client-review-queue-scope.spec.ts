import { Prisma } from '@prisma/client';
import { Role } from '@arkan/shared';
import request from 'supertest';
import {
  auth,
  createTestApp,
  createUser,
  describeWithDatabase,
  login,
  resetDatabase,
  type TestContext,
} from './support/test-app';

jest.setTimeout(180000);

interface ReviewSummary {
  id: string;
  status: string;
  clientName: string;
}

interface SystemLogItem {
  id: string;
  action: string;
  details: { type: 'CLIENT_REVIEW' | 'PROPERTY'; id: string } | null;
}

describeWithDatabase('Client review direct-supervisor queue', () => {
  let ctx: TestContext;
  let ownerId: string;
  let managerAId: string;
  let managerBId: string;
  let employeeAId: string;
  let directEmployeeId: string;
  let inactiveEmployeeId: string;
  let ownerToken: string;
  let managerAToken: string;
  let managerBToken: string;
  let employeeAToken: string;
  let directToken: string;
  let inactiveToken: string;
  let seq = 0;

  const api = () => request(ctx.app.getHttpServer());

  const submitReview = (token: string, name: string) =>
    api().post('/client-reviews').set(auth(token)).send({
      kind: 'CREATION',
      name,
      phone: `971${String(10000 + ++seq).padStart(5, '0')}`,
      notes: 'طلب مراجعة لاختبار نطاق الطابور',
    });

  const listReviews = async (token: string): Promise<ReviewSummary[]> => {
    const response = await api()
      .get('/client-reviews')
      .set(auth(token));
    expect(response.status).toBe(200);
    return response.body.data.items as ReviewSummary[];
  };

  const pendingCount = async (token: string): Promise<number> => {
    const response = await api()
      .get('/client-reviews/count')
      .set(auth(token));
    expect(response.status).toBe(200);
    return response.body.data.pending as number;
  };

  const inbox = async (token: string) => {
    const response = await api()
      .get('/notifications?limit=100')
      .set(auth(token));
    expect(response.status).toBe(200);
    return response.body.data.items as Array<{ type: string }>;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const owner = await createUser(ctx.prisma, {
      email: 'queue.owner@test.local',
      name: 'Queue Owner',
      role: Role.OWNER,
    });
    const managerA = await createUser(ctx.prisma, {
      email: 'queue.manager.a@test.local',
      name: 'Queue Manager A',
      role: Role.MANAGER,
    });
    const managerB = await createUser(ctx.prisma, {
      email: 'queue.manager.b@test.local',
      name: 'Queue Manager B',
      role: Role.MANAGER,
    });
    const employeeA = await createUser(ctx.prisma, {
      email: 'queue.employee.a@test.local',
      name: 'Queue Employee A',
      role: Role.EMPLOYEE,
      managerUserId: managerA.id,
    });
    const direct = await createUser(ctx.prisma, {
      email: 'queue.direct@test.local',
      name: 'Queue Direct Owner Employee',
      role: Role.EMPLOYEE,
      managerUserId: null,
    });
    const inactiveManager = await createUser(ctx.prisma, {
      email: 'queue.manager.inactive@test.local',
      name: 'Queue Inactive Manager',
      role: Role.MANAGER,
    });
    await ctx.prisma.user.update({
      where: { id: inactiveManager.id },
      data: { isActive: false },
    });
    const inactiveEmployee = await createUser(ctx.prisma, {
      email: 'queue.employee.inactive@test.local',
      name: 'Queue Inactive Managed Employee',
      role: Role.EMPLOYEE,
      managerUserId: inactiveManager.id,
    });
    ownerId = owner.id;
    managerAId = managerA.id;
    managerBId = managerB.id;
    employeeAId = employeeA.id;
    directEmployeeId = direct.id;
    inactiveEmployeeId = inactiveEmployee.id;
    ownerToken = await login(ctx.app, owner.email);
    managerAToken = await login(ctx.app, managerA.email);
    managerBToken = await login(ctx.app, managerB.email);
    employeeAToken = await login(ctx.app, employeeA.email);
    directToken = await login(ctx.app, direct.email);
    inactiveToken = await login(ctx.app, inactiveEmployee.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.prisma.notification.deleteMany({});
    await ctx.prisma.clientReviewRequest.deleteMany({});
  });

  it('shows a managed employee review to Manager A only and keeps it out of the OWNER queue', async () => {
    const submitted = await submitReview(employeeAToken, 'عميل تابع لمدير أ');
    expect(submitted.status).toBe(201);
    const reviewId = (submitted.body.data as { id: string }).id;

    expect((await listReviews(managerAToken)).some((row) => row.id === reviewId)).toBe(true);
    expect(await pendingCount(managerAToken)).toBe(1);
    expect(
      (await api().get(`/client-reviews/${reviewId}`).set(auth(managerAToken)))
        .status,
    ).toBe(200);

    expect((await listReviews(managerBToken)).some((row) => row.id === reviewId)).toBe(false);
    expect(await pendingCount(managerBToken)).toBe(0);
    expect(
      (await api().get(`/client-reviews/${reviewId}`).set(auth(managerBToken)))
        .status,
    ).toBe(404);
    expect(
      (
        await api()
          .post(`/client-reviews/${reviewId}/approve`)
          .set(auth(managerBToken))
          .send({})
      ).status,
    ).toBe(404);

    expect((await listReviews(ownerToken)).some((row) => row.id === reviewId)).toBe(false);
    expect(await pendingCount(ownerToken)).toBe(0);
    expect(
      (await api().get(`/client-reviews/${reviewId}`).set(auth(ownerToken)))
        .status,
    ).toBe(404);
    for (const action of ['approve', 'reject', 'request-changes']) {
      expect(
        (
          await api()
            .post(`/client-reviews/${reviewId}/${action}`)
            .set(auth(ownerToken))
            .send({ reviewNotes: null })
        ).status,
      ).toBe(404);
    }

    // System Log's OWNER-only read-through remains available and read-only.
    expect(
      (
        await api()
          .get(`/client-reviews/${reviewId}/owner-detail`)
          .set(auth(ownerToken))
      ).status,
    ).toBe(200);
    expect(
      (
        await api()
          .get(`/client-reviews/${reviewId}/owner-detail`)
          .set(auth(managerAToken))
      ).status,
    ).toBe(403);
    expect(
      (
        await api()
          .get(`/client-reviews/${reviewId}/owner-detail`)
          .set(auth(employeeAToken))
      ).status,
    ).toBe(403);

    const log = await api()
      .get('/notifications/system-log?limit=100')
      .set(auth(ownerToken));
    expect(log.status).toBe(200);
    const entry = (log.body.data.items as SystemLogItem[]).find(
      (row) =>
        row.action === 'CLIENT_REVIEW_SUBMIT' &&
        row.details?.type === 'CLIENT_REVIEW' &&
        row.details.id === reviewId,
    );
    expect(entry).toBeTruthy();

    // Approved and rejected history keeps the same Manager-only scope.
    const approved = await api()
      .post(`/client-reviews/${reviewId}/approve`)
      .set(auth(managerAToken))
      .send({});
    expect(approved.status).toBe(201);
    expect(
      (await listReviews(managerAToken)).find((row) => row.id === reviewId)
        ?.status,
    ).toBe('APPROVED');
    expect((await listReviews(ownerToken)).some((row) => row.id === reviewId)).toBe(false);
    expect(await pendingCount(ownerToken)).toBe(0);

    const second = await submitReview(employeeAToken, 'عميل مرفوض لمدير أ');
    const secondId = (second.body.data as { id: string }).id;
    const rejected = await api()
      .post(`/client-reviews/${secondId}/reject`)
      .set(auth(managerAToken))
      .send({ reviewNotes: 'سبب رفض للاختبار' });
    expect(rejected.status).toBe(201);
    expect(
      (await listReviews(managerAToken)).find((row) => row.id === secondId)
        ?.status,
    ).toBe('REJECTED');
    expect((await listReviews(ownerToken)).some((row) => row.id === secondId)).toBe(false);
    expect(await pendingCount(ownerToken)).toBe(0);
    expect(await pendingCount(managerAToken)).toBe(0);
  });

  it('routes a directly-assigned employee review to OWNER only', async () => {
    const submitted = await submitReview(directToken, 'عميل تابع للمالك');
    expect(submitted.status).toBe(201);
    const reviewId = (submitted.body.data as { id: string }).id;

    expect((await listReviews(ownerToken)).some((row) => row.id === reviewId)).toBe(true);
    expect(await pendingCount(ownerToken)).toBe(1);
    expect(
      (await api().get(`/client-reviews/${reviewId}`).set(auth(ownerToken)))
        .status,
    ).toBe(200);
    expect((await listReviews(managerAToken)).some((row) => row.id === reviewId)).toBe(false);
    expect(await pendingCount(managerAToken)).toBe(0);

    const approved = await api()
      .post(`/client-reviews/${reviewId}/approve`)
      .set(auth(ownerToken))
      .send({});
    expect(approved.status).toBe(201);
    const detail = await api()
      .get(`/client-reviews/${reviewId}`)
      .set(auth(ownerToken));
    expect(detail.status).toBe(200);
    expect((detail.body.data as { status: string }).status).toBe('APPROVED');
    expect(await pendingCount(ownerToken)).toBe(0);
  });

  it('keeps a manager-submitted review in the existing OWNER workflow', async () => {
    const seed = await submitReview(directToken, 'بذرة طلب مدير');
    const seedId = (seed.body.data as { id: string }).id;
    const seedRow = await ctx.prisma.clientReviewRequest.findUniqueOrThrow({
      where: { id: seedId },
      select: { payload: true },
    });
    const managerReview = await ctx.prisma.clientReviewRequest.create({
      data: {
        kind: 'CREATION',
        status: 'PENDING',
        payload: seedRow.payload as Prisma.InputJsonValue,
        requestedById: managerAId,
      },
      select: { id: true },
    });
    await ctx.prisma.notification.deleteMany({
      where: { clientReviewId: seedId },
    });
    await ctx.prisma.clientReviewRequest.delete({ where: { id: seedId } });

    expect(
      (await listReviews(ownerToken)).some((row) => row.id === managerReview.id),
    ).toBe(true);
    expect(await pendingCount(ownerToken)).toBe(1);
    expect(
      (await listReviews(managerAToken)).some((row) => row.id === managerReview.id),
    ).toBe(false);
    expect(
      (await api().get(`/client-reviews/${managerReview.id}`).set(auth(ownerToken)))
        .status,
    ).toBe(200);
    const approved = await api()
      .post(`/client-reviews/${managerReview.id}/approve`)
      .set(auth(ownerToken))
      .send({});
    expect(approved.status).toBe(201);
  });

  it('fails safely without OWNER fallback when the assigned Manager is inactive', async () => {
    const submitted = await submitReview(inactiveToken, 'عميل بلا مدير نشط');
    expect(submitted.status).toBe(400);
    expect(String(submitted.body.error?.message ?? '')).toContain(
      'المشرف المباشر غير نشط',
    );
    expect(await ctx.prisma.clientReviewRequest.count()).toBe(0);
    expect(await pendingCount(ownerToken)).toBe(0);
    expect(await listReviews(ownerToken)).toHaveLength(0);
    expect(await listReviews(managerAToken)).toHaveLength(0);
    expect(await listReviews(managerBToken)).toHaveLength(0);
  });

  it('keeps notification routing direct with no duplicate review notification', async () => {
    const managed = await submitReview(employeeAToken, 'عميل إشعار مدير');
    expect(managed.status).toBe(201);
    const managedId = (managed.body.data as { id: string }).id;
    const managerTypes = (await inbox(managerAToken)).filter(
      (item) => item.type === 'CLIENT_REVIEW_SUBMITTED',
    );
    expect(managerTypes).toHaveLength(1);
    expect(await inbox(ownerToken)).toHaveLength(0);

    const direct = await submitReview(directToken, 'عميل إشعار مالك');
    expect(direct.status).toBe(201);
    const directId = (direct.body.data as { id: string }).id;
    expect(
      (await inbox(ownerToken)).filter(
        (item) => item.type === 'CLIENT_REVIEW_SUBMITTED',
      ),
    ).toHaveLength(1);
    expect(
      (await inbox(managerAToken)).filter(
        (item) => item.type === 'CLIENT_REVIEW_SUBMITTED',
      ),
    ).toHaveLength(1);

    expect(
      await ctx.prisma.notification.count({
        where: {
          clientReviewId: { in: [managedId, directId] },
        },
      }),
    ).toBe(2);
    expect(ownerId).toBeTruthy();
    expect(employeeAId).toBeTruthy();
    expect(directEmployeeId).toBeTruthy();
    expect(inactiveEmployeeId).toBeTruthy();
    expect(managerBId).toBeTruthy();
  });
});
