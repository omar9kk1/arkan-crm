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

jest.setTimeout(180000);

interface FinanceItem {
  id: string;
  reference: string;
  kind: 'deal' | 'commission' | 'payroll' | 'manual';
  sourceType: string;
  sourceId: string;
  direction: 'INCOME' | 'EXPENSE';
  amount: string;
  currency: string;
  occurredAt: string;
  status: string;
  counterparty: string;
  property: { id: string; code: string; title: string } | null;
  client: { id: string; name: string } | null;
  employee: { id: string; name: string } | null;
  manager: { id: string; name: string } | null;
  dealId: string | null;
  commissionId: string | null;
  manualExpenseId: string | null;
  calculation: string[];
}

interface Ledger {
  items: FinanceItem[];
  nextCursor: string | null;
  summaries: Array<{
    currency: string;
    count: number;
    income: string;
    commission: string;
    payroll: string;
    manual: string;
    pendingCommission: string;
    pendingPayroll: string;
    net: string;
  }>;
  parties: string[];
}

interface DealResponse {
  id: string;
  reference: string;
  companyCommission: string;
  propertyCommission: string;
  clientCommission: string;
}

describeWithDatabase('Finance ledger', () => {
  let ctx: TestContext;
  let ownerId: string;
  let managerId: string;
  let employeeUserId: string;
  let employeeProfileId: string;
  let ownerToken: string;
  let managerToken: string;
  let employeeToken: string;

  const api = () => request(ctx.app.getHttpServer());
  const today = () => new Date().toISOString().slice(0, 10);

  async function createProperty(reference = `FIN-${randomUUID().slice(0, 8)}`) {
    return ctx.prisma.property.create({
      data: {
        reference,
        title: `Finance property ${reference}`,
        area: '400',
        governorate: 'العاصمة',
        district: 'الشرق',
        listingType: 'SALE',
        status: 'AVAILABLE',
        currency: 'KWD',
        createdByUserId: employeeUserId,
        createdById: employeeProfileId,
      },
      select: { id: true, reference: true, title: true },
    });
  }

  async function createClient(name = 'Finance Client') {
    return ctx.prisma.client.create({
      data: {
        name,
        phone: `6${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        createdById: employeeProfileId,
        responsibleEmployeeId: employeeProfileId,
      },
      select: { id: true, name: true },
    });
  }

  async function createDeal(overrides: Record<string, unknown> = {}) {
    const property = await createProperty();
    const client = await createClient();
    const response = await api()
      .post('/deals')
      .set(auth(ownerToken))
      .send({
        propertyId: property.id,
        clientId: client.id,
        propertyEmployeeUserId: employeeUserId,
        clientEmployeeUserId: employeeUserId,
        type: 'SALE',
        price: '1.234',
        companyCommission: '0.011',
        propertyCommission: '0.001',
        clientCommission: '0.010',
        closedAt: today(),
        notes: 'Finance linkage deal',
        ...overrides,
      });
    expect(response.status).toBe(201);
    return {
      deal: response.body.data as DealResponse,
      property,
      client,
    };
  }

  async function ledger(query = ''): Promise<Ledger> {
    const response = await api()
      .get(`/finance${query}`)
      .set(auth(ownerToken));
    expect(response.status).toBe(200);
    return response.body.data as Ledger;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const owner = await createUser(ctx.prisma, {
      email: 'finance.owner@test.local',
      name: 'Finance Owner',
      role: Role.OWNER,
    });
    const manager = await createUser(ctx.prisma, {
      email: 'finance.manager@test.local',
      name: 'Finance Manager',
      role: Role.MANAGER,
    });
    const employee = await createUser(ctx.prisma, {
      email: 'finance.employee@test.local',
      name: 'Finance Employee',
      role: Role.EMPLOYEE,
      managerUserId: manager.id,
    });
    const profile = await ctx.prisma.employeeProfile.findUniqueOrThrow({
      where: { userId: employee.id },
      select: { id: true },
    });
    ownerId = owner.id;
    managerId = manager.id;
    employeeUserId = employee.id;
    employeeProfileId = profile.id;
    ownerToken = await login(ctx.app, owner.email);
    managerToken = await login(ctx.app, manager.email);
    employeeToken = await login(ctx.app, employee.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('creates one linked ledger row per deal and commission, exactly once', async () => {
    const { deal, property, client } = await createDeal();

    const first = await ledger(`?query=${encodeURIComponent(deal.reference)}`);
    const linked = first.items.filter((item) => item.dealId === deal.id);
    expect(linked).toHaveLength(3);
    expect(linked.filter((item) => item.kind === 'deal')).toHaveLength(1);
    expect(linked.filter((item) => item.kind === 'commission')).toHaveLength(2);

    const income = linked.find((item) => item.kind === 'deal');
    expect(income).toMatchObject({
      direction: 'INCOME',
      amount: '0.011',
      currency: 'KWD',
      status: 'EARNED',
      dealId: deal.id,
    });
    expect(income?.property?.id).toBe(property.id);
    expect(income?.client?.id).toBe(client.id);
    expect(income?.employee?.id).toBe(employeeUserId);
    expect(income?.manager?.id).toBe(managerId);
    expect(income?.calculation.join('\n')).toContain('قيمة الصفقة: 1.234');

    const commissions = linked.filter((item) => item.kind === 'commission');
    expect(commissions.map((item) => item.amount).sort()).toEqual([
      '0.001',
      '0.010',
    ]);
    for (const item of commissions) {
      expect(item.direction).toBe('EXPENSE');
      expect(item.status).toBe('PENDING');
      expect(item.commissionId).not.toBeNull();
      expect(item.dealId).toBe(deal.id);
      expect(item.employee?.id).toBe(employeeUserId);
      expect(item.manager?.id).toBe(managerId);
    }

    const bucket = first.summaries.find((row) => row.currency === 'KWD');
    expect(bucket).toMatchObject({
      count: 3,
      income: '0.011',
      commission: '0.000',
      pendingCommission: '0.011',
      manual: '0.000',
      net: '0.011',
    });

    // Reloading the same page never duplicates the movements.
    const second = await ledger(`?query=${encodeURIComponent(deal.reference)}`);
    expect(second.items.map((item) => item.id).sort()).toEqual(
      first.items.map((item) => item.id).sort(),
    );
    expect(
      await ctx.prisma.financeMovement.count({
        where: {
          OR: [
            { sourceType: 'DEAL', sourceId: deal.id },
            { commission: { dealId: deal.id } },
          ],
        },
      }),
    ).toBe(3);
    expect(bucket?.net).toBe('0.011');
  });

  it('confirms commission payouts once, counts paid cash only, and is retry/concurrency safe', async () => {
    const { deal, property } = await createDeal({
      price: '10.123',
      companyCommission: '0.020',
      propertyCommission: '0.005',
      clientCommission: '0.006',
    });
    const before = await ledger(`?query=${encodeURIComponent(deal.reference)}`);
    const commissions = before.items.filter(
      (item) => item.kind === 'commission' && item.dealId === deal.id,
    );
    expect(commissions).toHaveLength(2);
    const first = commissions.find((item) => item.amount === '0.005')!;
    const second = commissions.find((item) => item.amount === '0.006')!;

    const paid = await api()
      .post(`/finance/commissions/${first.commissionId}/pay`)
      .set(auth(ownerToken))
      .send({ paidAt: '2026-11-10' });
    expect(paid.status).toBe(201);
    expect(paid.body.data).toMatchObject({
      commissionId: first.commissionId,
      status: 'PAID',
      amount: '0.005',
      currency: 'KWD',
      paidAt: '2026-11-10',
      paidBy: { id: ownerId, name: 'Finance Owner' },
    });
    const movementId = paid.body.data.movement.id as string;

    const retry = await api()
      .post(`/finance/commissions/${first.commissionId}/pay`)
      .set(auth(ownerToken))
      .send({ paidAt: '2026-11-11' });
    expect(retry.status).toBe(201);
    expect(retry.body.data.movement.id).toBe(movementId);
    expect(retry.body.data.paidAt).toBe('2026-11-10');

    // Exactly one notification for the employee who owns this commission; the
    // retry above must not send another one.
    const payoutNotifications = () =>
      ctx.prisma.notification.findMany({
        where: { eventKey: `COMMISSION_PAID:${first.commissionId!}` },
      });
    let notifications = await payoutNotifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.userId).toBe(employeeUserId);
    expect(notifications[0]?.propertyId).toBe(property.id);
    expect(notifications[0]?.body).toContain(property.reference);
    expect(notifications[0]?.body).toContain('0.005');
    expect(notifications[0]?.body).toContain('د.ك');

    // Deal details expose the real commission id + payout status for the
    // drawer, never the employee id as the payout key.
    const dealDetail = await api()
      .get(`/deals/${deal.id}`)
      .set(auth(ownerToken));
    expect(dealDetail.status).toBe(200);
    const detailCommissions = (
      dealDetail.body.data as {
        commissions: Array<{
          id: string;
          role: string;
          amount: string;
          status: string;
          paidAt: string | null;
          employeeUserId: string;
        }>;
      }
    ).commissions;
    expect(detailCommissions).toHaveLength(2);
    expect(detailCommissions).toEqual(
      expect.arrayContaining([
        {
          id: first.commissionId!,
          role: 'PROPERTY_EMPLOYEE',
          amount: '0.005',
          status: 'PAID',
          paidAt: '2026-11-10',
          employeeUserId,
        },
        expect.objectContaining({
          id: second.commissionId!,
          role: 'CLIENT_EMPLOYEE',
          amount: '0.006',
          status: 'PENDING',
          paidAt: null,
          employeeUserId,
        }),
      ]),
    );

    const afterOne = await ledger(`?query=${encodeURIComponent(deal.reference)}`);
    const firstAfter = afterOne.items.find((item) => item.id === movementId);
    expect(firstAfter?.status).toBe('PAID');
    let bucket = afterOne.summaries.find((row) => row.currency === 'KWD')!;
    expect(bucket).toMatchObject({
      income: '0.020',
      commission: '0.005',
      pendingCommission: '0.006',
      net: '0.015',
    });

    const concurrent = await Promise.all([
      api()
        .post(`/finance/commissions/${second.commissionId}/pay`)
        .set(auth(ownerToken))
        .send({ paidAt: '2026-11-12' }),
      api()
        .post(`/finance/commissions/${second.commissionId}/pay`)
        .set(auth(ownerToken))
        .send({ paidAt: '2026-11-12' }),
    ]);
    expect(concurrent.map((response) => response.status)).toEqual([201, 201]);
    expect(concurrent[0].body.data.movement.id).toBe(
      concurrent[1].body.data.movement.id,
    );
    notifications = await payoutNotifications();
    expect(notifications).toHaveLength(1);
    const secondNotifications = await ctx.prisma.notification.count({
      where: { eventKey: `COMMISSION_PAID:${second.commissionId!}` },
    });
    expect(secondNotifications).toBe(1);

    const afterBoth = await ledger(`?query=${encodeURIComponent(deal.reference)}`);
    bucket = afterBoth.summaries.find((row) => row.currency === 'KWD')!;
    expect(bucket).toMatchObject({
      income: '0.020',
      commission: '0.011',
      pendingCommission: '0.000',
      net: '0.009',
    });
    expect(
      await ctx.prisma.financeMovement.count({
        where: {
          sourceType: 'COMMISSION',
          sourceId: { in: [first.commissionId!, second.commissionId!] },
        },
      }),
    ).toBe(2);
    expect(
      await ctx.prisma.auditLog.count({
        where: {
          action: 'FINANCE_COMMISSION_PAYOUT_CONFIRM',
          entityId: second.commissionId!,
        },
      }),
    ).toBe(1);
  });

  it('persists manual expenses with exact fils and deduplicates concurrent retries', async () => {
    const property = await createProperty();
    const key = randomUUID();
    const payload = {
      type: 'تصوير عقار',
      amount: '0.001',
      currency: 'KWD',
      date: today(),
      propertyId: property.id,
      description: 'Manual expense exact fils',
      requestId: key,
    };
    const first = await api()
      .post('/finance/manual-expenses')
      .set(auth(ownerToken))
      .send(payload);
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      kind: 'manual',
      amount: '0.001',
      currency: 'KWD',
      status: 'RECORDED',
      property: { id: property.id },
    });

    const retry = await api()
      .post('/finance/manual-expenses')
      .set(auth(ownerToken))
      .send(payload);
    expect(retry.status).toBe(201);
    expect(retry.body.data.id).toBe(first.body.data.id);

    const concurrentKey = randomUUID();
    const concurrent = await Promise.all([
      api()
        .post('/finance/manual-expenses')
        .set(auth(ownerToken))
        .send({ ...payload, requestId: concurrentKey, amount: '0.002' }),
      api()
        .post('/finance/manual-expenses')
        .set(auth(ownerToken))
        .send({ ...payload, requestId: concurrentKey, amount: '0.002' }),
    ]);
    expect(concurrent.map((response) => response.status)).toEqual([201, 201]);
    expect(concurrent[0].body.data.id).toBe(concurrent[1].body.data.id);

    expect(
      await ctx.prisma.manualExpense.count({
        where: { reference: { in: [`ME-${key}`, `ME-${concurrentKey}`] } },
      }),
    ).toBe(2);
    expect(
      await ctx.prisma.financeMovement.count({
        where: {
          sourceType: 'MANUAL_EXPENSE',
          sourceId: {
            in: [
              first.body.data.manualExpenseId as string,
              concurrent[0].body.data.manualExpenseId as string,
            ],
          },
        },
      }),
    ).toBe(2);

    const listed = await ledger(
      `?type=manual&query=${encodeURIComponent('Manual expense exact fils')}`,
    );
    expect(listed.items.some((item) => item.id === first.body.data.id)).toBe(
      true,
    );
    const bucket = listed.summaries.find((row) => row.currency === 'KWD')!;
    // 0.001 from the idempotent first expense + 0.002 from the concurrent pair.
    expect(bucket.manual).toBe('0.003');
    expect(bucket.net).toBe('-0.003');
  });

  it('applies period/type/party/search filters and cursor pagination exactly', async () => {
    const prefix = `PAGE-${randomUUID().slice(0, 8)}`;
    const key = `PAGINATION-${randomUUID().slice(0, 8)}`;
    const dates = ['2020-01-01', today(), today(), today(), today()];
    for (const date of dates) {
      const response = await api()
        .post('/finance/manual-expenses')
        .set(auth(ownerToken))
        .send({
          type: 'أخرى',
          amount: '0.001',
          currency: 'KWD',
          date,
          description: `${prefix} ${key}`,
          requestId: randomUUID(),
        });
      expect(response.status).toBe(201);
    }

    const all = await ledger(`?type=manual&query=${encodeURIComponent(prefix)}`);
    expect(all.items).toHaveLength(5);
    expect(all.items.every((item) => item.kind === 'manual')).toBe(true);
    expect(all.parties).toContain('مصروفات الشركة');

    const todayOnly = await ledger(
      `?type=manual&period=today&query=${encodeURIComponent(prefix)}`,
    );
    expect(todayOnly.items).toHaveLength(4);
    expect(
      todayOnly.items.every((item) => item.occurredAt === today()),
    ).toBe(true);

    const searched = await ledger(
      `?type=manual&query=${encodeURIComponent(key)}`,
    );
    expect(searched.items).toHaveLength(5);

    const byParty = await ledger(
      `?type=manual&party=${encodeURIComponent('مصروفات الشركة')}&query=${encodeURIComponent(prefix)}`,
    );
    expect(byParty.items).toHaveLength(5);

    const ids: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await ledger(
        `?type=manual&limit=2&query=${encodeURIComponent(prefix)}${
          cursor ? `&cursor=${cursor}` : ''
        }`,
      );
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 10);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(pages).toBe(3);
    const bucket = all.summaries.find((row) => row.currency === 'KWD')!;
    expect(bucket.count).toBe(5);
    expect(bucket.manual).toBe('0.005');
  });

  it('denies MANAGER and EMPLOYEE access to every Finance endpoint', async () => {
    for (const token of [managerToken, employeeToken]) {
      const list = await api().get('/finance').set(auth(token));
      expect(list.status).toBe(403);
      const options = await api().get('/finance/options').set(auth(token));
      expect(options.status).toBe(403);
      const manual = await api()
        .post('/finance/manual-expenses')
        .set(auth(token))
        .send({
          type: 'أخرى',
          amount: '0.001',
          currency: 'KWD',
          date: today(),
          description: 'must be denied',
          requestId: randomUUID(),
        });
      expect(manual.status).toBe(403);
      const payout = await api()
        .post(`/finance/commissions/${randomUUID()}/pay`)
        .set(auth(token))
        .send({ paidAt: today() });
      expect(payout.status).toBe(403);
    }

    expect((await api().get('/finance')).status).toBe(401);
    const ownerOptions = await api()
      .get('/finance/options')
      .set(auth(ownerToken));
    expect(ownerOptions.status).toBe(200);
    expect(Array.isArray(ownerOptions.body.data.properties)).toBe(true);
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: 'FINANCE_MANUAL_EXPENSE_CREATE' },
      }),
    ).toBeGreaterThan(0);
  });
});
