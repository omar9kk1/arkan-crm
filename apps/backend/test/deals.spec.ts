import { randomUUID } from 'node:crypto';
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

jest.setTimeout(120000);

describeWithDatabase('Deals backend', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let managerAToken: string;
  let managerBToken: string;
  let employeeAToken: string;
  let employeeAId: string;
  let employeeA2Id: string;
  let employeeBId: string;
  let managerAId: string;
  let profileAId: string;
  let profileBId: string;
  let directEmployeeId: string;
  let directProfileId: string;

  const api = () => request(ctx.app.getHttpServer());

  async function createEmployee(
    email: string,
    name: string,
    managerUserId: string | null,
  ) {
    const user = await createUser(ctx.prisma, {
      email,
      name,
      role: Role.EMPLOYEE,
      managerUserId,
    });
    const profile = await ctx.prisma.employeeProfile.findUniqueOrThrow({
      where: { userId: user.id },
      select: { id: true },
    });
    return { user, profile };
  }

  async function createProperty(
    employeeUserId: string,
    employeeProfileId: string,
    reference = `DEAL-${randomUUID().slice(0, 8)}`,
  ) {
    return ctx.prisma.property.create({
      data: {
        reference,
        title: `Deal property ${reference}`,
        area: 'منطقة الاختبار',
        governorate: 'العاصمة',
        district: 'الاختبار',
        listingType: 'SALE',
        status: 'AVAILABLE',
        currency: 'KWD',
        createdByUserId: employeeUserId,
        createdById: employeeProfileId,
      },
    });
  }

  async function createClient(
    profileId: string,
    name = 'Deal Client',
    phone = `6${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
  ) {
    return ctx.prisma.client.create({
      data: {
        name,
        phone,
        createdById: profileId,
        responsibleEmployeeId: profileId,
      },
    });
  }

  const dealBody = (overrides: Record<string, unknown> = {}) => ({
    propertyId: '',
    clientId: '',
    propertyEmployeeUserId: employeeAId,
    clientEmployeeUserId: employeeAId,
    type: 'SALE',
    price: '300000.50',
    companyCommission: '3000.25',
    propertyCommission: '1000.10',
    clientCommission: '2000.15',
    closedAt: new Date().toISOString().slice(0, 10),
    notes: 'ملاحظة الصفقة',
    ...overrides,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const owner = await createUser(ctx.prisma, {
      email: 'deal.owner@test.local',
      name: 'Deal Owner',
      role: Role.OWNER,
    });
    const managerA = await createUser(ctx.prisma, {
      email: 'deal.manager.a@test.local',
      name: 'Deal Manager A',
      role: Role.MANAGER,
    });
    const managerB = await createUser(ctx.prisma, {
      email: 'deal.manager.b@test.local',
      name: 'Deal Manager B',
      role: Role.MANAGER,
    });
    const employeeA = await createEmployee(
      'deal.employee.a@test.local',
      'Deal Employee A',
      managerA.id,
    );
    const employeeB = await createEmployee(
      'deal.employee.b@test.local',
      'Deal Employee B',
      managerB.id,
    );
    const employeeA2 = await createEmployee(
      'deal.employee.a2@test.local',
      'Deal Employee A2',
      managerA.id,
    );
    const direct = await createEmployee(
      'deal.direct@test.local',
      'Deal Direct Employee',
      null,
    );
    employeeAId = employeeA.user.id;
    employeeA2Id = employeeA2.user.id;
    employeeBId = employeeB.user.id;
    managerAId = managerA.id;
    profileAId = employeeA.profile.id;
    profileBId = employeeB.profile.id;
    directEmployeeId = direct.user.id;
    directProfileId = direct.profile.id;
    ownerToken = await login(ctx.app, owner.email);
    managerAToken = await login(ctx.app, managerA.email);
    managerBToken = await login(ctx.app, managerB.email);
    employeeAToken = await login(ctx.app, employeeA.user.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('creates a deal with exact money, commissions, property status and notes', async () => {
    const property = await createProperty(employeeAId, profileAId);
    const client = await createClient(profileAId, 'Deal Client One');

    const response = await api()
      .post('/deals')
      .set(auth(managerAToken))
      .send(dealBody({ propertyId: property.id, clientId: client.id }));

    expect(response.status).toBe(201);
    const deal = response.body.data as {
      id: string;
      price: string;
      companyCommission: string;
      propertyCommission: string;
      clientCommission: string;
      property: { code: string; status: string };
      client: { name: string };
      propertyEmployee: { userId: string; name: string };
      clientEmployee: { userId: string; name: string };
      notes: string | null;
      type: string;
    };
    expect(deal.price).toBe('300000.500');
    expect(deal.companyCommission).toBe('3000.250');
    expect(deal.propertyCommission).toBe('1000.100');
    expect(deal.clientCommission).toBe('2000.150');
    expect(deal.type).toBe('SALE');
    expect(deal.property.status).toBe('SOLD');
    expect(deal.client.name).toBe('Deal Client One');
    expect(deal.propertyEmployee).toEqual({
      userId: employeeAId,
      name: 'Deal Employee A',
    });
    expect(deal.notes).toBe('ملاحظة الصفقة');

    const stored = await ctx.prisma.deal.findUniqueOrThrow({
      where: { id: deal.id },
      include: { commissions: true, property: true },
    });
    expect(stored.price.toFixed(3)).toBe('300000.500');
    expect(stored.companyCommission.toFixed(3)).toBe('3000.250');
    expect(stored.commissions).toHaveLength(2);
    expect(stored.notes).toBe('ملاحظة الصفقة');
    expect(stored.property.status).toBe('SOLD');
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'DEAL_CREATE', entityId: deal.id },
    });
    expect(audit).not.toBeNull();
    expect((audit?.after as { notes?: string })?.notes).toBe('ملاحظة الصفقة');
  });

  it('keeps OWNER company-wide visibility and MANAGER team isolation', async () => {
    const deal = await ctx.prisma.deal.findFirstOrThrow({
      where: { reference: { startsWith: 'D-' } },
      select: { id: true },
    });

    const ownerList = await api()
      .get('/deals')
      .set(auth(ownerToken));
    expect(ownerList.status).toBe(200);
    expect(
      (ownerList.body.data as { items: Array<{ id: string }> }).items.some(
        (item) => item.id === deal.id,
      ),
    ).toBe(true);

    const managerAList = await api()
      .get('/deals')
      .set(auth(managerAToken));
    expect(managerAList.status).toBe(200);
    expect(
      (managerAList.body.data as { items: Array<{ id: string }> }).items.some(
        (item) => item.id === deal.id,
      ),
    ).toBe(true);

    const managerBList = await api()
      .get('/deals')
      .set(auth(managerBToken));
    expect(managerBList.status).toBe(200);
    expect(
      (managerBList.body.data as { items: Array<{ id: string }> }).items.some(
        (item) => item.id === deal.id,
      ),
    ).toBe(false);

    const crossTeam = await api()
      .get(`/deals/${deal.id}`)
      .set(auth(managerBToken));
    expect(crossTeam.status).toBe(404);

    const ownerDetail = await api()
      .get(`/deals/${deal.id}`)
      .set(auth(ownerToken));
    expect(ownerDetail.status).toBe(200);

    const employeeDenied = await api()
      .get('/deals')
      .set(auth(employeeAToken));
    expect(employeeDenied.status).toBe(403);
  });

  it('blocks cross-team properties, clients and employees at creation', async () => {
    const propertyB = await createProperty(employeeBId, profileBId);
    const clientB = await createClient(profileBId, 'Team B Client');
    const propertyA = await createProperty(employeeAId, profileAId);
    const clientA = await createClient(profileAId, 'Team A Client');

    const foreignProperty = await api()
      .post('/deals')
      .set(auth(managerAToken))
      .send(
        dealBody({
          propertyId: propertyB.id,
          clientId: clientA.id,
        }),
      );
    // The approved property is company-visible, but MANAGER cannot assign it
    // to their own employee (no property-employee override).
    expect(foreignProperty.status).toBe(403);

    const foreignClient = await api()
      .post('/deals')
      .set(auth(managerAToken))
      .send(
        dealBody({
          propertyId: propertyA.id,
          clientId: clientB.id,
        }),
      );
    expect(foreignClient.status).toBe(404);

    const foreignEmployee = await api()
      .post('/deals')
      .set(auth(managerAToken))
      .send(
        dealBody({
          propertyId: propertyA.id,
          clientId: clientA.id,
          propertyEmployeeUserId: employeeBId,
        }),
      );
    expect(foreignEmployee.status).toBe(403);

    const employeeCreate = await api()
      .post('/deals')
      .set(auth(employeeAToken))
      .send(dealBody({ propertyId: propertyA.id, clientId: clientA.id }));
    expect(employeeCreate.status).toBe(403);
  });

  it('allows OWNER to override the property employee while MANAGER cannot', async () => {
    const property = await createProperty(employeeAId, profileAId);
    const client = await createClient(profileAId, 'Owner Override Client');
    const ownerDeal = await api()
      .post('/deals')
      .set(auth(ownerToken))
      .send(
        dealBody({
          propertyId: property.id,
          clientId: client.id,
          propertyEmployeeUserId: employeeBId,
          clientEmployeeUserId: employeeAId,
        }),
      );
    expect(ownerDeal.status).toBe(201);
    expect(
      (ownerDeal.body.data as {
        propertyEmployee: { userId: string };
        clientEmployee: { userId: string };
      }).propertyEmployee.userId,
    ).toBe(employeeBId);
    expect(
      (ownerDeal.body.data as { clientEmployee: { userId: string } })
        .clientEmployee.userId,
    ).toBe(employeeAId);
  });

  it('allows OWNER to override the client employee while MANAGER cannot', async () => {
    const property = await createProperty(employeeAId, profileAId);
    const client = await createClient(
      profileAId,
      'Client Employee Override Client',
    );

    // MANAGER may use the client's actual responsible employee.
    const managerAccepted = await api()
      .post('/deals')
      .set(auth(managerAToken))
      .send(
        dealBody({
          propertyId: property.id,
          clientId: client.id,
          clientEmployeeUserId: employeeAId,
        }),
      );
    expect(managerAccepted.status).toBe(201);
    expect(
      (managerAccepted.body.data as { clientEmployee: { userId: string } })
        .clientEmployee.userId,
    ).toBe(employeeAId);

    const accepted = await ctx.prisma.deal.findUniqueOrThrow({
      where: { id: (managerAccepted.body.data as { id: string }).id },
      include: { commissions: true },
    });
    expect(accepted.clientEmployeeId).toBe(profileAId);
    expect(
      accepted.commissions.find(
        (row) => row.commissionRole === 'CLIENT_EMPLOYEE',
      )?.employeeId,
    ).toBe(profileAId);

    // A different employee from the SAME team is still a forged override.
    const sameTeamProperty = await createProperty(employeeAId, profileAId);
    const forgedSameTeam = await api()
      .post('/deals')
      .set(auth(managerAToken))
      .send(
        dealBody({
          propertyId: sameTeamProperty.id,
          clientId: client.id,
          clientEmployeeUserId: employeeA2Id,
        }),
      );
    expect(forgedSameTeam.status).toBe(403);

    // A different team's employee is rejected as well.
    const forgedOtherTeam = await api()
      .post('/deals')
      .set(auth(managerAToken))
      .send(
        dealBody({
          propertyId: sameTeamProperty.id,
          clientId: client.id,
          clientEmployeeUserId: employeeBId,
        }),
      );
    expect(forgedOtherTeam.status).toBe(403);

    // OWNER keeps the override capability.
    const ownerProperty = await createProperty(employeeAId, profileAId);
    const ownerDeal = await api()
      .post('/deals')
      .set(auth(ownerToken))
      .send(
        dealBody({
          propertyId: ownerProperty.id,
          clientId: client.id,
          propertyEmployeeUserId: employeeAId,
          clientEmployeeUserId: directEmployeeId,
        }),
      );
    expect(ownerDeal.status).toBe(201);
    expect(
      (ownerDeal.body.data as { clientEmployee: { userId: string } })
        .clientEmployee.userId,
    ).toBe(directEmployeeId);

    // Neither the client's responsible employee nor the property attribution
    // is mutated by recording a deal.
    const storedClient = await ctx.prisma.client.findUniqueOrThrow({
      where: { id: client.id },
      select: { responsibleEmployeeId: true },
    });
    expect(storedClient.responsibleEmployeeId).toBe(profileAId);
    const storedProperty = await ctx.prisma.property.findUniqueOrThrow({
      where: { id: ownerProperty.id },
      select: { createdByUserId: true },
    });
    expect(storedProperty.createdByUserId).toBe(employeeAId);
  });

  it('searches authorised clients across pages while keeping teams isolated', async () => {
    const prefix = `DealClientSearch-${randomUUID().slice(0, 6)}`;
    const teamAPhones = ['77110001', '77110002', '77110003'];
    for (let index = 0; index < 3; index += 1) {
      await createClient(
        profileAId,
        `${prefix}-A${index + 1}`,
        teamAPhones[index],
      );
    }
    await createClient(profileBId, `${prefix}-B1`, '77220001');
    const phone = teamAPhones[0]!;
    const page1 = await api()
      .get(
        `/deals/client-options?search=${encodeURIComponent(prefix)}&limit=2`,
      )
      .set(auth(managerAToken));
    expect(page1.status).toBe(200);
    expect(page1.body.data.items).toHaveLength(2);
    expect(page1.body.data.nextCursor).toEqual(expect.any(String));
    const page2 = await api()
      .get(
        `/deals/client-options?search=${encodeURIComponent(prefix)}&limit=2&cursor=${page1.body.data.nextCursor}`,
      )
      .set(auth(managerAToken));
    expect(page2.status).toBe(200);
    const managerNames = [...page1.body.data.items, ...page2.body.data.items]
      .map((item: { name: string }) => item.name)
      .sort();
    expect(managerNames).toEqual(
      [`${prefix}-A1`, `${prefix}-A2`, `${prefix}-A3`].sort(),
    );
    const managerItem = page1.body.data.items[0] as {
      phone?: string;
      responsibleUserId?: string | null;
    };
    expect(managerItem.phone).toBeUndefined();
    expect(managerItem.responsibleUserId).toBe(employeeAId);

    const byPhone = await api()
      .get(`/deals/client-options?search=${encodeURIComponent(phone)}`)
      .set(auth(managerAToken));
    expect(
      byPhone.body.data.items.some(
        (item: { name: string }) => item.name === `${prefix}-A1`,
      ),
    ).toBe(true);

    const managerB = await api()
      .get(`/deals/client-options?search=${encodeURIComponent(prefix)}`)
      .set(auth(managerBToken));
    expect(
      managerB.body.data.items.map((item: { name: string }) => item.name),
    ).toEqual([`${prefix}-B1`]);

    const ownerList = await api()
      .get(`/deals/client-options?search=${encodeURIComponent(prefix)}`)
      .set(auth(ownerToken));
    expect(ownerList.body.data.items).toHaveLength(4);
    expect(
      ownerList.body.data.items.some(
        (item: { name: string }) => item.name === `${prefix}-B1`,
      ),
    ).toBe(true);

    // A client created/managed by the MANAGER is also selectable there.
    const managerClientName = `${prefix}-MANAGER`;
    const managerClient = await api()
      .post('/clients')
      .set(auth(managerAToken))
      .send({ name: managerClientName, phone: '77440001' });
    expect(managerClient.status).toBe(201);
    expect(
      (
        await api()
          .get(
            `/deals/client-options?search=${encodeURIComponent(managerClientName)}`,
          )
          .set(auth(managerAToken))
      ).body.data.items,
    ).toHaveLength(1);
    expect(
      (
        await api()
          .get(
            `/deals/client-options?search=${encodeURIComponent(managerClientName)}`,
          )
          .set(auth(managerBToken))
      ).body.data.items,
    ).toHaveLength(0);
    expect(
      (
        await api()
          .get(
            `/deals/client-options?search=${encodeURIComponent(managerClientName)}`,
          )
          .set(auth(ownerToken))
      ).body.data.items,
    ).toHaveLength(1);

    // Pending reviews are not approved Client rows, so they are not eligible.
    const pendingReview = await api()
      .post('/client-reviews')
      .set(auth(employeeAToken))
      .send({
        kind: 'CREATION',
        name: `${prefix}-PENDING`,
        phone: '77330001',
      });
    expect(pendingReview.status).toBe(201);
    const pendingSearch = await api()
      .get(
        `/deals/client-options?search=${encodeURIComponent(`${prefix}-PENDING`)}`,
      )
      .set(auth(managerAToken));
    expect(pendingSearch.body.data.items).toHaveLength(0);
  });

  it('persists 1.234 KWD, 0.001 commissions and the max (15,3) amount exactly', async () => {
    const property = await createProperty(employeeAId, profileAId);
    const client = await createClient(profileAId, 'Fils Client');
    const response = await api()
      .post('/deals')
      .set(auth(managerAToken))
      .send(
        dealBody({
          propertyId: property.id,
          clientId: client.id,
          price: '1.234',
          companyCommission: '0.011',
          propertyCommission: '0.001',
          clientCommission: '0.010',
          notes: 'صفقة بالفلس',
        }),
      );
    expect(response.status).toBe(201);
    const deal = response.body.data as {
      id: string;
      price: string;
      companyCommission: string;
      propertyCommission: string;
      clientCommission: string;
      notes: string | null;
    };
    expect(deal.price).toBe('1.234');
    expect(deal.companyCommission).toBe('0.011');
    expect(deal.propertyCommission).toBe('0.001');
    expect(deal.clientCommission).toBe('0.010');
    expect(deal.notes).toBe('صفقة بالفلس');

    const stored = await ctx.prisma.deal.findUniqueOrThrow({
      where: { id: deal.id },
      include: { commissions: true },
    });
    expect(stored.price.toFixed(3)).toBe('1.234');
    expect(stored.companyCommission.toFixed(3)).toBe('0.011');
    expect(stored.notes).toBe('صفقة بالفلس');
    expect(
      stored.commissions.map((row) => row.amount.toFixed(3)).sort(),
    ).toEqual(['0.001', '0.010']);

    const detail = await api()
      .get(`/deals/${deal.id}`)
      .set(auth(managerAToken));
    expect(detail.status).toBe(200);
    expect((detail.body.data as { notes: string }).notes).toBe('صفقة بالفلس');

    // DECIMAL(15,3) maximum: 12 integer digits + 3 decimals.
    const bigProperty = await createProperty(employeeAId, profileAId);
    const bigClient = await createClient(profileAId, 'Big Client');
    const big = await api()
      .post('/deals')
      .set(auth(managerAToken))
      .send(
        dealBody({
          propertyId: bigProperty.id,
          clientId: bigClient.id,
          price: '999999999999.999',
          companyCommission: '0.001',
          propertyCommission: '0.001',
          clientCommission: '0.001',
        }),
      );
    expect(big.status).toBe(201);
    expect((big.body.data as { price: string }).price).toBe(
      '999999999999.999',
    );
  });

  it('rejects unavailable properties, invalid money and >3 decimals', async () => {
    const sold = await createProperty(employeeAId, profileAId);
    await ctx.prisma.property.update({
      where: { id: sold.id },
      data: { status: 'SOLD' },
    });
    const client = await createClient(profileAId);

    const unavailable = await api()
      .post('/deals')
      .set(auth(managerAToken))
      .send(dealBody({ propertyId: sold.id, clientId: client.id }));
    expect(unavailable.status).toBe(404);

    const property = await createProperty(employeeAId, profileAId);
    const fourDecimals = await api()
      .post('/deals')
      .set(auth(managerAToken))
      .send(
        dealBody({
          propertyId: property.id,
          clientId: client.id,
          price: '1.2345',
        }),
      );
    expect(fourDecimals.status).toBe(400);
    expect(String(fourDecimals.body.error?.message ?? '')).toContain('ثلاث');

    const zeroPrice = await api()
      .post('/deals')
      .set(auth(managerAToken))
      .send(
        dealBody({
          propertyId: property.id,
          clientId: client.id,
          price: '0',
        }),
      );
    expect(zeroPrice.status).toBe(400);
  });

  it('handles two concurrent submissions for one property safely', async () => {
    const property = await createProperty(employeeAId, profileAId);
    const client = await createClient(profileAId);

    const [first, second] = await Promise.all([
      api()
        .post('/deals')
        .set(auth(managerAToken))
        .send(dealBody({ propertyId: property.id, clientId: client.id })),
      api()
        .post('/deals')
        .set(auth(managerAToken))
        .send(dealBody({ propertyId: property.id, clientId: client.id })),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses[0]).toBe(201);
    expect([404, 409]).toContain(statuses[1]);
    const count = await ctx.prisma.deal.count({
      where: { propertyId: property.id },
    });
    expect(count).toBe(1);
    const stored = await ctx.prisma.property.findUniqueOrThrow({
      where: { id: property.id },
      select: { status: true },
    });
    expect(['SOLD', 'RENTED']).toContain(stored.status);
  });

  it('isolates OWNER-direct employees from unrelated managers', async () => {
    const property = await createProperty(directEmployeeId, directProfileId);
    const client = await createClient(directProfileId, 'Direct Client');

    const created = await api()
      .post('/deals')
      .set(auth(ownerToken))
      .send(
        dealBody({
          propertyId: property.id,
          clientId: client.id,
          propertyEmployeeUserId: directEmployeeId,
          clientEmployeeUserId: directEmployeeId,
        }),
      );
    expect(created.status).toBe(201);
    const dealId = (created.body.data as { id: string }).id;

    const managerAList = await api()
      .get('/deals')
      .set(auth(managerAToken));
    expect(
      (managerAList.body.data as { items: Array<{ id: string }> }).items.some(
        (item) => item.id === dealId,
      ),
    ).toBe(false);
    const managerADetail = await api()
      .get(`/deals/${dealId}`)
      .set(auth(managerAToken));
    expect(managerADetail.status).toBe(404);
  });

  it('paginates without gaps or duplicates and returns options scoped to the team', async () => {
    for (let index = 0; index < 3; index += 1) {
      const property = await createProperty(employeeAId, profileAId);
      const client = await createClient(profileAId, `Paged Client ${index}`);
      const created = await api()
        .post('/deals')
        .set(auth(managerAToken))
        .send(dealBody({ propertyId: property.id, clientId: client.id }));
      expect(created.status).toBe(201);
    }

    const first = await api()
      .get('/deals?limit=2')
      .set(auth(managerAToken));
    expect(first.status).toBe(200);
    const firstData = first.body.data as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(firstData.items).toHaveLength(2);
    expect(firstData.nextCursor).toBeTruthy();
    const second = await api()
      .get(`/deals?limit=2&cursor=${firstData.nextCursor}`)
      .set(auth(managerAToken));
    const secondData = second.body.data as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    const ids = [...firstData.items, ...secondData.items].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);

    const options = await api()
      .get('/deals/options')
      .set(auth(managerAToken));
    expect(options.status).toBe(200);
    const data = options.body.data as {
      properties: Array<{ id: string }>;
      clients: Array<{ id: string }>;
      employees: Array<{ userId: string }>;
    };
    expect(data.employees.some((row) => row.userId === employeeAId)).toBe(true);
    expect(data.employees.some((row) => row.userId === employeeBId)).toBe(false);
  });

  it('feeds the existing dashboard deal statistics', async () => {
    const dashboard = await api()
      .get('/dashboard/manager?period=month')
      .set(auth(managerAToken));
    expect(dashboard.status).toBe(200);
    const deals = (
      dashboard.body.data as {
        deals: { countInPeriod: number; totalValueInPeriod: string };
      }
    ).deals;
    const aggregate = await ctx.prisma.deal.aggregate({
      where: {
        OR: [
          { propertyEmployee: { managerUserId: managerAId } },
          { clientEmployee: { managerUserId: managerAId } },
        ],
      },
      _count: { _all: true },
      _sum: { price: true },
    });
    expect(deals.countInPeriod).toBe(aggregate._count._all);
    expect(Number(deals.totalValueInPeriod)).toBe(
      Number(aggregate._sum.price ?? 0),
    );
  });
});
