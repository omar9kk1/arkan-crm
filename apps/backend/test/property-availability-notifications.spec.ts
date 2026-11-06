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
  read: boolean;
  createdAt: string;
}

/**
 * The "property became AVAILABLE" alert, across approval cycles.
 *
 * The alert belongs to ONE approval round, not to the property: a property
 * that is approved again after an edit → review cycle is a genuinely new
 * transition and must reach the employees again — while a retried approval of
 * the SAME round must never duplicate.
 */
describeWithDatabase('Property availability notifications', () => {
  let ctx: TestContext;
  let managerToken: string;
  let creatorToken: string;
  let otherToken: string;
  let secondOtherToken: string;

  const api = () => request(ctx.app.getHttpServer());

  let seq = 0;
  const payload = () => ({
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
    // A private contact that must NEVER appear in an availability alert.
    newContact: { type: 'BROKER', name: 'وسيط خاص', phone: '66661111' },
  });

  const createProperty = async (token: string) => {
    const response = await postProperty(ctx.app, token, payload(), image);
    expect(response.status).toBe(201);
    return response.body.data as { id: string; version: number };
  };

  const approve = (token: string, id: string) =>
    api().post(`/properties/${id}/approve`).set(auth(token)).send({});

  const edit = (token: string, id: string, version: number) =>
    api()
      .patch(`/properties/${id}`)
      .set(auth(token))
      .send({ version, sizeSqm: '450.00' });

  const inbox = async (token: string): Promise<NotificationItem[]> => {
    const response = await api()
      .get('/notifications?limit=100')
      .set(auth(token));
    expect(response.status).toBe(200);
    return response.body.data.items as NotificationItem[];
  };

  /** The availability alerts of one recipient for one property. */
  const availabilityFor = async (
    token: string,
    propertyId: string,
  ): Promise<NotificationItem[]> =>
    (await inbox(token)).filter(
      (item) => item.type === 'PROPERTY_AVAILABLE' && item.propertyId === propertyId,
    );

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'manager@availability.local',
      name: 'Manager Availability',
      role: Role.MANAGER,
    });
    const creator = await createUser(ctx.prisma, {
      email: 'creator@availability.local',
      name: 'Creator Employee',
      role: Role.EMPLOYEE,
    });
    const other = await createUser(ctx.prisma, {
      email: 'other@availability.local',
      name: 'Other Employee',
      role: Role.EMPLOYEE,
    });
    const secondOther = await createUser(ctx.prisma, {
      email: 'other.two@availability.local',
      name: 'Other Employee Two',
      role: Role.EMPLOYEE,
    });
    managerToken = await login(ctx.app, manager.email);
    creatorToken = await login(ctx.app, creator.email);
    otherToken = await login(ctx.app, other.email);
    secondOtherToken = await login(ctx.app, secondOther.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.prisma.notification.deleteMany({});
  });

  it('alerts every other employee on the first approval, and only the creator gets the decision', async () => {
    const created = await createProperty(creatorToken);
    expect((await approve(managerToken, created.id)).status).toBe(200);

    for (const token of [otherToken, secondOtherToken]) {
      const alerts = await availabilityFor(token, created.id);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        title: 'عقار جديد متاح في البرنامج',
        propertyId: created.id,
        read: false,
      });
      // The alert carries only the public reference — never the private
      // owner/broker contact of the property.
      expect(alerts[0]?.message).toMatch(/^رقم العقار: A-/);
      expect(JSON.stringify(alerts[0])).not.toContain('66661111');
      expect(JSON.stringify(alerts[0])).not.toContain('وسيط خاص');
    }

    // The creator is not told about the availability of their own property.
    expect(await availabilityFor(creatorToken, created.id)).toHaveLength(0);
    const creatorRows = await inbox(creatorToken);
    expect(
      creatorRows.filter((item) => item.type === 'PROPERTY_APPROVED'),
    ).toHaveLength(1);
  });

  it('alerts the employees AGAIN when the same property is approved in a new cycle', async () => {
    const created = await createProperty(creatorToken);

    // Cycle 1: the property enters the program.
    const firstApproval = await approve(managerToken, created.id);
    expect(firstApproval.status).toBe(200);
    expect(await availabilityFor(otherToken, created.id)).toHaveLength(1);

    // The creator edits the approved property: it goes back to review in a NEW
    // review round (a new approval-request row).
    const approvedVersion = (firstApproval.body.data as { version: number })
      .version;
    const edited = await edit(creatorToken, created.id, approvedVersion);
    expect(edited.status).toBe(200);

    // Cycle 2: the manager approves again — the employees must hear about it
    // again (this is the regression: the old key was the property id, so the
    // second alert was silently deduplicated).
    expect((await approve(managerToken, created.id)).status).toBe(200);

    for (const token of [otherToken, secondOtherToken]) {
      const alerts = await availabilityFor(token, created.id);
      expect(alerts).toHaveLength(2);
      // Two DIFFERENT events: two distinct notification rows with two
      // distinct event keys.
      expect(alerts[0]?.id).not.toBe(alerts[1]?.id);
      const keys = await ctx.prisma.notification.findMany({
        where: {
          userId: (
            await ctx.prisma.user.findUnique({
              where: { email: 'other@availability.local' },
            })
          )?.id,
          type: 'PROPERTY_AVAILABLE',
          propertyId: created.id,
        },
        select: { eventKey: true },
      });
      expect(new Set(keys.map((row) => row.eventKey)).size).toBe(2);
    }

    // The creator still gets exactly one approval decision per round.
    const creatorRows = await inbox(creatorToken);
    expect(
      creatorRows.filter((item) => item.type === 'PROPERTY_APPROVED'),
    ).toHaveLength(2);
    expect(await availabilityFor(creatorToken, created.id)).toHaveLength(0);
  });

  it('never duplicates an alert when the SAME approval transition is retried', async () => {
    const created = await createProperty(creatorToken);
    expect((await approve(managerToken, created.id)).status).toBe(200);
    expect(await availabilityFor(otherToken, created.id)).toHaveLength(1);

    // A repeated approval of the same round is a conflict, not a new event.
    expect((await approve(managerToken, created.id)).status).toBe(409);
    expect(await availabilityFor(otherToken, created.id)).toHaveLength(1);
    expect(
      await ctx.prisma.notification.count({
        where: { type: 'PROPERTY_AVAILABLE', propertyId: created.id },
      }),
    ).toBe(2); // one per other employee, never more
  });

  it('keeps one alert per employee when several employees are subscribed', async () => {
    const created = await createProperty(creatorToken);
    expect((await approve(managerToken, created.id)).status).toBe(200);

    const rows = await ctx.prisma.notification.findMany({
      where: { type: 'PROPERTY_AVAILABLE', propertyId: created.id },
    });
    // Exactly one row per eligible employee, with one key per recipient.
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.userId)).size).toBe(2);
    expect(new Set(rows.map((row) => row.eventKey)).size).toBe(1);
  });

  it('describes a PRICE-ONLY change and lists nothing else', async () => {
    const created = await createProperty(creatorToken);
    const firstApproval = await approve(managerToken, created.id);
    expect(firstApproval.status).toBe(200);
    const version = (firstApproval.body.data as { version: number }).version;

    // Only the price moves.
    const edited = await api()
      .patch(`/properties/${created.id}`)
      .set(auth(creatorToken))
      .send({ version, askingPrice: '300000.00' });
    expect(edited.status).toBe(200);
    expect((await approve(managerToken, created.id)).status).toBe(200);

    const alerts = await availabilityFor(otherToken, created.id);
    expect(alerts).toHaveLength(2);
    const latest = alerts[0] as NotificationItem;
    expect(latest.title).toBe('تم تعديل عقار وأصبح متاحًا');
    expect(latest.message).toContain('التعديلات:');
    expect(latest.message).toContain('السعر');
    expect(latest.message).toContain('300,000');
    // Fields that did NOT change are never claimed.
    expect(latest.message).not.toContain('المساحة');
    expect(latest.message).not.toContain('الموقع');
    expect(latest.message).not.toContain('الوصف');
    expect(latest.message).not.toContain('عدد الغرف');
  });

  it('lists every field that really changed, and only those', async () => {
    const created = await createProperty(creatorToken);
    const firstApproval = await approve(managerToken, created.id);
    const version = (firstApproval.body.data as { version: number }).version;

    const edited = await api()
      .patch(`/properties/${created.id}`)
      .set(auth(creatorToken))
      .send({
        version,
        askingPrice: '275000.00',
        sizeSqm: '450.00',
        description: 'وصف جديد completely different',
        district: 'الفروانية',
      });
    expect(edited.status).toBe(200);
    expect((await approve(managerToken, created.id)).status).toBe(200);

    const latest = (await availabilityFor(otherToken, created.id))[
      0
    ] as NotificationItem;
    expect(latest.title).toBe('تم تعديل عقار وأصبح متاحًا');
    expect(latest.message).toContain('السعر');
    expect(latest.message).toContain('275,000');
    expect(latest.message).toContain('المساحة');
    expect(latest.message).toContain('450');
    expect(latest.message).toContain('المنطقة');
    expect(latest.message).toContain('الوصف');
    // The description TEXT never reaches the notification preview.
    expect(latest.message).not.toContain('completely different');
    // The private contact of the property never appears either.
    expect(latest.message).not.toContain('66661111');
    expect(latest.message).not.toContain('وسيط خاص');
  });

  it('does not claim a change when the resubmitted version is identical', async () => {
    const created = await createProperty(creatorToken);
    const firstApproval = await approve(managerToken, created.id);
    const version = (firstApproval.body.data as { version: number }).version;

    // The creator saves the SAME values: the property goes back to review, but
    // nothing actually changed.
    const edited = await api()
      .patch(`/properties/${created.id}`)
      .set(auth(creatorToken))
      .send({ version, sizeSqm: '400.00' });
    expect(edited.status).toBe(200);
    expect((await approve(managerToken, created.id)).status).toBe(200);

    const alerts = await availabilityFor(otherToken, created.id);
    expect(alerts).toHaveLength(2);
    const latest = alerts[0] as NotificationItem;
    // It is still an update of a known property, but with no invented changes.
    expect(latest.title).toBe('تم تعديل عقار وأصبح متاحًا');
    expect(latest.message).not.toContain('التعديلات:');
    expect(latest.message).toMatch(/^رقم العقار: A-/);
  });

  it('keeps the first approval wording for a genuinely new property', async () => {
    const created = await createProperty(creatorToken);
    expect((await approve(managerToken, created.id)).status).toBe(200);

    const alerts = await availabilityFor(otherToken, created.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.title).toBe('عقار جديد متاح في البرنامج');
    expect(alerts[0]?.message).toMatch(/^رقم العقار: A-/);
    expect(alerts[0]?.message).not.toContain('التعديلات:');
  });
});
