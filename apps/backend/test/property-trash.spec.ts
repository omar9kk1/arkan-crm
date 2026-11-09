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

jest.setTimeout(120000);

const image = [{ buffer: pngBytes(), filename: 'photo.png' }];

describeWithDatabase('Property Trash + permanent deep delete', () => {
  let ctx: TestContext;
  let managerId: string;
  let managerToken: string;
  let managerOnlyToken: string;
  let employeeToken: string;
  const api = () => request(ctx.app.getHttpServer());

  const payload = (overrides: Record<string, unknown> = {}) => ({
    listingType: 'SALE',
    governorate: 'الجهراء',
    district: 'مدينة المطلاع',
    block: '8',
    plotNumber: '9001',
    sizeSqm: '300.00',
    askingPrice: '350000.00',
    negotiable: true,
    description: 'منزل كامل',
    floors: [
      { type: 'GROUND', details: 'مجلس + ديوانية' },
      { type: 'FIRST', details: 'ثلاث غرف' },
    ],
    newContact: { type: 'OWNER', name: 'Owner Test', phone: '61112222' },
    ...overrides,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    // Trash is a management surface; OWNER exercises company-wide Trash.
    const manager = await createUser(ctx.prisma, {
      email: 'trash-manager@test.local',
      name: 'Trash Manager',
      role: Role.OWNER,
    });
    const employee = await createUser(ctx.prisma, {
      email: 'trash-employee@test.local',
      name: 'Trash Employee',
      role: Role.EMPLOYEE,
    });
    const managerOnly = await createUser(ctx.prisma, {
      email: 'trash-real-manager@test.local',
      name: 'Real Manager',
      role: Role.MANAGER,
    });
    managerId = manager.id;
    managerToken = await login(ctx.app, manager.email);
    managerOnlyToken = await login(ctx.app, managerOnly.email);
    employeeToken = await login(ctx.app, employee.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function createManagerProperty(overrides: Record<string, unknown> = {}) {
    const response = await postProperty(
      ctx.app,
      managerToken,
      payload(overrides),
      image,
    );
    expect(response.status).toBe(201);
    return response.body.data as {
      id: string;
      reference: string;
      contactId: string | null;
      floors: unknown[];
    };
  }

  it('1. employee can never view or operate Trash endpoints', async () => {
    const created = await postProperty(
      ctx.app,
      employeeToken,
      payload({ plotNumber: '9101' }),
      image,
    );
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const code = created.body.data.reference as string;

    expect((await api().get('/properties/trash').set(auth(employeeToken))).status).toBe(403);
    expect(
      (await api().post(`/properties/${id}/trash`).set(auth(employeeToken)).send({})).status,
    ).toBe(403);
    expect(
      (await api().post(`/properties/${id}/restore`).set(auth(employeeToken)).send({})).status,
    ).toBe(403);
    expect(
      (
        await api()
          .delete(`/properties/${id}/permanent`)
          .set(auth(employeeToken))
          .send({ confirmationCode: code })
      ).status,
    ).toBe(403);
  });

  it('1b. MANAGER can never view or operate Trash endpoints (OWNER-only)', async () => {
    const created = await createManagerProperty({ plotNumber: '9151' });
    const id = created.id;
    const code = created.reference;

    expect((await api().get('/properties/trash').set(auth(managerOnlyToken))).status).toBe(403);
    expect(
      (await api().post(`/properties/${id}/trash`).set(auth(managerOnlyToken)).send({})).status,
    ).toBe(403);
    expect(
      (await api().post(`/properties/${id}/restore`).set(auth(managerOnlyToken)).send({})).status,
    ).toBe(403);
    expect(
      (
        await api()
          .delete(`/properties/${id}/permanent`)
          .set(auth(managerOnlyToken))
          .send({ confirmationCode: code })
      ).status,
    ).toBe(403);
    // The property stayed active: MANAGER could not move it to Trash.
    const row = await ctx.prisma.property.findUnique({ where: { id } });
    expect(row!.deletedAt).toBeNull();
  });

  it('2. manager soft delete hides the row from normal reads and shows it in Trash', async () => {
    const created = await postProperty(
      ctx.app,
      employeeToken,
      payload({ plotNumber: '9201' }),
      image,
    );
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const mineBefore = await api().get('/properties/stats/mine').set(auth(employeeToken));
    const before = mineBefore.body.data as number;

    const trashed = await api()
      .post(`/properties/${id}/trash`)
      .set(auth(managerToken))
      .send({ reason: 'اختبار' });
    expect(trashed.status).toBe(200);
    expect(trashed.body.data.deletedAt).toBeTruthy();
    expect(trashed.body.data.deletedByName).toBe('Trash Manager');

    const list = await api().get('/properties?limit=100').set(auth(managerToken));
    expect(list.status).toBe(200);
    expect(list.body.data.items.some((row: { id: string }) => row.id === id)).toBe(false);

    expect((await api().get(`/properties/${id}`).set(auth(managerToken))).status).toBe(404);

    const mineAfter = await api().get('/properties/stats/mine').set(auth(employeeToken));
    expect(mineAfter.body.data).toBe(before - 1);

    const trash = await api().get('/properties/trash').set(auth(managerToken));
    expect(trash.status).toBe(200);
    expect(trash.body.data.items.some((row: { id: string }) => row.id === id)).toBe(true);
  });

  it('3. restore returns the original code, owner contact, floors and data', async () => {
    const created = await createManagerProperty({ plotNumber: '9301' });
    const contactStill = await ctx.prisma.contact.findUnique({
      where: { id: created.contactId! },
    });
    expect(contactStill).toBeTruthy();

    await api().post(`/properties/${created.id}/trash`).set(auth(managerToken)).send({});
    const restored = await api()
      .post(`/properties/${created.id}/restore`)
      .set(auth(managerToken))
      .send({});
    expect(restored.status).toBe(200);
    expect(restored.body.data.reference).toBe(created.reference);
    expect(restored.body.data.contactId).toBe(created.contactId);
    expect(restored.body.data.floors).toHaveLength(2);
    expect(restored.body.data.deletedAt).toBeNull();

    const detail = await api().get(`/properties/${created.id}`).set(auth(managerToken));
    expect(detail.status).toBe(200);
  });

  it('4. restore is blocked when an equivalent active property exists', async () => {
    const first = await createManagerProperty({ plotNumber: '9401' });
    await api().post(`/properties/${first.id}/trash`).set(auth(managerToken)).send({});

    // Creating the same block+plot while the first is trashed is allowed (the
    // trashed row is excluded from duplicate detection).
    const second = await createManagerProperty({ plotNumber: '9401' });
    expect(second.id).not.toBe(first.id);

    const restore = await api()
      .post(`/properties/${first.id}/restore`)
      .set(auth(managerToken))
      .send({});
    expect(restore.status).toBe(409);
    const row = await ctx.prisma.property.findUnique({ where: { id: first.id } });
    expect(row!.deletedAt).not.toBeNull();
  });

  it('5. permanent delete requires the exact code and a trashed row', async () => {
    const created = await createManagerProperty({ plotNumber: '9501' });

    // Active row: permanent delete is refused.
    const active = await api()
      .delete(`/properties/${created.id}/permanent`)
      .set(auth(managerToken))
      .send({ confirmationCode: created.reference });
    expect(active.status).toBe(400);

    await api().post(`/properties/${created.id}/trash`).set(auth(managerToken)).send({});

    // Wrong code: refused.
    const wrong = await api()
      .delete(`/properties/${created.id}/permanent`)
      .set(auth(managerToken))
      .send({ confirmationCode: 'A-999999' });
    expect(wrong.status).toBe(400);

    const ok = await api()
      .delete(`/properties/${created.id}/permanent`)
      .set(auth(managerToken))
      .send({ confirmationCode: created.reference });
    expect(ok.status).toBe(200);

    expect(await ctx.prisma.property.findUnique({ where: { id: created.id } })).toBeNull();
    const tombstone = await ctx.prisma.propertyTombstone.findUnique({
      where: { reference: created.reference },
    });
    expect(tombstone).toBeTruthy();
  });

  it('6. permanent delete is blocked by protected financial records', async () => {
    const created = await createManagerProperty({ plotNumber: '9601' });
    await api().post(`/properties/${created.id}/trash`).set(auth(managerToken)).send({});
    await ctx.prisma.manualExpense.create({
      data: {
        reference: 'ME-TRASH-1',
        type: 'MAINTENANCE',
        amount: 10,
        currency: 'KWD',
        description: 'test expense',
        propertyId: created.id,
        createdById: managerId,
        occurredAt: new Date(),
      },
    });

    const blocked = await api()
      .delete(`/properties/${created.id}/permanent`)
      .set(auth(managerToken))
      .send({ confirmationCode: created.reference });
    expect(blocked.status).toBe(409);
    expect(await ctx.prisma.property.findUnique({ where: { id: created.id } })).toBeTruthy();
  });

  it('7. owner with MULTIPLE properties is never deleted (soft + permanent)', async () => {
    const first = await createManagerProperty({ plotNumber: '9701' });
    const second = await createManagerProperty({
      plotNumber: '9702',
      newContact: undefined,
      contactId: first.contactId,
    });
    expect(second.contactId).toBe(first.contactId);

    await api().post(`/properties/${first.id}/trash`).set(auth(managerToken)).send({});
    expect(await ctx.prisma.contact.findUnique({ where: { id: first.contactId! } })).toBeTruthy();
    expect(await ctx.prisma.property.findUnique({ where: { id: second.id } })).toBeTruthy();

    await api()
      .delete(`/properties/${first.id}/permanent`)
      .set(auth(managerToken))
      .send({ confirmationCode: first.reference });

    const owner = await ctx.prisma.contact.findUnique({
      where: { id: first.contactId! },
    });
    expect(owner).toBeTruthy();
    const other = await ctx.prisma.property.findUnique({ where: { id: second.id } });
    expect(other).toBeTruthy();
    expect(other!.contactId).toBe(first.contactId);
  });

  it('8. owner with ONLY ONE property keeps the owner record with zero active properties', async () => {
    const created = await createManagerProperty({ plotNumber: '9801' });
    await api().post(`/properties/${created.id}/trash`).set(auth(managerToken)).send({});
    await api()
      .delete(`/properties/${created.id}/permanent`)
      .set(auth(managerToken))
      .send({ confirmationCode: created.reference });

    const owner = await ctx.prisma.contact.findUnique({
      where: { id: created.contactId! },
    });
    expect(owner).toBeTruthy();
    const remaining = await ctx.prisma.property.count({
      where: { contactId: created.contactId! },
    });
    expect(remaining).toBe(0);
  });

  it('9. permanent delete retains owner-level follow-up history with a cleared property reference', async () => {
    const created = await createManagerProperty({ plotNumber: '9901' });
    await api().post(`/properties/${created.id}/trash`).set(auth(managerToken)).send({});

    const subject = await ctx.prisma.followUpSubject.create({
      data: {
        targetKey: `PROPERTY_OWNER:${created.id}`,
        kind: 'PROPERTY_OWNER',
        responsibleUserId: managerId,
        propertyId: created.id,
        activatedAt: new Date(),
        nextDueAt: new Date(),
      },
    });
    const entry = await ctx.prisma.followUpEntry.create({
      data: {
        subjectId: subject.id,
        note: 'owner follow-up history',
        authorUserId: managerId,
      },
    });

    await api()
      .delete(`/properties/${created.id}/permanent`)
      .set(auth(managerToken))
      .send({ confirmationCode: created.reference });

    const keptSubject = await ctx.prisma.followUpSubject.findUnique({
      where: { id: subject.id },
    });
    expect(keptSubject).toBeTruthy();
    expect(keptSubject!.propertyId).toBeNull();
    expect(keptSubject!.active).toBe(false);
    expect(
      await ctx.prisma.followUpEntry.findUnique({ where: { id: entry.id } }),
    ).toBeTruthy();
    expect(
      await ctx.prisma.contact.findUnique({ where: { id: created.contactId! } }),
    ).toBeTruthy();
  });

  it('10. a trashed property does not block a new identical submission', async () => {
    const first = await postProperty(
      ctx.app,
      employeeToken,
      payload({ plotNumber: '9911' }),
      image,
    );
    expect(first.status).toBe(201);
    await api().post(`/properties/${first.body.data.id}/trash`).set(auth(managerToken)).send({});

    const second = await postProperty(
      ctx.app,
      employeeToken,
      payload({ plotNumber: '9911' }),
      image,
    );
    expect(second.status).toBe(201);
  });

  it('11. the original property code is permanently reserved and never reused', async () => {
    const created = await createManagerProperty({ plotNumber: '9921' });
    await api().post(`/properties/${created.id}/trash`).set(auth(managerToken)).send({});
    await api()
      .delete(`/properties/${created.id}/permanent`)
      .set(auth(managerToken))
      .send({ confirmationCode: created.reference });

    const next = await createManagerProperty({ plotNumber: '9922' });
    expect(next.reference).not.toBe(created.reference);
    expect(
      await ctx.prisma.propertyTombstone.findUnique({
        where: { reference: created.reference },
      }),
    ).toBeTruthy();
  });
});
