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
import { formatPropertyCode } from '../src/properties/property-reference';

jest.setTimeout(180000);

const image = [{ buffer: pngBytes(), filename: 'photo.png' }];

/**
 * The permanent sequential property codes (`A-000001`, `A-000002`, …).
 *
 * The legacy codes are retired: the existing rows are renumbered once, the
 * future codes come from a database counter (atomic under concurrency), and a
 * code never changes afterwards.
 */
describeWithDatabase('Sequential property codes', () => {
  let ctx: TestContext;
  let managerToken: string;
  let employeeToken: string;

  const api = () => request(ctx.app.getHttpServer());

  const payload = () => ({
    listingType: 'SALE',
    governorate: 'الفروانية',
    district: 'غرناطة',
    block: '3',
    plotNumber: '12',
    sizeSqm: '400.00',
    askingPrice: '250000.00',
    negotiable: true,
    description: 'بيت مستقل للبيع',
    floors: [{ type: 'GROUND', details: 'صالة' }],
    newContact: { type: 'BROKER', name: 'وسيط', phone: '66661111' },
  });

  const createProperty = async (token = employeeToken) => {
    const response = await postProperty(ctx.app, token, payload(), image);
    expect(response.status).toBe(201);
    return response.body.data as { id: string; reference: string; version: number };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'manager@codes.local',
      name: 'Manager Codes',
      role: Role.MANAGER,
    });
    const employee = await createUser(ctx.prisma, {
      email: 'employee@codes.local',
      name: 'Employee Codes',
      role: Role.EMPLOYEE,
    });
    managerToken = await login(ctx.app, manager.email);
    employeeToken = await login(ctx.app, employee.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('gives every NEW property a sequential A-###### code', async () => {
    const first = await createProperty();
    const second = await createProperty();
    expect(first.reference).toMatch(/^A-\d{6}$/);
    expect(second.reference).toMatch(/^A-\d{6}$/);
    const firstNumber = Number(first.reference.slice(2));
    const secondNumber = Number(second.reference.slice(2));
    expect(secondNumber).toBe(firstNumber + 1);
  });

  it('renumbers the EXISTING properties deterministically (createdAt, id)', async () => {
    // Three properties created in a known order.
    const rows = await ctx.prisma.property.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, reference: true, createdAt: true },
    });
    expect(rows.length).toBeGreaterThan(0);
    // Every existing row carries a sequential code and none is a legacy one.
    rows.forEach((row, index) => {
      expect(row.reference).toBe(formatPropertyCode(index + 1));
      expect(row.reference).not.toMatch(/^AK-/);
    });
    // The mapping is total: no duplicate and no missing code.
    const codes = new Set(rows.map((row) => row.reference));
    expect(codes.size).toBe(rows.length);
    for (let index = 1; index <= rows.length; index += 1) {
      expect(codes.has(formatPropertyCode(index))).toBe(true);
    }
  });

  it('never reuses a code and never changes one when a property is edited', async () => {
    const created = await createProperty();
    const patched = await api()
      .patch(`/properties/${created.id}`)
      .set(auth(employeeToken))
      .send({ version: created.version, askingPrice: '300000.00' });
    expect(patched.status).toBe(200);
    expect((patched.body.data as { reference: string }).reference).toBe(
      created.reference,
    );

    // A review/approval cycle keeps the same code.
    expect(
      (
        await api()
          .post(`/properties/${created.id}/approve`)
          .set(auth(managerToken))
          .send({})
      ).status,
    ).toBe(200);
    const after = await ctx.prisma.property.findUnique({
      where: { id: created.id },
      select: { reference: true },
    });
    expect(after?.reference).toBe(created.reference);
  });

  it('gives concurrent creations DIFFERENT sequential codes', async () => {
    const before = await ctx.prisma.property.count();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => createProperty()),
    );
    const codes = results.map((row) => row.reference);
    expect(new Set(codes).size).toBe(codes.length);
    // The counter advanced once per creation and never skipped a number.
    const numbers = codes.map((code) => Number(code.slice(2))).sort((a, b) => a - b);
    const lowest = numbers[0] as number;
    const highest = numbers[numbers.length - 1] as number;
    expect(highest - lowest).toBe(numbers.length - 1);
    expect(await ctx.prisma.property.count()).toBe(before + 12);
  });

  it('supports far more than 10,000 properties', () => {
    expect(formatPropertyCode(10_000)).toBe('A-010000');
    expect(formatPropertyCode(99_999)).toBe('A-099999');
    expect(formatPropertyCode(1_000_000)).toBe('A-1000000');
    // The counter is a 64-bit integer: it never runs out in practice.
    expect(formatPropertyCode(9_007_199_254_740_991n)).toBe(
      'A-9007199254740991',
    );
  });

  it('finds a property by its new code and keeps the deep links working', async () => {
    const created = await createProperty();
    const search = await api()
      .get(`/properties?q=${encodeURIComponent(created.reference)}`)
      .set(auth(managerToken));
    expect(search.status).toBe(200);
    const items = (search.body.data as { items: { id: string }[] }).items;
    expect(items.some((item) => item.id === created.id)).toBe(true);

    // The exact code resolves through the unique index.
    const exact = await ctx.prisma.property.findUnique({
      where: { reference: created.reference },
      select: { id: true },
    });
    expect(exact?.id).toBe(created.id);

    // The authorized detail still serves the property (the deep link target).
    const detail = await api()
      .get(`/properties/${created.id}`)
      .set(auth(managerToken));
    expect(detail.status).toBe(200);
    expect((detail.body.data as { reference: string }).reference).toBe(
      created.reference,
    );
  });

  it('shows the current code in the linked client/owner records and notifications', async () => {
    const created = await createProperty();
    // The owner record of the property carries the current code.
    const contacts = await api()
      .get('/contacts')
      .set(auth(managerToken));
    expect(contacts.status).toBe(200);
    const contactItems = (
      contacts.body.data as { items: { properties: { reference: string }[] }[] }
    ).items;
    const linked = contactItems.flatMap((item) => item.properties);
    expect(linked.map((row) => row.reference)).toContain(created.reference);

    // A notification about the property resolves the CURRENT code, even when
    // the stored body carries a retired one.
    await ctx.prisma.notification.create({
      data: {
        userId: (await ctx.prisma.user.findUnique({
          where: { email: 'manager@codes.local' },
        }))?.id as string,
        type: 'PROPERTY_SUBMITTED',
        title: 'عقار جديد بانتظار المراجعة',
        body: 'رقم العقار: AK-261016-6E08707329',
        propertyId: created.id,
        eventKey: `TEST_LEGACY_CODE:${created.id}`,
      },
    });
    const inbox = await api()
      .get('/notifications?limit=20')
      .set(auth(managerToken));
    expect(inbox.status).toBe(200);
    const item = (
      inbox.body.data as {
        items: { propertyReference: string | null; message: string }[];
      }
    ).items.find((row) => row.propertyReference !== null);
    expect(item?.propertyReference).toBe(created.reference);
    // The stored history keeps the retired code untouched.
    const stored = await ctx.prisma.notification.findFirst({
      where: { eventKey: `TEST_LEGACY_CODE:${created.id}` },
      select: { body: true },
    });
    expect(stored?.body).toContain('AK-261016-6E08707329');
  });
});
