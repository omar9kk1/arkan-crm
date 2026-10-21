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

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  propertyId: string | null;
}

/**
 * What the MANAGER is told when an employee edits an APPROVED property and
 * sends it back for review.
 *
 * The manager must see the real, verified changes (price, area, …) BEFORE
 * deciding — never a guess, never a private contact, and never a second
 * event: the existing resubmission notification is enriched, not duplicated.
 */
describeWithDatabase('Manager review notification — real changes', () => {
  let ctx: TestContext;
  let managerToken: string;
  let otherManagerToken: string;
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
    newContact: { type: 'BROKER', name: 'وسيط خاص', phone: '66661111' },
  });

  const createProperty = async () => {
    const response = await postProperty(ctx.app, employeeToken, payload(), image);
    expect(response.status).toBe(201);
    return response.body.data as { id: string; version: number };
  };

  const approve = (id: string) =>
    api().post(`/properties/${id}/approve`).set(auth(managerToken)).send({});

  const edit = (id: string, version: number, changes: Record<string, unknown>) =>
    api()
      .patch(`/properties/${id}`)
      .set(auth(employeeToken))
      .send({ version, ...changes });

  const inbox = async (token: string): Promise<NotificationItem[]> => {
    const response = await api()
      .get('/notifications?limit=100')
      .set(auth(token));
    expect(response.status).toBe(200);
    return response.body.data.items as NotificationItem[];
  };

  const reviewAlerts = async (token: string) =>
    (await inbox(token)).filter((item) => item.type === 'PROPERTY_RESUBMITTED');

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'manager@review.local',
      name: 'Manager Review',
      role: Role.MANAGER,
    });
    const otherManager = await createUser(ctx.prisma, {
      email: 'manager.two@review.local',
      name: 'Manager Two Review',
      role: Role.MANAGER,
    });
    const employee = await createUser(ctx.prisma, {
      email: 'employee@review.local',
      name: 'Employee Review',
      role: Role.EMPLOYEE,
    });
    managerToken = await login(ctx.app, manager.email);
    otherManagerToken = await login(ctx.app, otherManager.email);
    employeeToken = await login(ctx.app, employee.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.prisma.notification.deleteMany({});
  });

  it('tells the manager the REAL price change when an approved property is edited', async () => {
    const created = await createProperty();
    expect((await approve(created.id)).status).toBe(200);
    const approved = await ctx.prisma.property.findUnique({
      where: { id: created.id },
      select: { version: true },
    });

    await ctx.prisma.notification.deleteMany({});
    const edited = await edit(created.id, approved?.version as number, {
      askingPrice: '300000.00',
    });
    expect(edited.status).toBe(200);

    const alerts = await reviewAlerts(managerToken);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      title: 'عقار مُعدّل بانتظار موافقتك',
      propertyId: created.id,
    });
    expect(alerts[0]?.message).toContain('A-');
    expect(alerts[0]?.message).toContain('السعر');
    expect(alerts[0]?.message).toContain('250,000');
    expect(alerts[0]?.message).toContain('300,000');
    // Only the price moved.
    expect(alerts[0]?.message).not.toContain('المساحة');
    expect(alerts[0]?.message).not.toContain('الموقع');
    expect(alerts[0]?.message).not.toContain('الوصف');
    // Never a private contact, a phone number or an internal note.
    expect(alerts[0]?.message).not.toContain('66661111');
    expect(alerts[0]?.message).not.toContain('وسيط خاص');
    // The other manager receives the same event (same recipients as before).
    expect(await reviewAlerts(otherManagerToken)).toHaveLength(1);
    // The employee is not told about their own edit.
    expect(await reviewAlerts(employeeToken)).toHaveLength(0);
  });

  it('lists EVERY changed field, and only those', async () => {
    const created = await createProperty();
    expect((await approve(created.id)).status).toBe(200);
    const approved = await ctx.prisma.property.findUnique({
      where: { id: created.id },
      select: { version: true },
    });

    await ctx.prisma.notification.deleteMany({});
    const edited = await edit(created.id, approved?.version as number, {
      askingPrice: '275000.00',
      sizeSqm: '450.00',
      description: 'وصف مختلف تماما',
      district: 'الجهراء',
    });
    expect(edited.status).toBe(200);

    const message = (await reviewAlerts(managerToken))[0]?.message ?? '';
    expect(message).toContain('السعر');
    expect(message).toContain('275,000');
    expect(message).toContain('المساحة');
    expect(message).toContain('450');
    expect(message).toContain('المنطقة');
    expect(message).toContain('الوصف');
    // The description TEXT never reaches the notification preview.
    expect(message).not.toContain('مختلف تماما');
    expect(message).not.toContain('66661111');
  });

  it('does not invent a change when the resubmitted version is identical', async () => {
    const created = await createProperty();
    expect((await approve(created.id)).status).toBe(200);
    const approved = await ctx.prisma.property.findUnique({
      where: { id: created.id },
      select: { version: true },
    });

    await ctx.prisma.notification.deleteMany({});
    const edited = await edit(created.id, approved?.version as number, {
      sizeSqm: '400.00',
    });
    expect(edited.status).toBe(200);

    const alerts = await reviewAlerts(managerToken);
    expect(alerts).toHaveLength(1);
    // No fabricated change list, and the plain review wording is kept.
    expect(alerts[0]?.message).not.toContain('التعديلات:');
    expect(alerts[0]?.message).toMatch(/^رقم العقار: A-/);
  });

  it('finds the baseline even for a property approved BEFORE the snapshots existed', async () => {
    const created = await createProperty();
    expect((await approve(created.id)).status).toBe(200);
    // Remove the approved snapshot: the row itself (which was AVAILABLE
    // before the edit) is the reliable baseline for the current workflow.
    await ctx.prisma.propertyRevision.deleteMany({
      where: { propertyId: created.id },
    });
    const approved = await ctx.prisma.property.findUnique({
      where: { id: created.id },
      select: { version: true },
    });

    await ctx.prisma.notification.deleteMany({});
    const edited = await edit(created.id, approved?.version as number, {
      askingPrice: '199000.00',
    });
    expect(edited.status).toBe(200);

    const alerts = await reviewAlerts(managerToken);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.title).toBe('عقار مُعدّل بانتظار موافقتك');
    expect(alerts[0]?.message).toContain('السعر');
    expect(alerts[0]?.message).toContain('250,000');
    expect(alerts[0]?.message).toContain('199,000');
  });

  it('keeps ONE notification per review round (no duplicates) and one per manager', async () => {
    const created = await createProperty();
    expect((await approve(created.id)).status).toBe(200);
    const approved = await ctx.prisma.property.findUnique({
      where: { id: created.id },
      select: { version: true },
    });

    await ctx.prisma.notification.deleteMany({});
    await edit(created.id, approved?.version as number, {
      askingPrice: '260000.00',
    });
    // A repeated edit of the same round is a conflict, not a second event.
    const stale = await edit(created.id, approved?.version as number, {
      askingPrice: '261000.00',
    });
    expect(stale.status).toBe(409);

    expect(await reviewAlerts(managerToken)).toHaveLength(1);
    expect(await reviewAlerts(otherManagerToken)).toHaveLength(1);
    expect(
      await ctx.prisma.notification.count({
        where: { type: 'PROPERTY_RESUBMITTED' },
      }),
    ).toBe(2); // one per active manager
  });

  it('keeps the NEW-property submission wording untouched', async () => {
    const created = await createProperty();

    const alerts = (await inbox(managerToken)).filter(
      (item) => item.type === 'PROPERTY_SUBMITTED',
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.title).toBe('عقار جديد بانتظار المراجعة');
    expect(alerts[0]?.message).toMatch(/^رقم العقار: A-/);
    expect(alerts[0]?.message).not.toContain('التعديلات:');
    expect(created.id).toEqual(expect.any(String));
  });
});
