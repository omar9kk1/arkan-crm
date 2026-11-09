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

describeWithDatabase('Owner approval lifecycle (provisional -> official)', () => {
  let ctx: TestContext;
  let managerId: string;
  let employeeAId: string;
  let ownerToken: string;
  let managerToken: string;
  let employeeAToken: string;
  let employeeBToken: string;
  let seq = 0;
  const api = () => request(ctx.app.getHttpServer());

  const payload = (overrides: Record<string, unknown> = {}) => {
    seq += 1;
    return {
      listingType: 'SALE',
      governorate: 'الجهراء',
      district: 'مدينة المطلاع',
      block: '8',
      plotNumber: String(8100 + seq),
      sizeSqm: '300.00',
      askingPrice: '350000.00',
      negotiable: true,
      description: 'منزل كامل',
      floors: [{ type: 'GROUND', details: 'مجلس + ديوانية' }],
      newContact: {
        type: 'OWNER',
        name: 'Owner Lifecycle',
        phone: '60000001',
      },
      ...overrides,
    };
  };

  const contactCount = () => ctx.prisma.contact.count();

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'owner-manager@test.local',
      name: 'Owner Manager',
      role: Role.MANAGER,
    });
    const a = await createUser(ctx.prisma, {
      email: 'owner-employee-a@test.local',
      name: 'Employee A',
      role: Role.EMPLOYEE,
    });
    const b = await createUser(ctx.prisma, {
      email: 'owner-employee-b@test.local',
      name: 'Employee B',
      role: Role.EMPLOYEE,
    });
    const owner = await createUser(ctx.prisma, {
      email: 'owner-lifecycle-owner@test.local',
      name: 'Lifecycle Owner',
      role: Role.OWNER,
    });
    managerId = manager.id;
    employeeAId = a.id;
    ownerToken = await login(ctx.app, owner.email);
    managerToken = await login(ctx.app, manager.email);
    employeeAToken = await login(ctx.app, a.email);
    employeeBToken = await login(ctx.app, b.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('1. employee submission creates NO official owner', async () => {
    const before = await contactCount();
    const res = await postProperty(
      ctx.app,
      employeeAToken,
      payload({ plotNumber: '8201' }),
      image,
    );
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.contactId).toBeNull();

    const row = await ctx.prisma.property.findUniqueOrThrow({
      where: { id: res.body.data.id },
    });
    expect(row.contactId).toBeNull();
    expect(row.proposedOwner).toMatchObject({
      name: 'Owner Lifecycle',
      phone: '60000001',
    });
    expect(await contactCount()).toBe(before);
  });

  it('2. Manager Clients count is unchanged before approval', async () => {
    const before = await api().get('/contacts?limit=100').set(auth(managerToken));
    const beforeCount = before.body.data.items.length;
    await postProperty(
      ctx.app,
      employeeAToken,
      payload({ plotNumber: '8202', newContact: { type: 'OWNER', name: 'Count Owner', phone: '60000002' } }),
      image,
    );
    const after = await api().get('/contacts?limit=100').set(auth(managerToken));
    expect(after.body.data.items.length).toBe(beforeCount);
  });

  it('3. Manager can view the proposed owner during review', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      payload({ plotNumber: '8203', newContact: { type: 'OWNER', name: 'Review Owner', phone: '60000003' } }),
      image,
    );
    const detail = await api()
      .get(`/properties/${created.body.data.id}`)
      .set(auth(managerToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data.contact).toBeNull();
    expect(detail.body.data.proposedOwner).toMatchObject({
      name: 'Review Owner',
      phone: '60000003',
    });
    // The creator also sees their own provisional owner.
    const own = await api()
      .get(`/properties/${created.body.data.id}`)
      .set(auth(employeeAToken));
    expect(own.body.data.proposedOwner?.phone).toBe('60000003');
  });

  it('4. approval creates the official owner and clears the provisional data', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      payload({ plotNumber: '8204', newContact: { type: 'OWNER', name: 'Approved Owner', phone: '60000004' } }),
      image,
    );
    const before = await contactCount();
    const approved = await api()
      .post(`/properties/${created.body.data.id}/approve`)
      .set(auth(managerToken))
      .send({});
    expect(approved.status).toBe(200);
    expect(await contactCount()).toBe(before + 1);

    const row = await ctx.prisma.property.findUniqueOrThrow({
      where: { id: created.body.data.id },
    });
    expect(row.contactId).toBeTruthy();
    expect(row.proposedOwner).toBeNull();
    const contact = await ctx.prisma.contact.findUniqueOrThrow({
      where: { id: row.contactId! },
    });
    expect(contact.name).toBe('Approved Owner');
    expect(contact.phone).toBe('60000004');
    expect(contact.responsibleUserId).toBe(employeeAId);
  });

  it('5. two approved houses with one owner produce ONE Contact', async () => {
    const phone = '60000005';
    const first = await postProperty(
      ctx.app,
      employeeAToken,
      payload({ plotNumber: '8205', newContact: { type: 'OWNER', name: 'Shared Owner', phone } }),
      image,
    );
    const second = await postProperty(
      ctx.app,
      employeeAToken,
      payload({ plotNumber: '8206', newContact: { type: 'OWNER', name: 'Shared Owner', phone } }),
      image,
    );
    const before = await contactCount();
    await api().post(`/properties/${first.body.data.id}/approve`).set(auth(managerToken)).send({});
    await api().post(`/properties/${second.body.data.id}/approve`).set(auth(managerToken)).send({});
    expect(await contactCount()).toBe(before + 1);

    const p1 = await ctx.prisma.property.findUniqueOrThrow({
      where: { id: first.body.data.id },
    });
    const p2 = await ctx.prisma.property.findUniqueOrThrow({
      where: { id: second.body.data.id },
    });
    expect(p1.contactId).toBeTruthy();
    expect(p1.contactId).toBe(p2.contactId);
    expect(
      await ctx.prisma.contact.count({ where: { phone } }),
    ).toBe(1);
  });

  it('6. rejection creates no official owner', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      payload({ plotNumber: '8207', newContact: { type: 'OWNER', name: 'Rejected Owner', phone: '60000007' } }),
      image,
    );
    const before = await contactCount();
    const rejected = await api()
      .post(`/properties/${created.body.data.id}/reject`)
      .set(auth(managerToken))
      .send({ reason: 'بيانات غير مكتملة' });
    expect(rejected.status).toBe(200);
    expect(await contactCount()).toBe(before);

    const row = await ctx.prisma.property.findUniqueOrThrow({
      where: { id: created.body.data.id },
    });
    expect(row.contactId).toBeNull();
    expect(row.proposedOwner).toMatchObject({ phone: '60000007' });
  });

  it('7. request-changes + resubmission retain provisional owner data', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      payload({ plotNumber: '8208', newContact: { type: 'OWNER', name: 'Changes Owner', phone: '60000008' } }),
      image,
    );
    const id = created.body.data.id as string;
    const changes = await api()
      .post(`/properties/${id}/request-changes`)
      .set(auth(managerToken))
      .send({ reason: 'أضف تفاصيل' });
    expect(changes.status).toBe(200);

    let row = await ctx.prisma.property.findUniqueOrThrow({ where: { id } });
    expect(row.proposedOwner).toMatchObject({ phone: '60000008' });

    const resubmitted = await api()
      .post(`/properties/${id}/resubmit`)
      .set(auth(employeeAToken))
      .send({});
    expect(resubmitted.status).toBe(200);
    row = await ctx.prisma.property.findUniqueOrThrow({ where: { id } });
    expect(row.proposedOwner).toMatchObject({ phone: '60000008' });
    expect(row.contactId).toBeNull();

    const approved = await api()
      .post(`/properties/${id}/approve`)
      .set(auth(managerToken))
      .send({});
    expect(approved.status).toBe(200);
    const after = await ctx.prisma.property.findUniqueOrThrow({ where: { id } });
    expect(after.contactId).toBeTruthy();
  });

  it('8. duplicate-property rejection creates no owner', async () => {
    const first = await postProperty(
      ctx.app,
      employeeAToken,
      payload({ block: '8', plotNumber: '8209', newContact: { type: 'OWNER', name: 'Dup One', phone: '60000009' } }),
      image,
    );
    expect(first.status).toBe(201);
    const before = await contactCount();
    const dup = await postProperty(
      ctx.app,
      employeeBToken,
      payload({ block: '8', plotNumber: '8209', newContact: { type: 'OWNER', name: 'Dup Two', phone: '60000010' } }),
      image,
    );
    expect(dup.status).toBe(409);
    expect(await contactCount()).toBe(before);
  });

  it('9. an existing approved owner is reused and owner history is preserved', async () => {
    // OWNER-created properties are official immediately (the highest-authority
    // bypass); MANAGER creations now require review.
    const managerCreated = await postProperty(
      ctx.app,
      ownerToken,
      payload({ plotNumber: '8210', newContact: { type: 'OWNER', name: 'Existing Owner', phone: '60000011' } }),
      image,
    );
    expect(managerCreated.status).toBe(201);
    const ownerId = managerCreated.body.data.contactId as string;
    expect(ownerId).toBeTruthy();

    const subject = await ctx.prisma.followUpSubject.create({
      data: {
        targetKey: `PROPERTY_OWNER:${managerCreated.body.data.id}`,
        kind: 'PROPERTY_OWNER',
        responsibleUserId: managerId,
        propertyId: managerCreated.body.data.id,
        activatedAt: new Date(),
        nextDueAt: new Date(),
      },
    });

    const before = await contactCount();
    const submitted = await postProperty(
      ctx.app,
      employeeAToken,
      payload({ plotNumber: '8211', newContact: { type: 'OWNER', name: 'Existing Owner', phone: '60000011' } }),
      image,
    );
    await api().post(`/properties/${submitted.body.data.id}/approve`).set(auth(managerToken)).send({});

    // Same phone => reuse, no new owner.
    expect(await contactCount()).toBe(before);
    const row = await ctx.prisma.property.findUniqueOrThrow({
      where: { id: submitted.body.data.id },
    });
    expect(row.contactId).toBe(ownerId);
    // Owner follow-up history is untouched.
    expect(
      await ctx.prisma.followUpSubject.findUnique({ where: { id: subject.id } }),
    ).toBeTruthy();
  });

  it('10. concurrent approvals cannot create duplicate owners', async () => {
    const phone = '60000012';
    const first = await postProperty(
      ctx.app,
      employeeAToken,
      payload({ plotNumber: '8212', newContact: { type: 'OWNER', name: 'Concurrent Owner', phone } }),
      image,
    );
    const second = await postProperty(
      ctx.app,
      employeeAToken,
      payload({ plotNumber: '8213', newContact: { type: 'OWNER', name: 'Concurrent Owner', phone } }),
      image,
    );
    const before = await contactCount();
    const [a, b] = await Promise.all([
      api().post(`/properties/${first.body.data.id}/approve`).set(auth(managerToken)).send({}),
      api().post(`/properties/${second.body.data.id}/approve`).set(auth(managerToken)).send({}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 200]);
    expect(await contactCount()).toBe(before + 1);
    const rows = await ctx.prisma.property.findMany({
      where: { id: { in: [first.body.data.id, second.body.data.id] } },
      select: { contactId: true },
    });
    expect(rows[0]!.contactId).toBeTruthy();
    expect(rows[0]!.contactId).toBe(rows[1]!.contactId);
    expect(await ctx.prisma.contact.count({ where: { phone } })).toBe(1);
  });

  it('11. another employee cannot see the provisional owner or the pending row', async () => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      payload({ plotNumber: '8214', newContact: { type: 'OWNER', name: 'Private Provisional', phone: '60000013' } }),
      image,
    );
    const denied = await api()
      .get(`/properties/${created.body.data.id}`)
      .set(auth(employeeBToken));
    expect(denied.status).toBe(404);
    expect(JSON.stringify(denied.body)).not.toContain('60000013');
    expect(JSON.stringify(denied.body)).not.toContain('Private Provisional');

    const list = await api().get('/properties?limit=100').set(auth(employeeBToken));
    expect(
      list.body.data.items.some(
        (item: { id: string }) => item.id === created.body.data.id,
      ),
    ).toBe(false);
  });

  it('12. Trash + permanent delete never delete the owner', async () => {
    const created = await postProperty(
      ctx.app,
      ownerToken,
      payload({ plotNumber: '8215', newContact: { type: 'OWNER', name: 'Trash Owner', phone: '60000014' } }),
      image,
    );
    const ownerId = created.body.data.contactId as string;
    const id = created.body.data.id as string;
    await api().post(`/properties/${id}/trash`).set(auth(ownerToken)).send({});
    const deleted = await api()
      .delete(`/properties/${id}/permanent`)
      .set(auth(ownerToken))
      .send({ confirmationCode: created.body.data.reference });
    expect(deleted.status).toBe(200);
    expect(
      await ctx.prisma.contact.findUnique({ where: { id: ownerId } }),
    ).toBeTruthy();
  });
});
