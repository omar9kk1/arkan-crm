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
import { OwnerPromotionService } from '../src/employees/owner-promotion.service';

jest.setTimeout(240000);

const PASSWORD = 'ChangeMe123!';
const image = [{ buffer: pngBytes(), filename: 'photo.png' }];

describeWithDatabase('OWNER / MANAGER / EMPLOYEE hierarchy', () => {
  let ctx: TestContext;
  let managerAId: string;
  let managerBId: string;
  let employeeA1Id: string;
  let employeeA2Id: string;
  let employeeB1Id: string;
  let unassignedId: string;
  let ownerToken: string;
  let managerAToken: string;
  let managerBToken: string;
  let employeeA1Token: string;
  let employeeA2Token: string;
  let employeeB1Token: string;
  let unassignedToken: string;
  let seq = 0;

  const api = () => request(ctx.app.getHttpServer());

  const payload = (overrides: Record<string, unknown> = {}) => ({
    listingType: 'SALE',
    governorate: 'Baghdad',
    district: 'Karrada',
    block: 'H7',
    plotNumber: String(880000 + ++seq),
    sizeSqm: '300.00',
    askingPrice: '300000.00',
    negotiable: true,
    description: 'Hierarchy isolated probe',
    floors: [{ type: 'GROUND', details: 'Ground' }],
    newContact: { type: 'OWNER', name: 'Hierarchy Owner', phone: '61009999' },
    ...overrides,
  });

  const createPending = async (
    token: string,
    overrides: Record<string, unknown> = {},
  ) => {
    const response = await postProperty(ctx.app, token, payload(overrides), image);
    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('PENDING');
    return response.body.data as { id: string; reference: string };
  };

  const createClient = async (
    token: string,
    name: string,
    responsibleUserId?: string,
  ) => {
    const response = await api()
      .post('/clients')
      .set(auth(token))
      .send({
        name,
        phone: `61${String(++seq).padStart(6, '0')}`,
        ...(responsibleUserId ? { responsibleUserId } : {}),
      });
    expect(response.status).toBe(201);
    return response.body.data as { id: string };
  };

  const inbox = async (token: string) => {
    const response = await api()
      .get('/notifications')
      .set(auth(token));
    expect(response.status).toBe(200);
    return response.body.data.items as Array<{ type: string; userId?: string }>;
  };

  const profileIdOf = async (userId: string) =>
    (
      await ctx.prisma.employeeProfile.findUniqueOrThrow({
        where: { userId },
        select: { id: true },
      })
    ).id;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const owner = await createUser(ctx.prisma, {
      email: 'h.owner@test.local',
      name: 'Hierarchy Owner',
      role: Role.OWNER,
    });
    const managerA = await createUser(ctx.prisma, {
      email: 'h.manager.a@test.local',
      name: 'Manager A',
      role: Role.MANAGER,
      grantReviewPermissions: false,
    });
    const managerB = await createUser(ctx.prisma, {
      email: 'h.manager.b@test.local',
      name: 'Manager B',
      role: Role.MANAGER,
      grantReviewPermissions: false,
    });
    const employeeA1 = await createUser(ctx.prisma, {
      email: 'h.employee.a1@test.local',
      name: 'Employee A1',
      role: Role.EMPLOYEE,
      managerUserId: managerA.id,
    });
    const employeeA2 = await createUser(ctx.prisma, {
      email: 'h.employee.a2@test.local',
      name: 'Employee A2',
      role: Role.EMPLOYEE,
      managerUserId: managerA.id,
    });
    const employeeB1 = await createUser(ctx.prisma, {
      email: 'h.employee.b1@test.local',
      name: 'Employee B1',
      role: Role.EMPLOYEE,
      managerUserId: managerB.id,
    });
    const unassigned = await createUser(ctx.prisma, {
      email: 'h.employee.unassigned@test.local',
      name: 'Unassigned Employee',
      role: Role.EMPLOYEE,
      managerUserId: null,
    });

    managerAId = managerA.id;
    managerBId = managerB.id;
    employeeA1Id = employeeA1.id;
    employeeA2Id = employeeA2.id;
    employeeB1Id = employeeB1.id;
    unassignedId = unassigned.id;

    ownerToken = await login(ctx.app, owner.email);
    managerAToken = await login(ctx.app, managerA.email);
    managerBToken = await login(ctx.app, managerB.email);
    employeeA1Token = await login(ctx.app, employeeA1.email);
    employeeA2Token = await login(ctx.app, employeeA2.email);
    employeeB1Token = await login(ctx.app, employeeB1.email);
    unassignedToken = await login(ctx.app, unassigned.email);
  });

  beforeEach(() => resetRateLimiting(ctx.app));

  afterAll(async () => {
    await ctx.close();
  });

  it('OWNER sees company-wide data while each Manager sees only their team', async () => {
    const clientA = await createClient(
      managerAToken,
      'Client A Team',
      employeeA1Id,
    );
    const clientB = await createClient(
      managerBToken,
      'Client B Team',
      employeeB1Id,
    );

    const ownerClients = await api()
      .get('/clients?limit=100')
      .set(auth(ownerToken));
    expect(ownerClients.status).toBe(200);
    expect(
      ownerClients.body.data.items.map((item: { id: string }) => item.id),
    ).toEqual(expect.arrayContaining([clientA.id, clientB.id]));

    expect(
      (await api().get(`/clients/${clientA.id}`).set(auth(managerAToken))).status,
    ).toBe(200);
    expect(
      (await api().get(`/clients/${clientA.id}`).set(auth(managerBToken))).status,
    ).toBe(404);
    expect(
      (await api().get(`/clients/${clientB.id}`).set(auth(managerAToken))).status,
    ).toBe(404);

    const employeeListA = await api()
      .get('/employees')
      .set(auth(managerAToken));
    expect(employeeListA.status).toBe(200);
    expect(
      employeeListA.body.data.items.map((item: { id: string }) => item.id).sort(),
    ).toEqual([employeeA1Id, employeeA2Id].sort());
    expect(
      employeeListA.body.data.items.some(
        (item: { id: string }) => item.id === unassignedId,
      ),
    ).toBe(false);

    const ownerEmployees = await api()
      .get('/employees')
      .set(auth(ownerToken));
    expect(
      ownerEmployees.body.data.items.map((item: { id: string }) => item.id),
    ).toEqual(
      expect.arrayContaining([
        employeeA1Id,
        employeeA2Id,
        employeeB1Id,
        unassignedId,
      ]),
    );
  });

  it('blocks cross-team property detail, image, review and notifications', async () => {
    const pendingB = await createPending(employeeB1Token, {
      plotNumber: '890001',
      block: 'B-1',
    });
    const url = `/properties/${pendingB.id}/image`;

    expect(
      (await api().get(`/properties/${pendingB.id}`).set(auth(managerBToken)))
        .status,
    ).toBe(200);
    expect(
      (await api().get(`/properties/${pendingB.id}`).set(auth(managerAToken)))
        .status,
    ).toBe(404);
    expect((await api().get(url).set(auth(managerBToken))).status).toBe(200);
    expect((await api().get(url).set(auth(managerAToken))).status).toBe(404);

    // Default-deny: Manager B has no review capability yet.
    expect(
      (
        await api()
          .post(`/properties/${pendingB.id}/approve`)
          .set(auth(managerBToken))
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await api()
          .post(`/properties/${pendingB.id}/approve`)
          .set(auth(managerAToken))
          .send({})
      ).status,
    ).toBe(404);

    await ctx.prisma.notification.deleteMany({});
    await createPending(employeeB1Token, {
      plotNumber: '890002',
      block: 'B-2',
    });
    expect(await inbox(managerAToken)).toHaveLength(0);
    expect(
      (await inbox(managerBToken)).some(
        (row) => row.type === 'PROPERTY_SUBMITTED',
      ),
    ).toBe(true);
    expect(
      (await inbox(ownerToken)).some(
        (row) => row.type === 'PROPERTY_SUBMITTED',
      ),
    ).toBe(true);

    // Contacts and follow-up supervision obey the same team boundary.
    const contactB = await api()
      .post('/contacts')
      .set(auth(employeeB1Token))
      .send({ type: 'BROKER', name: 'B Team Broker', phone: '61007001' });
    expect(contactB.status).toBe(201);
    const contactId = contactB.body.data.id as string;
    expect(
      (
        await api().get('/contacts?limit=100').set(auth(managerBToken))
      ).body.data.items.some((item: { id: string }) => item.id === contactId),
    ).toBe(true);
    expect(
      (
        await api().get('/contacts?limit=100').set(auth(managerAToken))
      ).body.data.items.some((item: { id: string }) => item.id === contactId),
    ).toBe(false);
    expect(
      (await api().get(`/contacts/${contactId}`).set(auth(managerAToken)))
        .status,
    ).toBe(404);

    const subject = await ctx.prisma.followUpSubject.create({
      data: {
        targetKey: `PROPERTY_OWNER:${pendingB.id}`,
        kind: 'PROPERTY_OWNER',
        responsibleId: await profileIdOf(employeeB1Id),
        propertyId: pendingB.id,
        activatedAt: new Date(),
        nextDueAt: new Date(Date.now() - 60_000),
      },
    });
    const supervisionB = await api()
      .get('/follow-ups/manager/overview')
      .set(auth(managerBToken));
    expect(supervisionB.status).toBe(200);
    expect(
      supervisionB.body.data.items.some(
        (item: { id: string }) => item.id === subject.id,
      ),
    ).toBe(true);
    const supervisionA = await api()
      .get('/follow-ups/manager/overview')
      .set(auth(managerAToken));
    expect(
      supervisionA.body.data.items.some(
        (item: { id: string }) => item.id === subject.id,
      ),
    ).toBe(false);
  });

  it('keeps unassigned employees visible to OWNER only', async () => {
    const pending = await createPending(unassignedToken, {
      plotNumber: '890101',
      block: 'U-1',
    });

    expect(
      (await api().get(`/properties/${pending.id}`).set(auth(ownerToken)))
        .status,
    ).toBe(200);
    for (const token of [managerAToken, managerBToken]) {
      expect(
        (await api().get(`/properties/${pending.id}`).set(auth(token))).status,
      ).toBe(404);
    }
    expect(
      (await api().get(`/properties/${pending.id}`).set(auth(unassignedToken)))
        .status,
    ).toBe(200);
  });

  it('allows only OWNER to create, assign/transfer, activate and set permissions', async () => {
    for (const [method, url] of [
      ['post', '/employees'],
      ['patch', `/employees/${employeeA1Id}/manager`],
      ['patch', `/employees/${employeeA1Id}/activation`],
      ['patch', `/managers/${managerAId}/permissions`],
    ] as const) {
      const response = await (method === 'post'
        ? api().post(url)
        : api().patch(url)
      )
        .set(auth(managerAToken))
        .send(
          method === 'post'
            ? {
                name: 'Forbidden',
                email: 'forbidden@test.local',
                password: PASSWORD,
                role: 'EMPLOYEE',
              }
            : {},
        );
      expect({ url, status: response.status }).toEqual({ url, status: 403 });
    }

    const created = await api()
      .post('/employees')
      .set(auth(ownerToken))
      .send({
        name: 'Owner Created Employee',
        email: 'h.created.employee@test.local',
        password: PASSWORD,
        role: 'EMPLOYEE',
        managerUserId: managerAId,
      });
    expect(created.status).toBe(201);
    const createdId = created.body.data.id as string;

    const transferred = await api()
      .patch(`/employees/${createdId}/manager`)
      .set(auth(ownerToken))
      .send({ managerUserId: managerBId });
    expect(transferred.status).toBe(200);
    expect(transferred.body.data.managerUserId).toBe(managerBId);

    const teamA = await api().get('/employees').set(auth(managerAToken));
    expect(
      teamA.body.data.items.some((item: { id: string }) => item.id === createdId),
    ).toBe(false);
    const teamB = await api().get('/employees').set(auth(managerBToken));
    expect(
      teamB.body.data.items.some((item: { id: string }) => item.id === createdId),
    ).toBe(true);
  });

  it('supports default-deny, independent grant/revocation and strict team scope', async () => {
    const pendingA = await createPending(employeeA1Token, {
      plotNumber: '890201',
      block: 'A-1',
    });

    // Read-only by default.
    expect(
      (await api().get(`/properties/${pendingA.id}`).set(auth(managerAToken)))
        .status,
    ).toBe(200);
    expect(
      (
        await api()
          .post(`/properties/${pendingA.id}/approve`)
          .set(auth(managerAToken))
          .send({})
      ).status,
    ).toBe(403);

    // Grant approve only.
    const granted = await api()
      .patch(`/managers/${managerAId}/permissions`)
      .set(auth(ownerToken))
      .send({ canApprove: true, canReject: false });
    expect(granted.status).toBe(200);
    expect(granted.body.data.capabilities).toEqual({
      approveProperties: true,
      rejectProperties: false,
    });
    expect(
      (
        await api()
          .post(`/properties/${pendingA.id}/approve`)
          .set(auth(managerAToken))
          .send({})
      ).status,
    ).toBe(200);

    const pendingReject = await createPending(employeeA1Token, {
      plotNumber: '890202',
      block: 'A-2',
    });
    expect(
      (
        await api()
          .post(`/properties/${pendingReject.id}/reject`)
          .set(auth(managerAToken))
          .send({ reason: 'Not allowed yet' })
      ).status,
    ).toBe(403);

    // Grant reject independently.
    await api()
      .patch(`/managers/${managerAId}/permissions`)
      .set(auth(ownerToken))
      .send({ canApprove: true, canReject: true });
    expect(
      (
        await api()
          .post(`/properties/${pendingReject.id}/reject`)
          .set(auth(managerAToken))
          .send({ reason: 'Rejected by granted Manager' })
      ).status,
    ).toBe(200);

    // Cross-team approval remains 404 even with the capability.
    const pendingB = await createPending(employeeB1Token, {
      plotNumber: '890203',
      block: 'B-3',
    });
    expect(
      (
        await api()
          .post(`/properties/${pendingB.id}/approve`)
          .set(auth(managerAToken))
          .send({})
      ).status,
    ).toBe(404);

    // Revoke approve; the next approval is forbidden again.
    await api()
      .patch(`/managers/${managerAId}/permissions`)
      .set(auth(ownerToken))
      .send({ canApprove: false, canReject: false });
    const pendingAfterRevoke = await createPending(employeeA1Token, {
      plotNumber: '890204',
      block: 'A-3',
    });
    expect(
      (
        await api()
          .post(`/properties/${pendingAfterRevoke.id}/approve`)
          .set(auth(managerAToken))
          .send({})
      ).status,
    ).toBe(403);

    // OWNER can always approve/reject.
    expect(
      (
        await api()
          .post(`/properties/${pendingAfterRevoke.id}/approve`)
          .set(auth(ownerToken))
          .send({})
      ).status,
    ).toBe(200);
    const ownerRejectTarget = await createPending(employeeA2Token, {
      plotNumber: '890205',
      block: 'A-4',
    });
    expect(
      (
        await api()
          .post(`/properties/${ownerRejectTarget.id}/reject`)
          .set(auth(ownerToken))
          .send({ reason: 'OWNER decision' })
      ).status,
    ).toBe(200);
  });

  it('transfer changes future team visibility without deleting history', async () => {
    const pending = await createPending(employeeA1Token, {
      plotNumber: '890301',
      block: 'T-1',
    });
    expect(
      (await api().get(`/properties/${pending.id}`).set(auth(managerAToken)))
        .status,
    ).toBe(200);

    const transfer = await api()
      .patch(`/employees/${employeeA1Id}/manager`)
      .set(auth(ownerToken))
      .send({ managerUserId: managerBId });
    expect(transfer.status).toBe(200);

    expect(
      (await api().get(`/properties/${pending.id}`).set(auth(managerAToken)))
        .status,
    ).toBe(404);
    expect(
      (await api().get(`/properties/${pending.id}`).set(auth(managerBToken)))
        .status,
    ).toBe(200);
    expect(
      (await api().get(`/properties/${pending.id}`).set(auth(employeeA1Token)))
        .status,
    ).toBe(200);
    const row = await ctx.prisma.property.findUniqueOrThrow({
      where: { id: pending.id },
      select: { createdByUserId: true },
    });
    expect(row.createdByUserId).toBe(employeeA1Id);

    // Transfer back for later tests.
    await api()
      .patch(`/employees/${employeeA1Id}/manager`)
      .set(auth(ownerToken))
      .send({ managerUserId: managerAId });
  });

  it('preserves duplicate prevention and P/A numbering under the hierarchy', async () => {
    const identity = {
      plotNumber: '890401',
      block: 'D-1',
      district: 'Duplicate District',
    };
    const first = await createPending(employeeA1Token, identity);
    expect(first.reference).toMatch(/^P-\d{6}$/);

    const duplicate = await postProperty(
      ctx.app,
      employeeA2Token,
      payload(identity),
      image,
    );
    expect(duplicate.status).toBe(409);

    const approved = await api()
      .post(`/properties/${first.id}/approve`)
      .set(auth(ownerToken))
      .send({});
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('AVAILABLE');
    expect(approved.body.data.approvedReference).toMatch(/^A-\d{6}$/);

    const stillDuplicate = await postProperty(
      ctx.app,
      employeeA2Token,
      payload(identity),
      image,
    );
    expect(stillDuplicate.status).toBe(409);
  });

  it('scopes dashboard counts and search results to the current team', async () => {
    const readDashboard = async (token: string) => {
      const response = await api()
        .get('/dashboard/manager?period=all')
        .set(auth(token));
      expect(response.status).toBe(200);
      return response.body.data as {
        properties: { pending: number };
        clients: { total: number };
        employees: { total: number };
      };
    };

    const beforeA = await readDashboard(managerAToken);
    const beforeB = await readDashboard(managerBToken);

    const clientB = await createClient(
      managerBToken,
      'Dashboard B Only Client',
      employeeB1Id,
    );
    await createPending(employeeB1Token, {
      plotNumber: '890601',
      block: 'DS-1',
      district: 'B Only District',
    });

    const afterA = await readDashboard(managerAToken);
    const afterB = await readDashboard(managerBToken);

    // Another team's records never move any Manager-A counter.
    expect(afterA.clients.total).toBe(beforeA.clients.total);
    expect(afterA.properties.pending).toBe(beforeA.properties.pending);
    expect(afterB.clients.total).toBe(beforeB.clients.total + 1);
    expect(afterB.properties.pending).toBe(beforeB.properties.pending + 1);

    // Employee counts reflect the current DB team assignment exactly.
    const [teamA, teamB] = await Promise.all([
      ctx.prisma.employeeProfile.count({ where: { managerUserId: managerAId } }),
      ctx.prisma.employeeProfile.count({ where: { managerUserId: managerBId } }),
    ]);
    expect(afterA.employees.total).toBe(teamA);
    expect(afterB.employees.total).toBe(teamB);

    // Search is applied inside the same scope, never as an unscoped lookup.
    const clientSearchA = await api()
      .get('/clients?search=Dashboard B Only Client')
      .set(auth(managerAToken));
    expect(clientSearchA.status).toBe(200);
    expect(
      clientSearchA.body.data.items.some(
        (item: { id: string }) => item.id === clientB.id,
      ),
    ).toBe(false);
    const clientSearchB = await api()
      .get('/clients?search=Dashboard B Only Client')
      .set(auth(managerBToken));
    expect(
      clientSearchB.body.data.items.some(
        (item: { id: string }) => item.id === clientB.id,
      ),
    ).toBe(true);

    const propertySearchA = await api()
      .get('/properties')
      .query({ q: 'B Only District', limit: 100 })
      .set(auth(managerAToken));
    expect(propertySearchA.status).toBe(200);
    expect(
      propertySearchA.body.data.items.some(
        (item: { district?: string | null }) =>
          item.district === 'B Only District',
      ),
    ).toBe(false);
    const propertySearchB = await api()
      .get('/properties')
      .query({ q: 'B Only District', limit: 100 })
      .set(auth(managerBToken));
    expect(
      propertySearchB.body.data.items.some(
        (item: { district?: string | null }) =>
          item.district === 'B Only District',
      ),
    ).toBe(true);
  });

  it('revokes old sessions on role changes and requires fresh login after disable/re-enable', async () => {
    // Role change (the promotion service is the only supported role change;
    // demotion is modelled with the same authVersion + revocation rule).
    const oldManagerAccess = managerBToken;
    const oldManagerRefresh = (
      await api()
        .post('/auth/login')
        .send({ email: 'h.manager.b@test.local', password: PASSWORD })
    ).body.data.refreshToken as string;
    expect(
      (await api().get('/employees').set(auth(oldManagerAccess))).status,
    ).toBe(200);

    await ctx.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: managerBId },
        data: { role: Role.EMPLOYEE, authVersion: { increment: 1 } },
      });
      await tx.refreshToken.updateMany({
        where: { userId: managerBId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    expect(
      (await api().get('/employees').set(auth(oldManagerAccess))).status,
    ).toBe(401);
    expect(
      (await api().post('/auth/refresh').send({ refreshToken: oldManagerRefresh }))
        .status,
    ).toBe(401);

    // Restore the manager role for the remaining tests; a fresh login is the
    // only way back.
    await ctx.prisma.user.update({
      where: { id: managerBId },
      data: { role: Role.MANAGER },
    });
    expect(
      (await api().get('/employees').set(auth(oldManagerAccess))).status,
    ).toBe(401);
    managerBToken = await login(ctx.app, 'h.manager.b@test.local');
    expect(
      (await api().get('/employees').set(auth(managerBToken))).status,
    ).toBe(200);

    // Disable/re-enable an employee: data survives, old sessions do not.
    const pending = await createPending(employeeA1Token, {
      plotNumber: '890501',
      block: 'S-1',
    });
    const oldAccess = employeeA1Token;
    const oldRefresh = (
      await api()
        .post('/auth/login')
        .send({ email: 'h.employee.a1@test.local', password: PASSWORD })
    ).body.data.refreshToken as string;

    const disabled = await api()
      .patch(`/employees/${employeeA1Id}/activation`)
      .set(auth(ownerToken))
      .send({ isActive: false });
    expect(disabled.status).toBe(200);
    expect((await api().get('/auth/me').set(auth(oldAccess))).status).toBe(401);
    expect(
      (await api().post('/auth/refresh').send({ refreshToken: oldRefresh }))
        .status,
    ).toBe(401);

    const enabled = await api()
      .patch(`/employees/${employeeA1Id}/activation`)
      .set(auth(ownerToken))
      .send({ isActive: true });
    expect(enabled.status).toBe(200);
    expect((await api().get('/auth/me').set(auth(oldAccess))).status).toBe(401);
    expect(
      (await api().post('/auth/refresh').send({ refreshToken: oldRefresh }))
        .status,
    ).toBe(401);

    employeeA1Token = await login(ctx.app, 'h.employee.a1@test.local');
    expect(
      (await api().get(`/properties/${pending.id}`).set(auth(employeeA1Token)))
        .status,
    ).toBe(200);
    expect(
      (await api().get(`/properties/${pending.id}`).set(auth(managerAToken)))
        .status,
    ).toBe(200);
  });
});

describeWithDatabase('OWNER promotion safety', () => {
  let ctx: TestContext;
  let promotion: OwnerPromotionService;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    promotion = ctx.app.get(OwnerPromotionService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('refuses ambiguity and never guesses the OWNER account', async () => {
    await createUser(ctx.prisma, {
      email: 'promote.a@test.local',
      name: 'Promote A',
      role: Role.MANAGER,
    });
    await createUser(ctx.prisma, {
      email: 'promote.b@test.local',
      name: 'Promote B',
      role: Role.MANAGER,
    });
    await expect(
      promotion.preview(),
    ).rejects.toThrow(/Ambiguous promotion/);
    expect(await ctx.prisma.user.count({ where: { role: Role.OWNER } })).toBe(
      0,
    );
  });

  it('dry-run writes nothing; explicit promotion revokes old sessions', async () => {
    const target = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'promote.a@test.local' },
    });
    const tokens = await apiLogin(ctx, target.email);

    const preview = await promotion.promote({
      email: target.email,
      dryRun: true,
      confirm: false,
    });
    expect(preview.selected?.email).toBe(target.email);
    expect(
      await ctx.prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
    ).toMatchObject({ role: Role.MANAGER, authVersion: 0 });

    const applied = await promotion.promote({
      email: target.email,
      dryRun: false,
      confirm: true,
    });
    expect(applied.dryRun).toBe(false);
    const promoted = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(promoted.role).toBe(Role.OWNER);
    expect(promoted.authVersion).toBe(1);

    expect(
      (await request(ctx.app.getHttpServer())
        .get('/employees')
        .set(auth(tokens.accessToken))).status,
    ).toBe(401);
    expect(
      (
        await request(ctx.app.getHttpServer())
          .post('/auth/refresh')
          .send({ refreshToken: tokens.refreshToken })
      ).status,
    ).toBe(401);

    const fresh = await apiLogin(ctx, target.email);
    expect(fresh.role).toBe(Role.OWNER);
  });
});

describeWithDatabase('Hierarchy in cookie mode (CSRF preserved)', () => {
  let ctx: TestContext;
  const ORIGIN = 'http://localhost:3001';

  beforeAll(async () => {
    ctx = await createTestApp({
      env: {
        AUTH_COOKIE_MODE: 'cookie',
        FRONTEND_ORIGIN: ORIGIN,
        COOKIE_SECURE: 'false',
      },
    });
    await resetDatabase(ctx.prisma);
    await createUser(ctx.prisma, {
      email: 'cookie.owner@test.local',
      name: 'Cookie Owner',
      role: Role.OWNER,
    });
    const manager = await createUser(ctx.prisma, {
      email: 'cookie.manager@test.local',
      name: 'Cookie Manager',
      role: Role.MANAGER,
      grantReviewPermissions: false,
    });
    await createUser(ctx.prisma, {
      email: 'cookie.employee@test.local',
      name: 'Cookie Employee',
      role: Role.EMPLOYEE,
      managerUserId: manager.id,
    });
  });

  afterAll(async () => {
    await ctx.close();
    process.env.AUTH_COOKIE_MODE = 'legacy';
    process.env.FRONTEND_ORIGIN = 'http://localhost:3000';
    process.env.COOKIE_SECURE = 'false';
  });

  it('keeps OWNER-only actions, team reads and CSRF in cookie mode', async () => {
    const loginCookie = async (email: string) => {
      const agent = request.agent(ctx.app.getHttpServer());
      const bootstrap = await agent.get('/auth/csrf').set('Origin', ORIGIN);
      const login = await agent
        .post('/auth/login')
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', bootstrap.body.data.csrfToken)
        .send({ email, password: PASSWORD });
      expect(login.status).toBe(200);
      return {
        agent,
        csrf: login.body.data.csrfToken as string,
      };
    };

    const owner = await loginCookie('cookie.owner@test.local');
    const manager = await loginCookie('cookie.manager@test.local');
    const employee = await loginCookie('cookie.employee@test.local');

    expect((await owner.agent.get('/employees')).status).toBe(200);
    expect((await manager.agent.get('/employees')).status).toBe(200);
    expect((await employee.agent.get('/employees')).status).toBe(403);

    // OWNER without CSRF: blocked by the global mutation guard.
    expect(
      (
        await owner.agent.post('/employees').set('Origin', ORIGIN).send({
          name: 'No CSRF',
          email: 'cookie.nocsrf@test.local',
          password: PASSWORD,
          role: 'EMPLOYEE',
        })
      ).status,
    ).toBe(403);

    const created = await owner.agent
      .post('/employees')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', owner.csrf)
      .send({
        name: 'Cookie Created',
        email: 'cookie.created@test.local',
        password: PASSWORD,
        role: 'EMPLOYEE',
      });
    expect(created.status).toBe(201);

    // A Manager is denied even with a valid CSRF token.
    expect(
      (
        await manager.agent
          .post('/employees')
          .set('Origin', ORIGIN)
          .set('X-CSRF-Token', manager.csrf)
          .send({
            name: 'Manager Forbidden',
            email: 'cookie.forbidden@test.local',
            password: PASSWORD,
            role: 'EMPLOYEE',
          })
      ).status,
    ).toBe(403);

    const managerId = (
      await ctx.prisma.user.findUniqueOrThrow({
        where: { email: 'cookie.manager@test.local' },
      })
    ).id;
    const permissions = await owner.agent
      .patch(`/managers/${managerId}/permissions`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', owner.csrf)
      .send({ canApprove: true, canReject: false });
    expect(permissions.status).toBe(200);
    expect(permissions.body.data.capabilities).toEqual({
      approveProperties: true,
      rejectProperties: false,
    });
  });
});

async function apiLogin(ctx: TestContext, email: string) {
  const response = await request(ctx.app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  return {
    accessToken: response.body.data.accessToken as string,
    refreshToken: response.body.data.refreshToken as string,
    role: JSON.parse(
      Buffer.from(
        (response.body.data.accessToken as string).split('.')[1] as string,
        'base64url',
      ).toString('utf8'),
    ).role as Role,
  };
}
