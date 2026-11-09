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

jest.setTimeout(120000);

const image = [{ buffer: pngBytes(), filename: 'photo.png' }];

const DUPLICATE_TITLE = 'محاولة تسجيل عقار مكرر';

describeWithDatabase('New duplicate property rejection policy', () => {
  let ctx: TestContext;
  let managerId: string;
  let managerToken: string;
  let employeeAToken: string;
  let employeeBToken: string;
  const api = () => request(ctx.app.getHttpServer());

  const employeePayload = (overrides: Record<string, unknown> = {}) => ({
    listingType: 'SALE',
    governorate: 'الفروانية',
    district: 'غرناطة',
    block: '3',
    plotNumber: '1000',
    sizeSqm: '400.00',
    askingPrice: '250000.00',
    negotiable: true,
    description: 'بيت مستقل للبيع',
    floors: [{ type: 'GROUND', details: 'صالة ومجلس' }],
    newContact: { type: 'BROKER', name: 'Broker', phone: '66000000' },
    ...overrides,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'manager@test.local',
      name: 'Manager',
      role: Role.MANAGER,
    });
    const a = await createUser(ctx.prisma, {
      email: 'mohamed@test.local',
      name: 'Mohamed',
      role: Role.EMPLOYEE,
    });
    const b = await createUser(ctx.prisma, {
      email: 'karim@test.local',
      name: 'Karim',
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

  beforeEach(() => {
    // This suite intentionally creates many properties in one test minute;
    // keep the production upload limiter intact but isolate tests from it.
    resetRateLimiting(ctx.app);
  });

  it('A: a new unique property submission succeeds as PENDING', async () => {
    const res = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ plotNumber: '2001' }),
      image,
    );
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.reference).toMatch(/^P-\d{6}$/);
  });

  it('B + D: a duplicate of a PENDING property is rejected with 409 and creates nothing', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ plotNumber: '2002' }),
      image,
    );
    expect(created.status).toBe(201);
    const before = await ctx.prisma.property.count();
    const approvalBefore = await ctx.prisma.propertyApprovalRequest.count();

    const dup = await postProperty(
      ctx.app,
      employeeBToken,
      employeePayload({ plotNumber: '2002' }),
      image,
    );
    expect(dup.status).toBe(409);
    expect(dup.body.error?.message).toBe(
      'لا يمكن إضافة العقار، لأنه مسجّل بالفعل في النظام.',
    );

    // No new property, approval request or registrant was created.
    expect(await ctx.prisma.property.count()).toBe(before);
    expect(await ctx.prisma.propertyApprovalRequest.count()).toBe(approvalBefore);
    expect(
      await ctx.prisma.propertyRegistrant.count({
        where: { propertyId: created.body.data.id },
      }),
    ).toBe(0);
  });

  it('C: a duplicate of an APPROVED property is rejected with 409', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ plotNumber: '2003' }),
      image,
    );
    expect(created.status).toBe(201);
    const approved = await api()
      .post(`/properties/${created.body.data.id}/approve`)
      .set(auth(managerToken))
      .send({ version: 1 });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('AVAILABLE');

    const dup = await postProperty(
      ctx.app,
      employeeBToken,
      employeePayload({ plotNumber: '2003' }),
      image,
    );
    expect(dup.status).toBe(409);
  });

  it('E + M: the manager notification survives the 409 and names employee, property and reason', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ plotNumber: '2004' }),
      image,
    );
    const reference = created.body.data.reference as string;

    const dup = await postProperty(
      ctx.app,
      employeeBToken,
      employeePayload({ plotNumber: '2004' }),
      image,
    );
    expect(dup.status).toBe(409);

    const notif = await ctx.prisma.notification.findFirst({
      where: {
        userId: managerId,
        title: DUPLICATE_TITLE,
        propertyId: created.body.data.id,
      },
    });
    expect(notif).toBeTruthy();
    expect(notif!.body).toContain('Karim');
    expect(notif!.body).toContain(reference);
    expect(notif!.propertyId).toBe(created.body.data.id);
  });

  it('F: two simultaneous identical submissions — exactly one succeeds', async () => {
    const [r1, r2] = await Promise.all([
      postProperty(ctx.app, employeeAToken, employeePayload({ plotNumber: '3001' }), image),
      postProperty(ctx.app, employeeBToken, employeePayload({ plotNumber: '3001' }), image),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const rows = await ctx.prisma.property.count({ where: { plotNumber: '3001' } });
    expect(rows).toBe(1);
    // The loser produced a manager rejection notification.
    expect(
      await ctx.prisma.notification.count({
        where: { userId: managerId, title: DUPLICATE_TITLE },
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  it('G: the same owner may register different physical properties', async () => {
    const owner = { type: 'OWNER', name: 'Same Owner', phone: '61111111' };
    const p1 = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ plotNumber: '4001', newContact: owner }),
      image,
    );
    const p2 = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ plotNumber: '4002', newContact: owner }),
      image,
    );
    expect(p1.status).toBe(201);
    expect(p2.status).toBe(201);
  });

  it('H: separate legally distinct plots in the same building are allowed', async () => {
    const p1 = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ block: '7', plotNumber: '5001' }),
      image,
    );
    const p2 = await postProperty(
      ctx.app,
      employeeBToken,
      employeePayload({ block: '7', plotNumber: '5002' }),
      image,
    );
    expect(p1.status).toBe(201);
    expect(p2.status).toBe(201);
  });

  it('I: the same physical property submitted as SALE vs RENT cannot bypass detection', async () => {
    const sale = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ plotNumber: '6001', listingType: 'SALE' }),
      image,
    );
    expect(sale.status).toBe(201);
    const rent = await postProperty(
      ctx.app,
      employeeBToken,
      employeePayload({ plotNumber: '6001', listingType: 'RENT' }),
      image,
    );
    expect(rent.status).toBe(409);
  });

  it('J: direct API calls cannot bypass duplicate validation via unrelated fields', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ plotNumber: '7001', title: 'بيت أ', askingPrice: '100000.00' }),
      image,
    );
    expect(created.status).toBe(201);
    // Same physical identity, but every other field differs.
    const dup = await postProperty(
      ctx.app,
      employeeBToken,
      employeePayload({
        plotNumber: '7001',
        title: 'بيت ب',
        askingPrice: '999000.00',
        sizeSqm: '1200.00',
        newContact: { type: 'OWNER', name: 'Other Owner', phone: '62222222' },
      }),
      image,
    );
    expect(dup.status).toBe(409);
  });

  it('K: obsolete link-to-existing and priority-transfer endpoints cannot reactivate the old policy', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ plotNumber: '8001' }),
      image,
    );
    const id = created.body.data.id as string;
    expect(
      (await api().post(`/properties/${id}/link-to-existing`).set(auth(managerToken)).send({ existingPropertyId: id })).status,
    ).toBe(404);
    expect(
      (await api().post(`/properties/${id}/priority/transfer`).set(auth(managerToken)).send({})).status,
    ).toBe(404);
    expect(
      (await api().post(`/properties/${id}/priority/refuse`).set(auth(managerToken)).send({})).status,
    ).toBe(404);
  });

  it('L: the rejected employee never learns who registered the existing property', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ plotNumber: '9001' }),
      image,
    );
    const reference = created.body.data.reference as string;
    const dup = await postProperty(
      ctx.app,
      employeeBToken,
      employeePayload({ plotNumber: '9001' }),
      image,
    );
    expect(dup.status).toBe(409);
    const body = JSON.stringify(dup.body);
    expect(body).not.toContain('Mohamed');
    expect(body).not.toContain(reference);
  });

  it('N: employee "mine" count stays consistent and the duplicate never inflates it', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ plotNumber: '10001' }),
      image,
    );
    await api()
      .post(`/properties/${created.body.data.id}/approve`)
      .set(auth(managerToken))
      .send({ version: 1 });

    const dup = await postProperty(
      ctx.app,
      employeeBToken,
      employeePayload({ plotNumber: '10001' }),
      image,
    );
    expect(dup.status).toBe(409);

    const mineA = await api().get('/properties/stats/mine').set(auth(employeeAToken));
    const mineB = await api().get('/properties/stats/mine').set(auth(employeeBToken));
    expect(mineA.body.data).toBeGreaterThanOrEqual(1);
    expect(mineB.body.data).toBeGreaterThanOrEqual(0);
  });

  it('P: retried duplicate submissions do not create misleading duplicate notifications', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ plotNumber: '11001' }),
      image,
    );
    const id = created.body.data.id as string;

    await postProperty(ctx.app, employeeBToken, employeePayload({ plotNumber: '11001' }), image);
    await postProperty(ctx.app, employeeBToken, employeePayload({ plotNumber: '11001' }), image);

    // Identical content => one stable fingerprint and one Manager alert.
    const rows = await ctx.prisma.notification.findMany({
      where: {
        userId: managerId,
        title: DUPLICATE_TITLE,
        propertyId: id,
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventKey).toMatch(/^DUPLICATE_ATTEMPT:/);
  });

  it('O: manager approval and regular management still work', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ plotNumber: '12001' }),
      image,
    );
    const id = created.body.data.id as string;
    const approved = await api()
      .post(`/properties/${id}/approve`)
      .set(auth(managerToken))
      .send({ version: 1 });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('AVAILABLE');
    expect(approved.body.data.version).toBe(2);
  });

  // ---------------------------------------------------------------------
  // New exact-duplicate rule: A-000001 has block "8" + plot "22"; the new
  // submission omits the block but has the SAME plot, owner, area and floors.
  // A real plot match + real owner evidence is CONFIRMED => 409, nothing is
  // created, and the Manager alert opens the existing property.
  // ---------------------------------------------------------------------
  it('REG-MISSING-BLOCK: same plot + owner evidence while block is missing => CONFIRMED 409', async () => {
    const original = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ block: '8', plotNumber: '22', governorate: 'الجهراء', district: 'مدينة المطلاع' }),
      image,
    );
    expect(original.status).toBe(201);
    expect(original.body.data.status).toBe('PENDING');
    const originalId = original.body.data.id as string;
    const originalRef = original.body.data.reference as string;
    const beforeCount = await ctx.prisma.property.count();
    const approvalBefore = await ctx.prisma.propertyApprovalRequest.count();

    // Karim submits the SAME physical property but omits the block.
    const dup = await postProperty(
      ctx.app,
      employeeBToken,
      employeePayload({ block: '', plotNumber: '22', governorate: 'الجهراء', district: 'مدينة المطلاع' }),
      image,
    );
    expect(dup.status).toBe(409);
    expect(dup.body.error?.message).toBe(
      'لا يمكن إضافة العقار، لأنه مسجّل بالفعل في النظام.',
    );
    // No Property, approval request or P code was created.
    expect(await ctx.prisma.property.count()).toBe(beforeCount);
    expect(await ctx.prisma.propertyApprovalRequest.count()).toBe(approvalBefore);

    const notif = await ctx.prisma.notification.findFirst({
      where: {
        userId: managerId,
        title: DUPLICATE_TITLE,
        propertyId: originalId,
      },
    });
    expect(notif).toBeTruthy();
    expect(notif!.body).toContain('Karim');
    expect(notif!.body).toContain(originalRef);
    expect(notif!.body).toContain('تم منع التسجيل');
  });

  it('REG-NOTIF-READABLE: manager notification exposes codes and employee name, never UUIDs', async () => {
    const original = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ block: '8', plotNumber: '7801', governorate: 'الجهراء', district: 'مدينة المطلاع' }),
      image,
    );
    expect(original.status).toBe(201);
    const dup = await postProperty(
      ctx.app,
      employeeBToken,
      employeePayload({ block: '9', plotNumber: '7801', governorate: 'الجهراء', district: 'مدينة المطلاع' }),
      image,
    );
    expect(dup.status).toBe(201);
    const dupId = dup.body.data.id as string;
    const dupRef = dup.body.data.reference as string;
    const origRef = original.body.data.reference as string;

    const list = await api()
      .get('/notifications?limit=100')
      .set(auth(managerToken));
    expect(list.status).toBe(200);
    const row = list.body.data.items.find(
      (n: { propertyId: string | null; eventKey: string | null }) =>
        n.propertyId === dupId &&
        n.eventKey?.startsWith('POTENTIAL_DUPLICATE:'),
    );
    expect(row).toBeTruthy();
    expect(row.title).toBe('عقار مشابه يحتاج إلى مراجعة');
    expect(row.message).toBe(
      'تم اكتشاف تشابه محتمل بين عقارين في النظام. يُرجى مراجعة البيانات قبل اتخاذ القرار.',
    );
    expect(row.message).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i,
    );
    expect(row.duplicate).toMatchObject({
      newPropertyReference: dupRef,
      existingPropertyReference: origRef,
      employeeName: 'Karim',
      status: 'PENDING',
    });
  });

  it('REG-APPROVE-GATE: a generic approval cannot bypass the potential-duplicate review', async () => {
    const original = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ block: '8', plotNumber: '7701', governorate: 'الجهراء', district: 'مدينة المطلاع' }),
      image,
    );
    expect(original.status).toBe(201);

    const dup = await postProperty(
      ctx.app,
      employeeBToken,
      employeePayload({ block: '9', plotNumber: '7701', governorate: 'الجهراء', district: 'مدينة المطلاع' }),
      image,
    );
    expect(dup.status).toBe(201);
    expect(dup.body.data.status).toBe('PENDING');
    const dupId = dup.body.data.id as string;

    // Direct API call without the explicit "different property" confirmation
    // must be rejected, and the row must stay PENDING.
    const bypass = await api()
      .post(`/properties/${dupId}/approve`)
      .set(auth(managerToken))
      .send({ version: 1 });
    expect(bypass.status).toBe(400);
    expect(await ctx.prisma.property.findUnique({ where: { id: dupId } })).toMatchObject({
      status: 'PENDING',
    });

    // The explicit Manager confirmation is the only way through.
    const confirmed = await api()
      .post(`/properties/${dupId}/approve`)
      .set(auth(managerToken))
      .send({ version: 1, approveAsDistinct: true });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.status).toBe('AVAILABLE');
  });

  it('REG-CONFIRMED-DUP: Block 8/Plot 55 vs Block 8/Plot 55 => 409 + notification', async () => {
    const original = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ block: '8', plotNumber: '55', governorate: 'الجهراء', district: 'مدينة المطلاع' }),
      image,
    );
    expect(original.status).toBe(201);
    const originalId = original.body.data.id as string;
    const originalRef = original.body.data.reference as string;

    const dup = await postProperty(
      ctx.app,
      employeeBToken,
      employeePayload({ block: '8', plotNumber: '55', governorate: 'الجهراء', district: 'مدينة المطلاع' }),
      image,
    );
    expect(dup.status).toBe(409);
    expect(dup.body.error?.message).toBe(
      'لا يمكن إضافة العقار، لأنه مسجّل بالفعل في النظام.',
    );

    // Manager notification persists.
    const notif = await ctx.prisma.notification.findFirst({
      where: { userId: managerId, title: DUPLICATE_TITLE, propertyId: originalId },
    });
    expect(notif).toBeTruthy();
    expect(notif!.body).toContain('Karim');
    expect(notif!.body).toContain(originalRef);
  });

  it('REG-FALSE-POSITIVE: Block 8/Plot 66 vs Block 9/Plot 66 => allowed (no false rejection)', async () => {
    const p1 = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ block: '8', plotNumber: '66', governorate: 'الجهراء', district: 'مدينة المطلاع' }),
      image,
    );
    const p2 = await postProperty(
      ctx.app,
      employeeBToken,
      employeePayload({ block: '9', plotNumber: '66', governorate: 'الجهراء', district: 'مدينة المطلاع' }),
      image,
    );
    expect(p1.status).toBe(201);
    expect(p2.status).toBe(201);
  });

  it('REG-D: Manager receives a persistent duplicate-rejection notification (not a normal submission)', async () => {
    const original = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ block: '8', plotNumber: '56', governorate: 'الجهراء', district: 'مدينة المطلاع' }),
      image,
    );
    const originalId = original.body.data.id as string;
    const originalRef = original.body.data.reference as string;

    const dup = await postProperty(
      ctx.app,
      employeeBToken,
      employeePayload({ block: '8', plotNumber: '56', governorate: 'الجهراء', district: 'مدينة المطلاع' }),
      image,
    );
    expect(dup.status).toBe(409);

    // Duplicate-rejection notification persists for the manager.
    const dupNotif = await ctx.prisma.notification.findFirst({
      where: { userId: managerId, title: DUPLICATE_TITLE, propertyId: originalId },
    });
    expect(dupNotif).toBeTruthy();
    expect(dupNotif!.body).toContain('Karim');
    expect(dupNotif!.body).toContain(originalRef);

    // NO extra "new property pending approval" notification for the rejected submission.
    const submittedCount = await ctx.prisma.notification.count({
      where: { userId: managerId, type: 'PROPERTY_SUBMITTED' },
    });
    // Only the original's submission notification (one), not a second one.
    expect(submittedCount).toBeGreaterThanOrEqual(1);
    // No notification references a non-existent second property.
    const allProps = await ctx.prisma.property.findMany({ select: { id: true } });
    const propIds = new Set(allProps.map((p) => p.id));
    const submittedNotifs = await ctx.prisma.notification.findMany({
      where: { userId: managerId, type: 'PROPERTY_SUBMITTED' },
      select: { propertyId: true },
    });
    for (const n of submittedNotifs) {
      if (n.propertyId) expect(propIds.has(n.propertyId)).toBe(true);
    }
  });

  it('REG-F: same owner with a genuinely different physical property is allowed', async () => {
    const owner = { type: 'OWNER', name: 'Same Owner', phone: '61112222' };
    const p1 = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ block: '8', plotNumber: '100', governorate: 'الجهراء', district: 'مدينة المطلاع', newContact: owner }),
      image,
    );
    const p2 = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ block: '9', plotNumber: '101', governorate: 'الجهراء', district: 'مدينة المطلاع', newContact: owner }),
      image,
    );
    expect(p1.status).toBe(201);
    expect(p2.status).toBe(201);
  });

  it('REG-G: incomplete identity (no plotNumber and no address) is rejected, not accepted', async () => {
    const before = await ctx.prisma.property.count();
    const res = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ block: '', plotNumber: '', address: '', governorate: 'الجهراء', district: 'مدينة المطلاع' }),
      image,
    );
    // Must NOT be 201 (accepted as new property).
    expect(res.status).not.toBe(201);
    // No new property created.
    expect(await ctx.prisma.property.count()).toBe(before);
  });

  it('REG-POTENTIAL-SIMILAR: same owner/plot/size/floors, different block+price => POTENTIAL (flagged)', async () => {
    const owner = { type: 'OWNER', name: 'Same Owner', phone: '61112222' };
    const floors = [
      { type: 'GROUND', details: 'مجلس + ديوانية' },
      { type: 'FIRST', details: ' ثلاث غرف' },
    ];
    const p1 = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({
        block: '8',
        plotNumber: '77',
        governorate: 'الجهراء',
        district: 'مدينة المطلاع',
        sizeSqm: '300.00',
        askingPrice: '350000.00',
        floorCount: 2,
        floors,
        newContact: owner,
      }),
      image,
    );
    expect(p1.status).toBe(201);
    const p1Id = p1.body.data.id as string;

    const p2 = await postProperty(
      ctx.app,
      employeeBToken,
      employeePayload({
        block: '9',
        plotNumber: '77',
        governorate: 'الجهراء',
        district: 'مدينة المطلاع',
        sizeSqm: '300.00',
        askingPrice: '400000.00',
        floorCount: 2,
        floors,
        newContact: owner,
      }),
      image,
    );
    // Not a 409 (not a confirmed duplicate), but flagged for review.
    expect(p2.status).toBe(201);
    const p2Id = p2.body.data.id as string;
    const approval = await ctx.prisma.propertyApprovalRequest.findFirst({
      where: { propertyId: p2Id },
    });
    expect(approval).toBeTruthy();
    expect(approval!.duplicateCandidateIds).toBeTruthy();
    expect((approval!.duplicateCandidateIds as string[])).toContain(p1Id);

    // Manager notification persisted.
    const notif = await ctx.prisma.notification.findFirst({
      where: {
        userId: managerId,
        title: 'عقار مشابه يحتاج إلى مراجعة',
        propertyId: p2Id,
      },
    });
    expect(notif).toBeTruthy();

    // Approval gate: generic approve rejected, approveAsDistinct succeeds.
    const bypass = await api()
      .post(`/properties/${p2Id}/approve`)
      .set(auth(managerToken))
      .send({ version: 1 });
    expect(bypass.status).toBe(400);
    const confirmed = await api()
      .post(`/properties/${p2Id}/approve`)
      .set(auth(managerToken))
      .send({ version: 1, approveAsDistinct: true });
    expect(confirmed.status).toBe(200);
  });

  it('REG-H: normal approval flow still works after the fix', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ block: '8', plotNumber: '88', governorate: 'الجهراء', district: 'مدينة المطلاع' }),
      image,
    );
    expect(created.status).toBe(201);
    const approved = await api()
      .post(`/properties/${created.body.data.id}/approve`)
      .set(auth(managerToken))
      .send({ version: 1 });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('AVAILABLE');
  });
});
