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
 * Client edit notifications in the REVIEWED era.
 *
 * An employee edit is no longer a direct `PATCH /clients/:id`: it is staged
 * as a `ClientReviewRequest`. The manager feed therefore carries SUBMISSION
 * events (exactly one per real submission/resubmission), and the requesting
 * employee is notified once per decision — never with private values.
 * Manager-direct edits remain silent and employee direct saves are blocked.
 */
describeWithDatabase('Employee client edit + manager notifications', () => {
  let ctx: TestContext;
  let managerToken: string;
  let employeeAToken: string;
  let employeeAName: string;
  let employeeAId: string;
  let employeeBId: string;

  const api = () => request(ctx.app.getHttpServer());

  /** A manager-registered client assigned to an employee (authorized edits). */
  const postClient = async (responsibleUserId: string, payload: Record<string, unknown>) => {
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
      responsibleUserId: string | null;
      followUps: unknown[];
      propertyInterests: unknown[];
    };
  };

  /** All review-lifecycle rows in ONE manager inbox (newest last is irrelevant). */
  const reviewRows = async (
    token: string,
    type?: string,
  ) => {
    const inbox = await api().get('/notifications?limit=100').set(auth(token));
    return (
      inbox.body.data as {
        items: {
          type: string;
          message: string;
          clientReviewId: string | null;
          clientId: string | null;
        }[];
      }
    ).items.filter((item) => (type ? item.type === type : true));
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'manager@clientedit.local',
      name: 'مدير تعديل العملاء',
      role: Role.MANAGER,
    });
    const employeeA = await createUser(ctx.prisma, {
      email: 'employee.a@clientedit.local',
      name: 'موظف التعديل الأول',
      role: Role.EMPLOYEE,
    });
    const employeeB = await createUser(ctx.prisma, {
      email: 'employee.b@clientedit.local',
      name: 'موظف التعديل الثاني',
      role: Role.EMPLOYEE,
    });
    employeeAName = employeeA.name;
    employeeAId = employeeA.id;
    employeeBId = employeeB.id;
    await ctx.prisma.employeeProfile.upsert({ where: { userId: employeeA.id }, create: { userId: employeeA.id }, update: {} });
    await ctx.prisma.employeeProfile.upsert({ where: { userId: employeeB.id }, create: { userId: employeeB.id }, update: {} });
    managerToken = await login(ctx.app, manager.email);
    employeeAToken = await login(ctx.app, employeeA.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('stages the employee edit as a review; relationships and id survive the approval', async () => {
    const created = await postClient(employeeAId, {
      name: 'عبدالله المنتجر',
      phone: '66700001',
      notes: 'ميل إلى فيلات الدسمة',
    });
    // A follow-up exists beside the client BEFORE the edit — it may not move,
    // duplicate or disappear with the approval.
    await api()
      .post(`/clients/${created.id}/follow-ups`)
      .set(auth(employeeAToken))
      .send({ dueAt: '2099-01-01', method: 'اتصال', outcome: 'تم التواصل' });
    const clientsBefore = await ctx.prisma.client.count();
    const followUpsBefore = await ctx.prisma.followUp.count({
      where: { clientId: created.id },
    });

    const submitted = await api()
      .post('/client-reviews')
      .set(auth(employeeAToken))
      .send({
        kind: 'EDIT',
        clientId: created.id,
        name: 'عبدالله المنتجر الغامدي',
        phone: '66700002',
        notes: 'طلب ملاحظة جديدة',
      });
    expect(submitted.status).toBe(201);
    const reviewId = (submitted.body.data as { id: string }).id;

    // While pending, NOTHING moved: same name/phone, no duplicate rows.
    const pending = await ctx.prisma.client.findUnique({
      where: { id: created.id },
    });
    expect(pending?.name).toBe('عبدالله المنتجر');
    expect(pending?.phone).toBe('66700001');
    expect(await ctx.prisma.client.count()).toBe(clientsBefore);

    const approval = await api()
      .post(`/client-reviews/${reviewId}/approve`)
      .set(auth(managerToken))
      .send({});
    expect(approval.status).toBe(201);

    const body = await api().get(`/clients/${created.id}`).set(auth(employeeAToken));
    const dto = body.body.data as {
      id: string;
      name: string;
      phone: string;
      notes: string;
    };
    // Same stable client id; only the reviewed fields moved.
    expect(dto.id).toBe(created.id);
    expect(dto.name).toBe('عبدالله المنتجر الغامدي');
    expect(dto.phone).toBe('66700002');
    expect(dto.notes).toBe('طلب ملاحظة جديدة');
    expect(
      await ctx.prisma.followUp.count({ where: { clientId: created.id } }),
    ).toBe(followUpsBefore);
  });

  it('never lets an employee stage an edit (or discover) another employee client', async () => {
    const created = await postClient(employeeBId, {
      name: 'عميل الموظف الثاني',
      phone: '66700003',
    });
    const denied = await api()
      .post('/client-reviews')
      .set(auth(employeeAToken))
      .send({
        kind: 'EDIT',
        clientId: created.id,
        name: 'اسم غير مصرح به',
        phone: '66700003',
      });
    // 404, not 403: the row does not exist for this viewer at all.
    expect(denied.status).toBe(404);
    const row = await ctx.prisma.client.findUnique({ where: { id: created.id } });
    expect(row?.name).toBe('عميل الموظف الثاني');
  });

  it('blocks the direct paths with NO notification arising from the refusal', async () => {
    const rowsBefore = await reviewRows(managerToken);
    const created = await postClient(employeeBId, {
      name: 'عميل الحماية',
      phone: '66700004',
    });
    const denied = await api()
      .patch(`/clients/${created.id}`)
      .set(auth(employeeAToken))
      .send({ name: 'اختراق محظور' });
    expect(denied.status).toBe(403);
    const row = await ctx.prisma.client.findUnique({ where: { id: created.id } });
    expect(row?.name).toBe('عميل الحماية');
    expect(await reviewRows(managerToken)).toHaveLength(rowsBefore.length);
  });

  it('lets the manager edit any company client directly without any notification', async () => {
    const created = await postClient(employeeBId, {
      name: 'عميل تعديل المدير',
      phone: '66700005',
    });
    const before = await reviewRows(managerToken);
    const edited = await api()
      .patch(`/clients/${created.id}`)
      .set(auth(managerToken))
      .send({ name: 'عميل تعديل المدير المحدث' });
    expect(edited.status).toBe(200);
    // A manager's own edit is not review activity: NOTHING new was born.
    expect(await reviewRows(managerToken)).toHaveLength(before.length);
  });

  it('notifies the direct Manager once per real submission, with a privacy-safe body', async () => {
    const created = await postClient(employeeAId, {
      name: 'سعيد الطوالبة',
      phone: '66700006',
      notes: 'ملاحظة قديمة سرية 1234',
    });
    const submitted = await api()
      .post('/client-reviews')
      .set(auth(employeeAToken))
      .send({
        kind: 'EDIT',
        clientId: created.id,
        name: 'سعيد الطوالبة فهد',
        phone: '66700007',
        notes: 'ملاحظة قديمة سرية 1234',
      });
    expect(submitted.status).toBe(201);
    const reviewId = (submitted.body.data as { id: string }).id;

    const rows = await reviewRows(managerToken, 'CLIENT_REVIEW_SUBMITTED');
    const mine = rows.filter((row) => row.clientReviewId === reviewId);
    expect(mine).toHaveLength(1);
    // The requester is named; the data is described at the fact level ONLY.
    expect(mine[0]?.message).toContain(employeeAName);
    expect(mine[0]?.message).toContain('تعديلات على بيانات عميل');
    const serialized = JSON.stringify(mine);
    expect(serialized).not.toContain('66700006');
    expect(serialized).not.toContain('66700007');
    expect(serialized).not.toContain('ملاحظة قديمة');
    expect(serialized).not.toContain('1234');
  });

  it('writes no notification for a review submission of identical values except the staging event itself', async () => {
    const created = await postClient(employeeAId, {
      name: 'عميل بدون تغيير',
      phone: '66700008',
      notes: 'ثابت',
    });
    // An identical resubmission attempt while active is blocked (409) —
    // it can NEVER become a second pending row or a double event.
    const first = await api()
      .post('/client-reviews')
      .set(auth(employeeAToken))
      .send({
        kind: 'EDIT',
        clientId: created.id,
        name: 'عميل بدون تغيير',
        phone: '66700008',
        notes: 'ثابت',
      });
    expect(first.status).toBe(201);
    const duplicate = await api()
      .post('/client-reviews')
      .set(auth(employeeAToken))
      .send({
        kind: 'EDIT',
        clientId: created.id,
        name: 'عميل بدون تغيير',
        phone: '66700008',
        notes: 'ثابت',
      });
    expect(duplicate.status).toBe(409);
    expect(
      await ctx.prisma.clientReviewRequest.count({
        where: { clientId: created.id },
      }),
    ).toBe(1);
  });

  it('keeps notifying on every further real stage (resubmissions are own occurrences)', async () => {
    const created = await postClient(employeeAId, {
      name: 'عميل التكرار',
      phone: '66700009',
    });
    const first = await api()
      .post('/client-reviews')
      .set(auth(employeeAToken))
      .send({
        kind: 'EDIT',
        clientId: created.id,
        name: 'عميل التكرار الأول',
        phone: '66700009',
      });
    expect(first.status).toBe(201);
    const reviewId = (first.body.data as { id: string }).id;
    await api()
      .post(`/client-reviews/${reviewId}/request-changes`)
      .set(auth(managerToken))
      .send({});

    const second = await api()
      .patch(`/client-reviews/${reviewId}`)
      .set(auth(employeeAToken))
      .send({
        kind: 'EDIT',
        clientId: created.id,
        name: 'عميل التكرار الثاني',
        phone: '66700009',
      });
    expect(second.status).toBe(200);

    // Each committed real stage is exactly one occurrence: one SUBMITTED for
    // the original, one RESUBMITTED for the explicit refresh.
    const types = (await reviewRows(managerToken))
      .filter((row) => row.clientReviewId === reviewId)
      .map((row) => row.type);
    expect(types).toContain('CLIENT_REVIEW_SUBMITTED');
    expect(types).toContain('CLIENT_REVIEW_RESUBMITTED');
    expect(types.filter((type) => type === 'CLIENT_REVIEW_SUBMITTED')).toHaveLength(1);
    expect(types.filter((type) => type === 'CLIENT_REVIEW_RESUBMITTED')).toHaveLength(1);

    // The requester saw BOTH decisions (changes requested once — deduped).
    const employeeDecisions = (await reviewRows(employeeAToken, 'CLIENT_REVIEW_CHANGES_REQUESTED'))
      .filter((row) => row.clientReviewId === reviewId);
    expect(employeeDecisions).toHaveLength(1);
    // …and the notification never replays the private data.
    expect(JSON.stringify(employeeDecisions)).not.toContain('66700009');
  });
});
