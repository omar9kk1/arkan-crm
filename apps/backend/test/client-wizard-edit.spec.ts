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

/**
 * The 4-step wizard EDIT flow in the REVIEWED era: an employee no longer
 * saves over `PATCH /clients/:id` — the SAME wizard payload is staged as an
 * EDIT review and ONLY a manager approval writes it.
 *
 * Verified: same client id across the flow, approved data untouched while
 * pending, true prefill data (legacy requestData = null still round-trips
 * name/phone/notes), structured-request diffs with budget/area wording and
 * WITHOUT any private value, explicit property replacement/removal confined
 * to the reviewed client, RBAC 404 without disclosure, and the bypass guard
 * (employee direct POST/PATCH → 403).
 */
describeWithDatabase('Wizard edit mode staged as a client review', () => {
  let ctx: TestContext;
  let managerToken: string;
  let employeeAToken: string;
  let employeeBToken: string;
  let employeeAId: string;
  let employeeBId: string;

  const api = () => request(ctx.app.getHttpServer());

  /** A manager-registered client assigned to an employee (authorized edits). */
  const managerClient = async (
    responsibleUserId: string,
    payload: Record<string, unknown>,
  ) => {
    const response = await api()
      .post('/clients')
      .set(auth(managerToken))
      .send({ ...payload, responsibleUserId });
    expect(response.status).toBe(201);
    return response.body.data as {
      id: string;
      name: string;
      phone: string;
      notes: string;
      requestData: string | null;
      propertyInterests: { propertyId: string }[];
    };
  };

  const submitReview = (token: string, payload: Record<string, unknown>) =>
    api().post('/client-reviews').set(auth(token)).send(payload);

  /** A structured BUYER request with a parsed free-text ask. */
  const buyerPack = (budget: string, area: string, message: string): string =>
    JSON.stringify({
      version: 1,
      types: ['BUYER'],
      requests: {
        BUYER: {
          name: 'x',
          phone: 'x',
          notes: '',
          clientType: 'BUYER',
          interest: { hasLinkedProperty: false, hasNewRequest: true },
          linkedProperty: {
            propertyId: '',
            property: null,
            reason: '',
            notes: '',
          },
          message,
          requestDetails: {
            desiredProperty: {
              governorate: 'الكويت',
              area,
              propertyType: 'فيلا',
              operationType: 'شراء',
              budget,
              size: '',
              roomsOrFloor: '',
              duration: '',
              specifications: '',
              notes: '',
            },
            customFields: [],
          },
        },
      },
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'manager@wizedit.local',
      name: 'مدير تعديل الطلبات',
      role: Role.MANAGER,
    });
    const employeeA = await createUser(ctx.prisma, {
      email: 'employee.a@wizedit.local',
      name: 'موظف تعديل الطلبات',
      role: Role.EMPLOYEE,
    });
    const employeeB = await createUser(ctx.prisma, {
      email: 'employee.b@wizedit.local',
      name: 'موظف ثانٍ للطلبات',
      role: Role.EMPLOYEE,
    });
    employeeAId = employeeA.id;
    employeeBId = employeeB.id;
    await ctx.prisma.employeeProfile.create({ data: { userId: employeeA.id } });
    await ctx.prisma.employeeProfile.create({ data: { userId: employeeB.id } });
    managerToken = await login(ctx.app, manager.email);
    employeeAToken = await login(ctx.app, employeeA.email);
    employeeBToken = await login(ctx.app, employeeB.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('blocks the direct write paths for employees — 403 with review guidance', async () => {
    const posted = await api()
      .post('/clients')
      .set(auth(employeeAToken))
      .send({ name: 'عميل مباشر مرفوض', phone: '66001200' });
    expect(posted.status).toBe(403);
    expect(
      await ctx.prisma.client.count({ where: { phone: '66001200' } }),
    ).toBe(0);
    const client = await managerClient(employeeAId, {
      name: 'عميل التعديل المباشر',
      phone: '66001201',
    });
    const patched = await api()
      .patch(`/clients/${client.id}`)
      .set(auth(employeeAToken))
      .send({ requestData: buyerPack('1000', 'x', 'y') });
    expect(patched.status).toBe(403);
    const row = await ctx.prisma.client.findUnique({ where: { id: client.id } });
    expect(row?.requestData).toBeNull();
  });

  it('edits the SAME client row via approval: id preserved, follow-ups and legacy notes intact', async () => {
    const created = await managerClient(employeeAId, {
      name: 'طالب الطلب الحالي',
      phone: '66001001',
      notes: 'ملاحظة بشرية قديمة 4321',
    });
    await api()
      .post(`/clients/${created.id}/follow-ups`)
      .set(auth(employeeAToken))
      .send({ dueAt: '2099-01-01', method: 'اتصال', outcome: 'تم التواصل' });
    const followUpsBefore = await ctx.prisma.followUp.count({
      where: { clientId: created.id },
    });
    const clientsBefore = await ctx.prisma.client.count();

    const submitted = await submitReview(employeeAToken, {
      kind: 'EDIT',
      clientId: created.id,
      name: 'طالب الطلب الحالي',
      phone: '66001001',
      notes: 'ملاحظة بشرية قديمة 4321',
      requestData: buyerPack('90000', 'الدسمة', 'اريد فيلا في الدسمة'),
    });
    expect(submitted.status).toBe(201);

    // DURING the review the approved row is untouched — no half-saved state.
    const pendingRow = await ctx.prisma.client.findUnique({
      where: { id: created.id },
    });
    expect(pendingRow?.requestData).toBeNull();

    const reviewId = (submitted.body.data as { id: string }).id;
    const approval = await api()
      .post(`/client-reviews/${reviewId}/approve`)
      .set(auth(managerToken))
      .send({});
    expect(approval.status).toBe(201);
    expect((approval.body.data as { clientId: string }).clientId).toBe(
      created.id,
    );

    const fresh = await api().get(`/clients/${created.id}`).set(auth(employeeAToken));
    const dto = fresh.body.data as typeof created;
    expect(dto.id).toBe(created.id);
    expect(dto.requestData).toContain('"BUYER"');
    // Legacy notes survive EXACTLY (structured request lives beside them).
    expect(dto.notes).toBe('ملاحظة بشرية قديمة 4321');
    expect(await ctx.prisma.client.count()).toBe(clientsBefore);
    expect(
      await ctx.prisma.followUp.count({ where: { clientId: created.id } }),
    ).toBe(followUpsBefore);
  });

  it('prefills from the APPROVED row only: GET round-trips the stored document; a pending proposal never leaks into it', async () => {
    const created = await managerClient(employeeAId, {
      name: 'عميل التعبئة',
      phone: '66001002',
    });
    const doc = buyerPack('70000', 'الجرة', 'طلب عادي');
    // The manager seeds the approved request document (direct path works).
    const patched = await api()
      .patch(`/clients/${created.id}`)
      .set(auth(managerToken))
      .send({ requestData: doc });
    expect(patched.status).toBe(200);

    // The employee stages ANOTHER change — the prefill source stays approved.
    const submitted = await submitReview(employeeAToken, {
      kind: 'EDIT',
      clientId: created.id,
      name: 'عميل التعبئة',
      phone: '66001002',
      requestData: buyerPack('99000', 'الشامية', 'طلب معدّل'),
    });
    expect(submitted.status).toBe(201);

    const fresh = await api().get(`/clients/${created.id}`).set(auth(employeeAToken));
    const dto = fresh.body.data as typeof created;
    expect(dto.requestData).toBe(doc);
    expect(JSON.stringify(dto)).not.toContain('99000');
  });

  it('shows the manager the REAL changed request fields in the review diff — values non-sensitive only', async () => {
    const created = await managerClient(employeeAId, {
      name: 'كاتب الطلب المحرر',
      phone: '66001003',
      notes: 'يحتاج اتمام الصفقة سريعًا',
    });
    const seed = await api()
      .patch(`/clients/${created.id}`)
      .set(auth(managerToken))
      .send({ requestData: buyerPack('80000', 'الدسمة', 'اريد فيلا الدسمة سري 7777') });
    expect(seed.status).toBe(200);
    const submitted = await submitReview(employeeAToken, {
      kind: 'EDIT',
      clientId: created.id,
      name: 'كاتب الطلب المحرر',
      phone: '66001003',
      notes: 'يحتاج اتمام الصفقة سريعًا',
      requestData: buyerPack('95000', 'الشامية', 'ملاحظة جديدة سرية 8888'),
    });
    expect(submitted.status).toBe(201);
    const reviewId = (submitted.body.data as { id: string }).id;

    const detail = await api()
      .get(`/client-reviews/${reviewId}`)
      .set(auth(managerToken));
    expect(detail.status).toBe(200);
    const diff = (detail.body.data as { diff: string[] }).diff.join(' ');
    // Range wording with the exact values the manager must approve.
    expect(diff).toContain('الميزانية: من 80000 إلى 95000');
    expect(diff).toContain('المنطقة: من الدسمة إلى الشامية');
    expect(diff).toContain('تم تعديل تفاصيل طلب مشتري');
    // The free message, its private note and the phone NEVER travel.
    expect(diff).not.toContain('7777');
    expect(diff).not.toContain('8888');
    expect(diff).not.toContain('66001003');
    expect(diff).not.toContain('اتمام الصفقة');

    // The notification bell carries SUBMISSION events only — no CLIENT_UPDATED.
    const inbox = await api()
      .get('/notifications?limit=100')
      .set(auth(managerToken));
    const types = (
      inbox.body.data as { items: { type: string; message: string }[] }
    ).items.map((item) => item.type);
    expect(types).toContain('CLIENT_REVIEW_SUBMITTED');
    expect(types).not.toContain('CLIENT_UPDATED');
    const submittedRow = (
      inbox.body.data as { items: { type: string; message: string }[] }
    ).items.find((item) => item.type === 'CLIENT_REVIEW_SUBMITTED');
    expect(JSON.stringify(submittedRow)).not.toContain('7777');
    expect(JSON.stringify(submittedRow)).not.toContain('8888');
    expect(JSON.stringify(submittedRow)).not.toContain('66001003');
  });

  it('removes a request type with an explicit null proposal — approval clears the document', async () => {
    const client = await managerClient(employeeAId, {
      name: 'ساحب الطلب',
      phone: '66001004',
    });
    // The manager seeds the approved request document (direct path works).
    const seed = await api()
      .patch(`/clients/${client.id}`)
      .set(auth(managerToken))
      .send({ requestData: buyerPack('50000', 'حولي', 'طلب مبدئي') });
    expect(seed.status).toBe(200);
    const submitted = await submitReview(employeeAToken, {
      kind: 'EDIT',
      clientId: client.id,
      name: 'ساحب الطلب',
      phone: '66001004',
      requestData: null,
    });
    expect(submitted.status).toBe(201);
    const reviewId = (submitted.body.data as { id: string }).id;

    const detail = await api()
      .get(`/client-reviews/${reviewId}`)
      .set(auth(employeeAToken));
    expect(
      (detail.body.data as { diff: string[] }).diff.join(' '),
    ).toContain('أُزيل نوع الطلب: مشتري');

    const approval = await api()
      .post(`/client-reviews/${reviewId}/approve`)
      .set(auth(managerToken))
      .send({});
    expect(approval.status).toBe(201);
    const row = await ctx.prisma.client.findUnique({ where: { id: client.id } });
    // requestData cleared EXACTLY (not a rewrite of anything else).
    expect(row?.requestData).toBeNull();
    expect(row?.name).toBe('ساحب الطلب');
  });

  it('replaces a linked property only by explicit choice — remove + upsert applied at approval', async () => {
    const propA = await ctx.prisma.property.create({
      data: {
        reference: 'A-100002',
        title: 'عقار الاستفسار الأول',
        area: 'الدسمة',
        currency: 'KWD',
        listingType: 'SALE',
        status: 'AVAILABLE',
      },
    });
    const propB = await ctx.prisma.property.create({
      data: {
        reference: 'A-100003',
        title: 'عقار الاستفسار الثاني',
        area: 'حولي',
        currency: 'KWD',
        listingType: 'RENT',
        status: 'AVAILABLE',
      },
    });
    const client = await managerClient(employeeAId, {
      name: 'مستبدل العقار',
      phone: '66001006',
      propertyInterests: [{ propertyId: propA.id, reason: 'قديم', notes: '' }],
    });
    const submitted = await submitReview(employeeAToken, {
      kind: 'EDIT',
      clientId: client.id,
      name: 'مستبدل العقار',
      phone: '66001006',
      addInterests: [
        { propertyId: propB.id, reason: 'الجديد', notes: 'ملاحظة' },
      ],
      removeInterests: [propA.id],
    });
    expect(submitted.status).toBe(201);
    const reviewId = (submitted.body.data as { id: string }).id;
    const approval = await api()
      .post(`/client-reviews/${reviewId}/approve`)
      .set(auth(managerToken))
      .send({});
    expect(approval.status).toBe(201);

    // Replace: propB linked, propA dropped — one explicit user choice.
    const interests = await ctx.prisma.clientPropertyInterest.findMany({
      where: { clientId: client.id },
    });
    expect(interests.map((row) => row.propertyId)).toEqual([propB.id]);
    expect(interests[0]?.reason).toBe('الجديد');
    expect(
      await ctx.prisma.clientPropertyInterest.count({
        where: { propertyId: propA.id },
      }),
    ).toBe(0);
  });

  it('confines removals to THIS client — another employee interest is untouched', async () => {
    const shared = await ctx.prisma.property.create({
      data: {
        reference: 'A-100004',
        title: 'عقار مشترك للاختبار',
        area: 'المنقف',
        currency: 'KWD',
        listingType: 'SALE',
        status: 'AVAILABLE',
      },
    });
    const foreignClient = await managerClient(employeeBId, {
      name: 'عميل الموظف الآخر',
      phone: '66001007',
      propertyInterests: [{ propertyId: shared.id, reason: 'y' }],
    });
    const mine = await managerClient(employeeAId, {
      name: 'عميلي المحصور',
      phone: '66001008',
    });
    const submitted = await submitReview(employeeAToken, {
      kind: 'EDIT',
      clientId: mine.id,
      name: 'عميلي المحصور',
      phone: '66001008',
      removeInterests: [shared.id],
    });
    expect(submitted.status).toBe(201);
    const reviewId = (submitted.body.data as { id: string }).id;
    const approval = await api()
      .post(`/client-reviews/${reviewId}/approve`)
      .set(auth(managerToken))
      .send({});
    expect(approval.status).toBe(201);

    // The removal is scoped to the REVIEWED client row only.
    expect(
      await ctx.prisma.clientPropertyInterest.count({
        where: { clientId: foreignClient.id },
      }),
    ).toBe(1);
    expect(
      await ctx.prisma.clientPropertyInterest.count({
        where: { clientId: mine.id },
      }),
    ).toBe(0);
  });

  it('never lets another employee stage an edit for a client they cannot see (404 without disclosure)', async () => {
    const created = await managerClient(employeeAId, {
      name: 'عميل المحجوب',
      phone: '66001009',
    });
    const denied = await submitReview(employeeBToken, {
      kind: 'EDIT',
      clientId: created.id,
      name: 'عميل المحجوب',
      phone: '66001009',
      requestData: buyerPack('1', 'x', 'y'),
    });
    expect(denied.status).toBe(404);
    const row = await ctx.prisma.client.findUnique({ where: { id: created.id } });
    expect(row?.requestData).toBeNull();
    expect(
      await ctx.prisma.clientReviewRequest.count({
        where: { clientId: created.id },
      }),
    ).toBe(0);
  });

  it('keeps the manager editing company-wide with NO record notification to self', async () => {
    const created = await managerClient(employeeAId, {
      name: 'عميل المدير',
      phone: '66001010',
    });
    const edited = await api()
      .patch(`/clients/${created.id}`)
      .set(auth(managerToken))
      .send({ requestData: buyerPack('30000', 'المنقف', 'طلب المدير') });
    expect(edited.status).toBe(200);
    const inbox = await api()
      .get('/notifications?limit=100')
      .set(auth(managerToken));
    expect(
      (
        inbox.body.data as { items: { type: string; clientId: string | null }[] }
      ).items.filter(
        (item) => item.type === 'CLIENT_UPDATED' && item.clientId === created.id,
      ),
    ).toHaveLength(0);
  });

  it('rejects a corrupted request document at submission — the approved store stays valid', async () => {
    const created = await managerClient(employeeAId, {
      name: 'عميل الفساد',
      phone: '66001011',
    });
    const bad = await submitReview(employeeAToken, {
      kind: 'EDIT',
      clientId: created.id,
      name: 'عميل الفساد',
      phone: '66001011',
      requestData: 'نص حر ليس JSON',
    });
    expect(bad.status).toBe(400);
    const row = await ctx.prisma.client.findUnique({ where: { id: created.id } });
    expect(row?.requestData).toBeNull();
  });
});
