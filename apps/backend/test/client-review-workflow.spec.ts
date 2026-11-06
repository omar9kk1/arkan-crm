import { Role } from '@arkan/shared';
import request from 'supertest';
import {
  auth,
  createTestApp,
  createUser,
  describeWithDatabase,
  login,
  resetDatabase,
  resetRateLimiting,
  type TestContext,
} from './support/test-app';

jest.setTimeout(180000);

/**
 * FULL client review lifecycle on the isolated test database (the migration
 * `20261022040000_client_review_requests` is pre-applied):
 *
 * - employees stage CREATION/EDIT reviews — nothing touches the approved
 *   `Client` tables until a manager approval;
 * - bypass prevention: `POST/PATCH /clients` answer 403 for employees;
 * - idempotency is requester-scoped and content-checked (same key + same
 *   proposal → same review; different content → 409);
 * - one ACTIVE EDIT review per client (PENDING and CHANGES_REQUESTED alike),
 *   resubmission continues the SAME row;
 * - approvals claim the row transactionally (duplicate/stale decisions 409)
 *   and the EDIT stale baseline answers a safe 409 with NOTHING applied;
 * - CREATION approval assigns the client to the requesting employee;
 * - privacy: pending creations invisible to lists/stats/search, other
 *   employees' rows 404, notification bodies never carry a phone/notes.
 */
describeWithDatabase('Client review workflow (staged creations + edits)', () => {
  let ctx: TestContext;
  let managerToken: string;
  let employeeAToken: string;
  let employeeBToken: string;
  let employeeAId: string;

  const api = () => request(ctx.app.getHttpServer());

  /** A validated manager-registered client (fixtures for EDIT reviews). */
  const managerClient = async (
    payload: Record<string, unknown>,
    responsibleUserId?: string,
  ) => {
    const response = await api()
      .post('/clients')
      .set(auth(managerToken))
      .send({ ...payload, ...(responsibleUserId ? { responsibleUserId } : {}) });
    expect(response.status).toBe(201);
    return response.body.data as {
      id: string;
      name: string;
      phone: string;
      notes: string;
      requestData: string | null;
    };
  };

  const submitReview = (token: string, payload: Record<string, unknown>) =>
    api().post('/client-reviews').set(auth(token)).send(payload);

  const buyerRequest = (budget: string, area: string): string =>
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
          linkedProperty: { propertyId: '', property: null, reason: '', notes: '' },
          message: 'اريد فيلا',
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
    resetRateLimiting(ctx.app);
    const manager = await createUser(ctx.prisma, {
      email: 'manager@reviews.local',
      name: 'مدير المراجعات',
      role: Role.MANAGER,
    });
    const employeeA = await createUser(ctx.prisma, {
      email: 'employee.a@reviews.local',
      name: 'موظف المراجعات أ',
      role: Role.EMPLOYEE,
    });
    const employeeB = await createUser(ctx.prisma, {
      email: 'employee.b@reviews.local',
      name: 'موظف المراجعات ب',
      role: Role.EMPLOYEE,
    });
    employeeAId = employeeA.id;
    await ctx.prisma.employeeProfile.create({ data: { userId: employeeA.id } });
    await ctx.prisma.employeeProfile.create({ data: { userId: employeeB.id } });
    managerToken = await login(ctx.app, manager.email);
    employeeAToken = await login(ctx.app, employeeA.email);
    employeeBToken = await login(ctx.app, employeeB.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  // -------------------------------------------------------------------------
  // 1) bypass prevention + concurrency of multiple creations
  // -------------------------------------------------------------------------

  it('BLOCKS the direct paths: POST/PATCH /clients answer 403 for employees', async () => {
    const created = await api()
      .post('/clients')
      .set(auth(employeeAToken))
      .send({ name: 'عميل التفاف', phone: '99000001' });
    expect(created.status).toBe(403);
    expect((created.body as { error: { message: string } }).error.message).toContain(
      'طلب المراجعة',
    );
    expect(
      await ctx.prisma.client.count({ where: { phone: '99000001' } }),
    ).toBe(0);

    const existing = await managerClient({ name: 'عميل حماية', phone: '99000002' });
    const patched = await api()
      .patch(`/clients/${existing.id}`)
      .set(auth(employeeAToken))
      .send({ name: 'تعديل التفاف' });
    expect(patched.status).toBe(403);
    const row = await ctx.prisma.client.findUnique({
      where: { id: existing.id },
    });
    expect(row?.name).toBe('عميل حماية');

    // The manager keeps BOTH paths.
    const managerPost = await api()
      .post('/clients')
      .set(auth(managerToken))
      .send({ name: 'عميل مباشر', phone: '99000003' });
    expect(managerPost.status).toBe(201);
    const managerPatch = await api()
      .patch(`/clients/${existing.id}`)
      .set(auth(managerToken))
      .send({ name: 'عميل حماية معدّل' });
    expect(managerPatch.status).toBe(200);
  });

  it('accepts MULTIPLE concurrent creation reviews from the SAME employee (no one-per-employee cap)', async () => {
    const first = await submitReview(employeeAToken, {
      kind: 'CREATION',
      name: 'عميل متزامن أ',
      phone: '99010001',
    });
    const second = await submitReview(employeeAToken, {
      kind: 'CREATION',
      name: 'عميل متزامن ب',
      phone: '99010002',
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((first.body.data as { id: string }).id).not.toBe(
      (second.body.data as { id: string }).id,
    );

    // Pending creations are INVISIBLE to the approved lists/search of EVERYONE.
    for (const token of [managerToken, employeeAToken]) {
      const list = await api().get('/clients').set(auth(token));
      const names = JSON.stringify(list.body);
      expect(names).not.toContain('عميل متزامن أ');
      expect(names).not.toContain('عميل متزامن ب');
      const search = await api()
        .get('/clients')
        .query({ search: 'متزامن' })
        .set(auth(token));
      expect((search.body.data as { items: unknown[] }).items).toHaveLength(0);
      const stats = await api().get('/clients/stats').set(auth(token));
      expect(JSON.stringify(stats.body)).not.toContain('99010001');
    }
    // The staged rows are visible ONLY in the review tab.
    const ownRows = await api().get('/client-reviews').set(auth(employeeAToken));
    expect(ownRows.status).toBe(200);
    expect(namesCount(ownRows.body, 'عميل متزامن')).toBe(2);
    // …and another employee sees NOTHING of them.
    const foreign = await api().get('/client-reviews').set(auth(employeeBToken));
    expect(namesCount(foreign.body, 'عميل متزامن')).toBe(0);
    const foreignDetail = await api()
      .get(`/client-reviews/${(first.body.data as { id: string }).id}`)
      .set(auth(employeeBToken));
    expect(foreignDetail.status).toBe(404);
  });

  // -------------------------------------------------------------------------
  // 2) idempotency (requester-scoped + content-checked)
  // -------------------------------------------------------------------------

  it('returns the SAME review for a repeated key+content; a different content conflicts; another employee is unaffected', async () => {
    const key = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const payload = {
      kind: 'CREATION',
      name: 'عميل مكرر بلا خطأ',
      phone: '99020001',
      idempotencyKey: key,
    };
    const first = await submitReview(employeeAToken, payload);
    expect(first.status).toBe(201);
    const firstId = (first.body.data as { id: string }).id;

    // The accidental duplicate: same key + SAME content → the same row.
    const retry = await submitReview(employeeAToken, { ...payload });
    expect(retry.status).toBe(201);
    expect((retry.body.data as { id: string }).id).toBe(firstId);
    expect(
      await ctx.prisma.clientReviewRequest.count({
        where: { requestedById: employeeAId },
      }),
    ).toBe(3); // two from the concurrency test + this one

    // Same key, DIFFERENT data → 409 (needs a new key).
    const changed = await submitReview(employeeAToken, {
      ...payload,
      name: 'عميل مكرر ببيانات أخرى',
    });
    expect(changed.status).toBe(409);

    // Same key from ANOTHER employee = an unrelated namespace (scoped).
    const foreign = await submitReview(employeeBToken, {
      kind: 'CREATION',
      name: 'عميل موظف ب',
      phone: '99020002',
      idempotencyKey: key,
    });
    expect(foreign.status).toBe(201);
    expect((foreign.body.data as { id: string }).id).not.toBe(firstId);
  });

  // -------------------------------------------------------------------------
  // 3) CREATION approval — atomic materialization + requester ownership
  // -------------------------------------------------------------------------

  it('approves a CREATION atomically: client + request document + interests, owned by the requester', async () => {
    const property = await ctx.prisma.property.create({
      data: {
        reference: 'A-900001',
        title: 'عقار الموافقة',
        area: 'الدسمة',
        currency: 'KWD',
        listingType: 'SALE',
        status: 'AVAILABLE',
      },
    });
    const submitted = await submitReview(employeeAToken, {
      kind: 'CREATION',
      name: 'عميل يقبل الآن',
      phone: '99030001',
      notes: 'ملاحظة الطلب',
      requestData: buyerRequest('120000', 'الدسمة'),
      addInterests: [{ propertyId: property.id, reason: 'استفسار أول' }],
    });
    expect(submitted.status).toBe(201);
    const reviewId = (submitted.body.data as { id: string }).id;

    // An employee can't decide; a manager can.
    const employeeDecision = await api()
      .post(`/client-reviews/${reviewId}/approve`)
      .set(auth(employeeAToken))
      .send({});
    expect(employeeDecision.status).toBe(403);

    const approved = await api()
      .post(`/client-reviews/${reviewId}/approve`)
      .set(auth(managerToken))
      .send({ reviewNotes: 'سليم' });
    expect(approved.status).toBe(201);
    const clientId = (approved.body.data as { clientId: string }).clientId;
    expect(clientId).toBeTruthy();

    // The client EXISTS with the approved data, owned by the requester.
    const row = await ctx.prisma.client.findUnique({
      where: { id: clientId! },
      include: { propertyInterests: true },
    });
    expect(row?.name).toBe('عميل يقبل الآن');
    expect(row?.requestData).toContain('"BUYER"');
    const profile = await ctx.prisma.employeeProfile.findUnique({
      where: { userId: employeeAId },
    });
    expect(profile).not.toBeNull();
    expect(row?.createdById).toBe(profile?.id);
    expect(row?.responsibleEmployeeId).toBe(profile?.id);
    expect(row?.propertyInterests).toHaveLength(1);
    expect(row?.propertyInterests[0]?.propertyId).toBe(property.id);

    // Now VISIBLE in the authorized lists/stats.
    const list = await api().get('/clients').set(auth(employeeAToken));
    const names = (list.body.data as { items: { id: string }[] }).items.map(
      (item) => item.id,
    );
    expect(names).toContain(clientId!);

    // A duplicate decision (the claim + status already final) → 409.
    const again = await api()
      .post(`/client-reviews/${reviewId}/approve`)
      .set(auth(managerToken))
      .send({});
    expect(again.status).toBe(409);
    // No duplicate client rows were materialized.
    expect(
      await ctx.prisma.client.count({ where: { phone: '99030001' } }),
    ).toBe(1);

    // The decision notification names the requester, references the review,
    // and carries NO phone/notes content.
    const inbox = await api().get('/notifications?limit=50').set(auth(employeeAToken));
    const decision = (
      inbox.body.data as {
        items: { type: string; clientReviewId: string | null; message: string }[];
      }
    ).items.find((item) => item.type === 'CLIENT_REVIEW_APPROVED');
    expect(decision).toBeDefined();
    expect(decision?.clientReviewId).toBe(reviewId);
    expect(JSON.stringify(inbox.body)).not.toContain('99030001');
    expect(JSON.stringify(inbox.body)).not.toContain('ملاحظة الطلب');

    // The submission reached every active manager, keyed on THIS review id
    // (earlier suite sections made their own submissions to the same inbox).
    const managerInbox = await api()
      .get('/notifications?limit=50')
      .set(auth(managerToken));
    const submissions = (
      managerInbox.body.data as {
        items: { type: string; clientReviewId: string | null }[];
      }
    ).items.filter(
      (item) =>
        item.type === 'CLIENT_REVIEW_SUBMITTED' &&
        item.clientReviewId === reviewId,
    );
    expect(submissions).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // 4) EDIT reviews — staging, single-active guard, resubmit, stale 409, apply
  // -------------------------------------------------------------------------

  it('stages an EDIT review with the approved row untouched, enforces ONE active review and EXPLICIT resubmission', async () => {
    const client = await managerClient(
      { name: 'عميل التعديل', phone: '99040001', notes: 'ملاحظات موثوقة' },
      employeeAId,
    );
    const proposed = {
      kind: 'EDIT',
      clientId: client.id,
      name: 'عميل التعديل الجديد',
      phone: '99040001',
      notes: 'ملاحظات موثوقة',
      requestData: buyerRequest('50000', 'حولي'),
    };
    const first = await submitReview(employeeAToken, proposed);
    expect(first.status).toBe(201);
    const reviewId = (first.body.data as { id: string }).id;

    // The approved row is UNTOUCHED while pending.
    const untouched = await ctx.prisma.client.findUnique({
      where: { id: client.id },
    });
    expect(untouched?.name).toBe('عميل التعديل');
    expect(untouched?.requestData).toBeNull();

    // A SECOND active EDIT review — even by the requester — conflicts.
    const second = await submitReview(employeeAToken, {
      ...proposed,
      name: 'طلب متعارض',
    });
    expect(second.status).toBe(409);
    const foreign = await submitReview(employeeBToken, {
      kind: 'EDIT',
      clientId: client.id,
      name: 'موظف آخر يعدل',
      phone: '99040001',
    });
    expect(foreign.status).toBe(409);

    // The requester sees the exact diff on the detail endpoint.
    const detail = await api()
      .get(`/client-reviews/${reviewId}`)
      .set(auth(employeeAToken));
    expect(detail.status).toBe(200);
    const view = detail.body.data as {
      proposed: { name: string; requestData: string | null };
      current: { name: string } | null;
      diff: string[];
    };
    expect(view.proposed.name).toBe('عميل التعديل الجديد');
    expect(view.current?.name).toBe('عميل التعديل');
    expect(view.diff.join(' ')).toContain('عميل التعديل');
    expect(view.diff.join(' ')).toContain('أُضيف نوع الطلب: مشتري');

    // Manager requests changes → the SAME row flips to CHANGES_REQUESTED.
    const requested = await api()
      .post(`/client-reviews/${reviewId}/request-changes`)
      .set(auth(managerToken))
      .send({ reviewNotes: 'عدّل الميزانية أولًا' });
    expect(requested.status).toBe(201);
    expect((requested.body.data as { status: string }).status).toBe(
      'CHANGES_REQUESTED',
    );

    // Still the ONLY active review (CHANGES_REQUESTED reserves the client too).
    expect(
      (
        await submitReview(employeeBToken, {
          kind: 'EDIT',
          clientId: client.id,
          name: 'محاول ب',
          phone: '99040001',
        })
      ).status,
    ).toBe(409);

    // An explicit RESUBMIT continues the SAME row (no duplicate rows), with a
    // REFRESHED baseline taken after the conflict — an employee action only.
    const resubmit = await api()
      .patch(`/client-reviews/${reviewId}`)
      .set(auth(employeeAToken))
      .send({ ...proposed, name: 'عميل التعديل الجديد' });
    expect(resubmit.status).toBe(200);
    expect((resubmit.body.data as { status: string }).status).toBe('PENDING');
    expect(
      await ctx.prisma.clientReviewRequest.count({
        where: { clientId: client.id },
      }),
    ).toBe(1);

    // …and a manager decision notification reached the requester right after
    // the changes request (deduped per decision).
    const inbox = await api().get('/notifications?limit=50').set(auth(employeeAToken));
    const changesNotified = (
      inbox.body.data as { items: { type: string; message: string }[] }
    ).items.filter((item) => item.type === 'CLIENT_REVIEW_CHANGES_REQUESTED');
    expect(changesNotified).toHaveLength(1);
    expect(changesNotified[0]?.message).not.toContain('ملاحظات موثوقة');

    // employee B attempting to resubmit someone else's review → 404.
    const foreignResubmit = await api()
      .patch(`/client-reviews/${reviewId}`)
      .set(auth(employeeBToken))
      .send(proposed);
    expect(foreignResubmit.status).toBe(404);
  });

  it('APPROVES an EDIT atomically — identity, request document and interest add/remove, history preserved', async () => {
    const propA = await ctx.prisma.property.create({
      data: {
        reference: 'A-900002',
        title: 'عقار التعديل أ',
        area: 'السالمية',
        currency: 'KWD',
        listingType: 'SALE',
        status: 'AVAILABLE',
      },
    });
    const propB = await ctx.prisma.property.create({
      data: {
        reference: 'A-900003',
        title: 'عقار التعديل ب',
        area: 'حولي',
        currency: 'KWD',
        listingType: 'RENT',
        status: 'AVAILABLE',
      },
    });
    const client = await api()
      .post('/clients')
      .set(auth(managerToken))
      .send({
        name: 'عميل التقديم',
        phone: '99050001',
        notes: 'ملاحظات بشرية محفوظة',
        responsibleUserId: employeeAId,
        propertyInterests: [{ propertyId: propA.id, reason: 'قديم' }],
      });
    expect(client.status).toBe(201);
    const clientId = (client.body.data as { id: string }).id;
    // A follow-up created BEFORE the review must survive the approval.
    const followUp = await api()
      .post(`/clients/${clientId}/follow-ups`)
      .set(auth(employeeAToken))
      .send({ dueAt: '2099-05-01', method: 'اتصال', outcome: 'تم' });
    expect(followUp.status).toBe(201);

    const submitted = await submitReview(employeeAToken, {
      kind: 'EDIT',
      clientId,
      name: 'عميل التقديم المعدّل',
      phone: '99050001',
      notes: 'ملاحظات بشرية محفوظة',
      requestData: buyerRequest('88000', 'الجرة'),
      addInterests: [{ propertyId: propB.id, reason: 'الجديد' }],
      removeInterests: [propA.id],
    });
    expect(submitted.status).toBe(201);
    const reviewId = (submitted.body.data as { id: string }).id;

    const approved = await api()
      .post(`/client-reviews/${reviewId}/approve`)
      .set(auth(managerToken))
      .send({ reviewNotes: 'موافق' });
    expect(approved.status).toBe(201);

    const row = await ctx.prisma.client.findUnique({
      where: { id: clientId },
      include: { propertyInterests: true, followups: true },
    });
    // The proposed state applied atomically.
    expect(row?.name).toBe('عميل التقديم المعدّل');
    expect(row?.requestData).toContain('"BUYER"');
    expect(row?.propertyInterests.map((interest) => interest.propertyId)).toEqual([
      propB.id,
    ]);
    expect(
      await ctx.prisma.clientPropertyInterest.count({ where: { propertyId: propA.id } }),
    ).toBe(0);
    // Follow-ups and human notes survived.
    expect(row?.notes).toBe('ملاحظات بشرية محفوظة');
    expect(row?.followups).toHaveLength(1);

    // Decision history preserved: audit rows for submit + resubmit-or-decisions.
    const audits = await ctx.prisma.auditLog.findMany({
      where: { entityId: reviewId, entityType: 'ClientReviewRequest' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((entry) => entry.action)).toEqual([
      'CLIENT_REVIEW_SUBMIT',
      'CLIENT_REVIEW_APPLY',
    ]);
  });

  it('REFUSES a stale approval with a safe 409, leaves the review OPEN and the client UNTOUCHED', async () => {
    const client = await managerClient(
      { name: 'عميل النزعة', phone: '99060001' },
      employeeAId,
    );
    const submitted = await submitReview(employeeAToken, {
      kind: 'EDIT',
      clientId: client.id,
      name: 'عميل النزعة المتغير',
      phone: '99060001',
      requestData: buyerRequest('70000', 'الفروانية'),
    });
    expect(submitted.status).toBe(201);
    const reviewId = (submitted.body.data as { id: string }).id;

    // A concurrent change lands AFTER the submission (manager path).
    const concurrent = await api()
      .patch(`/clients/${client.id}`)
      .set(auth(managerToken))
      .send({ notes: 'تغيير متزامن من المدير' });
    expect(concurrent.status).toBe(200);

    const approve = await api()
      .post(`/client-reviews/${reviewId}/approve`)
      .set(auth(managerToken))
      .send({});
    expect(approve.status).toBe(409);
    expect((approve.body as { error: { message: string } }).error.message).toContain(
      'تغيّرت بيانات العميل',
    );

    // NOTHING changed: the review stays open on PENDING (claim rolled back),
    // the client keeps the concurrent manager edit, and NO client fields of
    // the proposal were applied.
    const fresh = await ctx.prisma.clientReviewRequest.findUnique({
      where: { id: reviewId },
    });
    expect(fresh?.status).toBe('PENDING');
    expect(fresh?.reviewedById).toBeNull();
    const clientRow = await ctx.prisma.client.findUnique({
      where: { id: client.id },
    });
    expect(clientRow?.name).toBe('عميل النزعة');
    expect(clientRow?.notes).toBe('تغيير متزامن من المدير');
    expect(clientRow?.requestData).toBeNull();

    // EXPLICIT refresh path: the requester resubmits — the UI would have
    // re-hydrated the wizard from the CURRENT approved row, so the refreshed
    // proposal carries the concurrent manager note it saw (base re-snapshotted).
    // The SAME review then approves cleanly.
    const resubmit = await api()
      .patch(`/client-reviews/${reviewId}`)
      .set(auth(employeeAToken))
      .send({
        kind: 'EDIT',
        clientId: client.id,
        name: 'عميل النزعة المتغير',
        phone: '99060001',
        notes: 'تغيير متزامن من المدير',
        requestData: buyerRequest('70000', 'الفروانية'),
      });
    expect(resubmit.status).toBe(200);
    const approveAgain = await api()
      .post(`/client-reviews/${reviewId}/approve`)
      .set(auth(managerToken))
      .send({});
    expect(approveAgain.status).toBe(201);
    const applied = await ctx.prisma.client.findUnique({
      where: { id: client.id },
    });
    expect(applied?.name).toBe('عميل النزعة المتغير');
    // The refreshed proposal carried the current note it saw, so the
    // approval applied exactly what the manager reviewed — nothing lost.
    expect(applied?.notes).toBe('تغيير متزامن من المدير');
  });

  // -------------------------------------------------------------------------
  // 5) reject path + notification dedup + privacy
  // -------------------------------------------------------------------------

  it('REJECTS a review without touching anything and deduplicates the decision notification', async () => {
    const submitted = await submitReview(employeeBToken, {
      kind: 'CREATION',
      name: 'عميل مرفوض',
      phone: '99070001',
    });
    expect(submitted.status).toBe(201);
    const reviewId = (submitted.body.data as { id: string }).id;

    const rejected = await api()
      .post(`/client-reviews/${reviewId}/reject`)
      .set(auth(managerToken))
      .send({ reviewNotes: 'العميل مكرر' });
    expect(rejected.status).toBe(201);
    expect((rejected.body.data as { status: string }).status).toBe('REJECTED');
    expect(
      await ctx.prisma.client.count({ where: { phone: '99070001' } }),
    ).toBe(0);

    // Retrying the SAME decision deduplicates (no second notification).
    const repeat = await api()
      .post(`/client-reviews/${reviewId}/reject`)
      .set(auth(managerToken))
      .send({ reviewNotes: 'العميل مكرر' });
    expect(repeat.status).toBe(409);

    const inbox = await api().get('/notifications?limit=50').set(auth(employeeBToken));
    const decisions = (
      inbox.body.data as { items: { type: string; message: string }[] }
    ).items.filter((item) => item.type === 'CLIENT_REVIEW_REJECTED');
    expect(decisions).toHaveLength(1);
    // The reviewer's note content never leaves the review record into the bell.
    expect(decisions[0]?.message).not.toContain('مكرر');
  });
});

function namesCount(body: { data?: { items?: { clientName: string }[] } }, text: string): number {
  return (body.data?.items ?? []).filter((item) =>
    item.clientName.includes(text),
  ).length;
}
