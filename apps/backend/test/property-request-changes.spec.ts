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

jest.setTimeout(60000);

const image = [{ buffer: pngBytes(), filename: 'photo.png' }];

/**
 * Phase 4B: the manager "Request Changes" workflow, kept strictly separate from
 * rejection, and the viewer-specific `isMine` flag behind the employee
 * "My Properties" tab.
 *
 * These tests use the REAL Nest application + the ISOLATED test database and the
 * public HTTP contract only, so they prove the persistence (Property.status vs
 * PropertyApprovalRequest.status, versions, history) rather than mocked calls.
 */
describeWithDatabase('Request Changes workflow (Phase 4B)', () => {
  let ctx: TestContext;
  let managerId: string;
  let managerToken: string;
  let employeeAToken: string;
  let employeeBToken: string;
  const api = () => request(ctx.app.getHttpServer());

  let seq = 0;
  const employeePayload = (overrides: Record<string, unknown> = {}) => ({
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
    newContact: { type: 'BROKER', name: 'وسيط خاص', phone: '66661111' },
    ...overrides,
  });

  /** Creates a fresh PENDING property owned by employee A. */
  const createPending = async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload(),
      image,
    );
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('PENDING');
    return created.body.data as { id: string; version: number };
  };

  const requestChanges = (id: string, reason = 'يرجى مراجعة السعر') =>
    api().post(`/properties/${id}/request-changes`).set(auth(managerToken)).send({
      reason,
    });

  const approvalsOf = (id: string) =>
    ctx.prisma.propertyApprovalRequest.findMany({
      where: { propertyId: id },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'manager@changes.local',
      name: 'Manager',
      role: Role.OWNER,
    });
    const employeeA = await createUser(ctx.prisma, {
      email: 'employee.a@changes.local',
      name: 'Employee A',
      role: Role.EMPLOYEE,
    });
    const employeeB = await createUser(ctx.prisma, {
      email: 'employee.b@changes.local',
      name: 'Employee B',
      role: Role.EMPLOYEE,
    });
    managerId = manager.id;
    managerToken = await login(ctx.app, manager.email);
    employeeAToken = await login(ctx.app, employeeA.email);
    employeeBToken = await login(ctx.app, employeeB.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('lets a manager request changes: the property stays PENDING and the review becomes CHANGES_REQUESTED', async () => {
    const created = await createPending();
    const response = await requestChanges(
      created.id,
      'يرجى مراجعة السعر وتفاصيل الدور الأول',
    );
    expect(response.status).toBe(200);
    // Property.status is UNCHANGED — this is not a rejection.
    expect(response.body.data.status).toBe('PENDING');
    expect(response.body.data.reviewStatus).toBe('CHANGES_REQUESTED');
    expect(response.body.data.reviewNotes).toContain('يرجى مراجعة السعر');
    expect(response.body.data.version).toBe(created.version + 1);

    const approvals = await approvalsOf(created.id);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.status).toBe('CHANGES_REQUESTED');
    expect(approvals[0]?.notes).toContain('يرجى مراجعة السعر');
    expect(approvals[0]?.reviewedById).toBe(managerId);
    expect(approvals[0]?.reviewedAt).not.toBeNull();

    // An audit event is recorded — without the free-text instructions.
    const audits = await ctx.prisma.auditLog.findMany({
      where: { entityId: created.id, action: 'PROPERTY_REQUEST_CHANGES' },
    });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0]?.after ?? {})).not.toContain(
      'يرجى مراجعة السعر',
    );
  });

  it('requires a nonempty instructions message', async () => {
    const created = await createPending();
    const blank = await requestChanges(created.id, '   ');
    expect(blank.status).toBe(400);
    const saved = await ctx.prisma.property.findUnique({
      where: { id: created.id },
    });
    expect(saved?.status).toBe('PENDING');
    expect(saved?.version).toBe(created.version);
  });

  it('forbids an employee from requesting changes', async () => {
    const created = await createPending();
    const forbidden = await api()
      .post(`/properties/${created.id}/request-changes`)
      .set(auth(employeeAToken))
      .send({ reason: 'x' });
    expect(forbidden.status).toBe(403);
  });

  it('refuses request-changes on a property that is not PENDING', async () => {
    const created = await createPending();
    await api()
      .post(`/properties/${created.id}/approve`)
      .set(auth(managerToken))
      .send({});
    const response = await requestChanges(created.id);
    expect(response.status).toBe(409);
  });

  it('rejects a stale version on request-changes', async () => {
    const created = await createPending();
    const response = await api()
      .post(`/properties/${created.id}/request-changes`)
      .set(auth(managerToken))
      .send({ reason: 'x', version: created.version + 5 });
    expect(response.status).toBe(409);
  });

  it('blocks approve and reject while changes are requested', async () => {
    const created = await createPending();
    const requested = await requestChanges(created.id);
    expect(requested.status).toBe(200);

    const approve = await api()
      .post(`/properties/${created.id}/approve`)
      .set(auth(managerToken))
      .send({});
    expect(approve.status).toBe(409);
    const reject = await api()
      .post(`/properties/${created.id}/reject`)
      .set(auth(managerToken))
      .send({ reason: 'لا' });
    expect(reject.status).toBe(409);

    // Neither failed attempt changed the row.
    const after = await ctx.prisma.property.findUnique({
      where: { id: created.id },
    });
    expect(after?.status).toBe('PENDING');
    expect(after?.version).toBe(created.version + 1);
  });

  it('keeps the property hidden from other employees while the creator sees the instructions', async () => {
    const created = await createPending();
    await requestChanges(created.id, 'يرجى توضيح المساحة');
    // Another employee must not see it at all.
    expect(
      (
        await api()
          .get(`/properties/${created.id}`)
          .set(auth(employeeBToken))
      ).status,
    ).toBe(404);
    const list = await api()
      .get('/properties?limit=100')
      .set(auth(employeeBToken));
    expect(list.body.data.items.map((i: { id: string }) => i.id)).not.toContain(
      created.id,
    );
    // The creator still sees it, with the review state and notes.
    const own = await api()
      .get(`/properties/${created.id}`)
      .set(auth(employeeAToken));
    expect(own.status).toBe(200);
    expect(own.body.data.status).toBe('PENDING');
    expect(own.body.data.reviewStatus).toBe('CHANGES_REQUESTED');
    expect(own.body.data.reviewNotes).toContain('يرجى توضيح المساحة');
  });

  it('lets the creator correct and resubmit, creating a new PENDING review while keeping history', async () => {
    const created = await createPending();
    const requested = await requestChanges(created.id, 'يرجى توضيح المساحة');
    const afterRequest = requested.body.data as { version: number };

    // Correcting alone must NOT publish it.
    const patched = await api()
      .patch(`/properties/${created.id}`)
      .set(auth(employeeAToken))
      .send({
        version: afterRequest.version,
        sizeSqm: '450.00',
        description: 'تم تصحيح المساحة',
      });
    expect(patched.status).toBe(200);
    expect(patched.body.data.status).toBe('PENDING');
    // Still awaiting the creator's resubmission, not the manager's decision.
    expect(patched.body.data.reviewStatus).toBe('CHANGES_REQUESTED');

    // Only the creator may resubmit.
    expect(
      (
        await api()
          .post(`/properties/${created.id}/resubmit`)
          .set(auth(employeeBToken))
      ).status,
    ).toBe(403);

    const resubmitted = await api()
      .post(`/properties/${created.id}/resubmit`)
      .set(auth(employeeAToken));
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.data.status).toBe('PENDING');
    expect(resubmitted.body.data.reviewStatus).toBe('PENDING');
    expect(resubmitted.body.data.reviewNotes).toBeNull();

    // The previous CHANGES_REQUESTED review is preserved and a NEW pending one
    // was created.
    const approvals = await approvalsOf(created.id);
    expect(approvals.map((a) => a.status)).toEqual([
      'CHANGES_REQUESTED',
      'PENDING',
    ]);
    expect(approvals[0]?.notes).toBe('يرجى توضيح المساحة');

    // The manager can now approve.
    const approved = await api()
      .post(`/properties/${created.id}/approve`)
      .set(auth(managerToken))
      .send({ version: resubmitted.body.data.version });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('AVAILABLE');
    expect(approved.body.data.reviewStatus).toBe('APPROVED');
  });

  it('returns 409 for a duplicate resubmission', async () => {
    const created = await createPending();
    await requestChanges(created.id);
    const first = await api()
      .post(`/properties/${created.id}/resubmit`)
      .set(auth(employeeAToken));
    expect(first.status).toBe(200);
    const second = await api()
      .post(`/properties/${created.id}/resubmit`)
      .set(auth(employeeAToken));
    expect(second.status).toBe(409);
  });

  it('allows only one successful concurrent manager decision', async () => {
    const created = await createPending();
    const [changes, approve] = await Promise.all([
      api()
        .post(`/properties/${created.id}/request-changes`)
        .set(auth(managerToken))
        .send({ reason: 'تعديل' }),
      api()
        .post(`/properties/${created.id}/approve`)
        .set(auth(managerToken))
        .send({}),
    ]);
    expect([changes.status, approve.status].sort()).toEqual([200, 409]);
  });

  it('still supports the existing reject → correct → resubmit flow', async () => {
    const created = await createPending();
    const rejected = await api()
      .post(`/properties/${created.id}/reject`)
      .set(auth(managerToken))
      .send({ reason: 'الصورة غير واضحة', version: created.version });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe('REJECTED');
    expect(rejected.body.data.reviewStatus).toBe('REJECTED');

    const resubmitted = await api()
      .post(`/properties/${created.id}/resubmit`)
      .set(auth(employeeAToken));
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.data.status).toBe('PENDING');

    const approvals = await approvalsOf(created.id);
    expect(approvals.map((a) => a.status)).toEqual(['REJECTED', 'PENDING']);
  });

  it('exposes isMine to the creator and never to another employee, still hiding private contacts', async () => {
    const created = await createPending();
    await api()
      .post(`/properties/${created.id}/approve`)
      .set(auth(managerToken))
      .send({});

    const own = await api()
      .get(`/properties/${created.id}`)
      .set(auth(employeeAToken));
    expect(own.status).toBe(200);
    expect(own.body.data.status).toBe('AVAILABLE');
    expect(own.body.data.isMine).toBe(true);

    const other = await api()
      .get(`/properties/${created.id}`)
      .set(auth(employeeBToken));
    expect(other.status).toBe(200);
    expect(other.body.data.isMine).toBe(false);
    // Provider privacy is unchanged: employee B still never sees the contact.
    expect('contact' in other.body.data).toBe(false);
    expect('contactId' in other.body.data).toBe(false);
    expect(JSON.stringify(other.body)).not.toContain('وسيط خاص');
    expect(JSON.stringify(other.body)).not.toContain('66661111');

    // The creator's own list keeps the approved row with isMine = true.
    const ownList = await api()
      .get('/properties?limit=100')
      .set(auth(employeeAToken));
    const ownRow = ownList.body.data.items.find(
      (i: { id: string }) => i.id === created.id,
    );
    expect(ownRow?.isMine).toBe(true);

    // Employee B's list sees the same AVAILABLE row with isMine = false.
    const otherList = await api()
      .get('/properties?limit=100')
      .set(auth(employeeBToken));
    const otherRow = otherList.body.data.items.find(
      (i: { id: string }) => i.id === created.id,
    );
    expect(otherRow?.isMine).toBe(false);
  });

  it('still creates an OWNER property as AVAILABLE with no approval record', async () => {
    const response = await postProperty(
      ctx.app,
      managerToken,
      employeePayload({
        newContact: { type: 'OWNER', name: 'مالك المدير', phone: '22220000' },
      }),
      image,
    );
    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('AVAILABLE');
    expect(response.body.data.isMine).toBe(true);
    // No creation approval exists, so the review state is null (not APPROVED).
    expect(response.body.data.reviewStatus).toBeNull();
    const approvals = await ctx.prisma.propertyApprovalRequest.count({
      where: { propertyId: response.body.data.id },
    });
    expect(approvals).toBe(0);
  });
});
