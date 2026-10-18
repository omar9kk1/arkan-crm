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

describeWithDatabase('Properties API (workflow, visibility, privacy)', () => {
  let ctx: TestContext;
  let managerId: string;
  let employeeAId: string;
  let employeeBId: string;
  let managerToken: string;
  let employeeAToken: string;
  let employeeBToken: string;
  const api = () => request(ctx.app.getHttpServer());

  const employeePayload = (overrides: Record<string, unknown> = {}) => ({
    listingType: 'SALE',
    governorate: 'الفروانية',
    district: 'غرناطة',
    block: '3',
    plotNumber: '12',
    sizeSqm: '400.00',
    askingPrice: '250000.00',
    negotiable: true,
    description: 'بيت مستقل للبيع',
    floors: [{ type: 'GROUND', details: 'صالة ومجلس' }, { type: 'FIRST' }],
    newContact: { type: 'BROKER', name: 'Broker A', phone: '66661111' },
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
    const employeeA = await createUser(ctx.prisma, {
      email: 'employee.a@test.local',
      name: 'Employee A',
      role: Role.EMPLOYEE,
    });
    const employeeB = await createUser(ctx.prisma, {
      email: 'employee.b@test.local',
      name: 'Employee B',
      role: Role.EMPLOYEE,
    });
    managerId = manager.id;
    employeeAId = employeeA.id;
    employeeBId = employeeB.id;
    managerToken = await login(ctx.app, manager.email);
    employeeAToken = await login(ctx.app, employeeA.email);
    employeeBToken = await login(ctx.app, employeeB.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('rejects unauthenticated access to every property endpoint', async () => {
    expect((await api().get('/properties')).status).toBe(401);
    expect(
      (await api().get('/properties/00000000-0000-0000-0000-000000000000'))
        .status,
    ).toBe(401);
  });

  it('makes a MANAGER property AVAILABLE immediately with no approval record', async () => {
    const response = await postProperty(
      ctx.app,
      managerToken,
      employeePayload({
        newContact: { type: 'OWNER', name: 'Manager Owner', phone: '22220000' },
      }),
      image,
    );
    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('AVAILABLE');
    // Creator role is server-derived, so the card can label a manager-created
    // row «مدير» without exposing the manager's personal name.
    expect(response.body.data.responsibleRole).toBe('MANAGER');
    expect(response.body.data.responsibleName).toBe('Manager');
    const approvals = await ctx.prisma.propertyApprovalRequest.count({
      where: { propertyId: response.body.data.id },
    });
    expect(approvals).toBe(0);
    expect(managerId).toBeTruthy();
  });

  it('makes an EMPLOYEE property PENDING and creates the initial approval record', async () => {
    const response = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload(),
      image,
    );
    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('PENDING');
    // The employee creator's real User name — never the owner/broker contact.
    expect(response.body.data.responsibleRole).toBe('EMPLOYEE');
    expect(response.body.data.responsibleName).toBe('Employee A');
    const approvals = await ctx.prisma.propertyApprovalRequest.findMany({
      where: { propertyId: response.body.data.id },
    });
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.status).toBe('PENDING');
    expect(approvals[0]?.requestedById).toBe(employeeAId);
  });

  it('generates a unique reference, a title and a legacy area from the district', async () => {
    const response = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ district: 'الجابرية' }),
      image,
    );
    expect(response.status).toBe(201);
    expect(response.body.data.reference).toMatch(/^AK-\d{6}-[0-9A-F]{10}$/);
    expect(response.body.data.title).toContain('الجابرية');
    const row = await ctx.prisma.property.findUnique({
      where: { id: response.body.data.id },
      select: { area: true, district: true },
    });
    expect(row?.area).toBe('الجابرية');
    expect(row?.district).toBe('الجابرية');
  });

  it('rejects requestedProperty on a non-EXCHANGE listing', async () => {
    const response = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ requestedProperty: { district: 'السالمية' } }),
      image,
    );
    expect(response.status).toBe(400);
  });

  it('rejects a public description that embeds a contact phone number', async () => {
    const response = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({ description: 'للتواصل واتساب 66667777 فقط' }),
      image,
    );
    expect(response.status).toBe(400);
  });

  it('forbids an employee from approving or rejecting', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload(),
      image,
    );
    const id = created.body.data.id;
    expect(
      (await api().post(`/properties/${id}/approve`).set(auth(employeeAToken)).send({})).status,
    ).toBe(403);
    expect(
      (
        await api()
          .post(`/properties/${id}/reject`)
          .set(auth(employeeAToken))
          .send({ reason: 'no' })
      ).status,
    ).toBe(403);
  });

  it('lets a manager approve PENDING -> AVAILABLE and increments version', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload(),
      image,
    );
    const id = created.body.data.id;
    expect(created.body.data.version).toBe(1);
    const approved = await api()
      .post(`/properties/${id}/approve`)
      .set(auth(managerToken))
      .send({ version: 1 });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('AVAILABLE');
    expect(approved.body.data.version).toBe(2);
    const approval = await ctx.prisma.propertyApprovalRequest.findFirst({
      where: { propertyId: id },
    });
    expect(approval?.status).toBe('APPROVED');
    expect(approval?.reviewedById).toBe(managerId);
  });

  it('lets a manager reject with a mandatory reason and stores it', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload(),
      image,
    );
    const id = created.body.data.id;
    const emptyReason = await api()
      .post(`/properties/${id}/reject`)
      .set(auth(managerToken))
      .send({ reason: '   ' });
    expect(emptyReason.status).toBe(400);
    const rejected = await api()
      .post(`/properties/${id}/reject`)
      .set(auth(managerToken))
      .send({ reason: 'الصورة غير واضحة' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe('REJECTED');
    const approval = await ctx.prisma.propertyApprovalRequest.findFirst({
      where: { propertyId: id, status: 'REJECTED' },
    });
    expect(approval?.notes).toBe('الصورة غير واضحة');
  });

  it('hides REJECTED and PENDING properties from other employees and enforces 409 on invalid transitions', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload(),
      image,
    );
    const id = created.body.data.id;
    // Creator sees it; another employee must not.
    expect((await api().get(`/properties/${id}`).set(auth(employeeAToken))).status).toBe(200);
    expect((await api().get(`/properties/${id}`).set(auth(employeeBToken))).status).toBe(404);
    // Approving an already-approved property is a conflicting transition.
    expect(
      (await api().post(`/properties/${id}/approve`).set(auth(managerToken)).send({})).status,
    ).toBe(200);
    expect(
      (await api().post(`/properties/${id}/approve`).set(auth(managerToken)).send({})).status,
    ).toBe(409);
    // Resubmitting a non-REJECTED property is invalid.
    expect(
      (await api().post(`/properties/${id}/resubmit`).set(auth(employeeAToken))).status,
    ).toBe(409);
  });

  it('lets the creator correct and resubmit a rejected property while preserving history', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload(),
      image,
    );
    const id = created.body.data.id;
    await api()
      .post(`/properties/${id}/reject`)
      .set(auth(managerToken))
      .send({ reason: 'المساحة غير صحيحة' });

    // Editing alone must NOT publish the property.
    const patched = await api()
      .patch(`/properties/${id}`)
      .set(auth(employeeAToken))
      .send({ version: 2, sizeSqm: '450.00', description: 'تم تصحيح المساحة' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.status).toBe('REJECTED');
    expect(patched.body.data.version).toBe(3);

    // A stale version is rejected.
    const stale = await api()
      .patch(`/properties/${id}`)
      .set(auth(employeeAToken))
      .send({ version: 2, sizeSqm: '460.00' });
    expect(stale.status).toBe(409);

    // Non-creator cannot edit.
    const forbidden = await api()
      .patch(`/properties/${id}`)
      .set(auth(employeeBToken))
      .send({ version: 3, sizeSqm: '470.00' });
    expect([403, 404]).toContain(forbidden.status);

    const resubmitted = await api()
      .post(`/properties/${id}/resubmit`)
      .set(auth(employeeAToken));
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.data.status).toBe('PENDING');
    // Rejection history preserved + a new pending request created.
    const requests = await ctx.prisma.propertyApprovalRequest.findMany({
      where: { propertyId: id },
      orderBy: { createdAt: 'asc' },
    });
    expect(requests.map((r) => r.status)).toEqual(['REJECTED', 'PENDING']);
  });

  it('never allows an approval and a rejection race to both succeed', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload(),
      image,
    );
    const id = created.body.data.id;
    const [approve, reject] = await Promise.all([
      api().post(`/properties/${id}/approve`).set(auth(managerToken)).send({}),
      api()
        .post(`/properties/${id}/reject`)
        .set(auth(managerToken))
        .send({ reason: 'سبب' }),
    ]);
    expect([approve.status, reject.status].sort()).toEqual([200, 409]);
  });

  it('enforces privacy: another employee sees public data but never the contact', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({
        newContact: { type: 'BROKER', name: 'Private Broker', phone: '69998877' },
      }),
      image,
    );
    const id = created.body.data.id;
    // Creator sees the private contact.
    const own = await api().get(`/properties/${id}`).set(auth(employeeAToken));
    expect(own.body.data.contact?.phone).toBe('69998877');

    await api().post(`/properties/${id}/approve`).set(auth(managerToken)).send({});

    const other = await api().get(`/properties/${id}`).set(auth(employeeBToken));
    expect(other.status).toBe(200);
    expect(other.body.data.status).toBe('AVAILABLE');
    expect('contact' in other.body.data).toBe(false);
    expect('contactId' in other.body.data).toBe(false);
    expect(JSON.stringify(other.body)).not.toContain('69998877');
    expect(JSON.stringify(other.body)).not.toContain('Private Broker');

    const manager = await api().get(`/properties/${id}`).set(auth(managerToken));
    expect(manager.body.data.contact?.phone).toBe('69998877');
  });

  it('does not leak private contacts through the list endpoint', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      employeePayload({
        newContact: { type: 'OWNER', name: 'List Secret', phone: '68008000' },
      }),
      image,
    );
    await api()
      .post(`/properties/${created.body.data.id}/approve`)
      .set(auth(managerToken))
      .send({});
    const list = await api().get('/properties').set(auth(employeeBToken));
    expect(list.status).toBe(200);
    for (const item of list.body.data.items)
      expect('contact' in item).toBe(false);
    expect(JSON.stringify(list.body)).not.toContain('68008000');
    expect(JSON.stringify(list.body)).not.toContain('List Secret');
  });

  it('returns a non-disclosing 404 for a guessed property id', async () => {
    const response = await api()
      .get('/properties/11111111-2222-3333-4444-555555555555')
      .set(auth(employeeBToken));
    expect(response.status).toBe(404);
  });

  it('does not crash on a legacy property that has no contact or image', async () => {
    const legacy = await ctx.prisma.property.create({
      data: {
        reference: 'LEGACY-NO-CONTACT',
        title: 'عقار قديم',
        area: 'موقع غير محدد',
        currency: 'KWD',
        status: 'AVAILABLE',
        listingType: 'SALE',
        createdByUserId: employeeAId,
      },
    });
    const read = await api().get(`/properties/${legacy.id}`).set(auth(employeeBToken));
    expect(read.status).toBe(200);
    expect(read.body.data.primaryImageUrl).toBeNull();
    expect('contact' in read.body.data).toBe(false);
    const image404 = await api()
      .get(`/properties/${legacy.id}/image`)
      .set(auth(employeeBToken));
    expect(image404.status).toBe(404);
    expect(employeeBId).toBeTruthy();
  });
});
