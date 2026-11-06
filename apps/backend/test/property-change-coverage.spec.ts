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
  userId: string;
  propertyId: string | null;
}

/**
 * Every genuinely changed field must reach EVERY recipient.
 *
 * The manager was shown the changes when the property went back for review;
 * the creator (approval) and the other employees (availability) must receive
 * the SAME verified summary — the review round stores its baseline so the
 * approval can reproduce exactly that comparison.
 */
describeWithDatabase('Property change coverage', () => {
  let ctx: TestContext;
  let managerId: string;
  let creatorId: string;
  let otherId: string;
  let managerToken: string;
  let creatorToken: string;
  let otherToken: string;

  const api = () => request(ctx.app.getHttpServer());

  let seq = 0;
  const createProperty = async () => {
    const response = await postProperty(
      ctx.app,
      creatorToken,
      {
        listingType: 'SALE',
        governorate: 'الفروانية',
        district: 'غرناطة',
        block: '3',
        plotNumber: String(900000 + ++seq),
        sizeSqm: '400.00',
        askingPrice: '250000.00',
        negotiable: true,
        description: 'بيت مستقل للبيع',
        floors: [{ type: 'GROUND', details: 'صالة' }],
        newContact: { type: 'BROKER', name: 'وسيط', phone: '66661111' },
      },
      image,
    );
    expect(response.status).toBe(201);
    return response.body.data as { id: string; version: number };
  };

  const approve = (id: string) =>
    api().post(`/properties/${id}/approve`).set(auth(managerToken)).send({});

  const edit = (
    id: string,
    version: number,
    changes: Record<string, unknown>,
  ) =>
    api()
      .patch(`/properties/${id}`)
      .set(auth(creatorToken))
      .send({ version, ...changes });

  const inbox = async (token: string): Promise<NotificationItem[]> => {
    const response = await api()
      .get('/notifications?limit=100')
      .set(auth(token));
    expect(response.status).toBe(200);
    return response.body.data.items as NotificationItem[];
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'manager@coverage.local',
      name: 'Manager Coverage',
      role: Role.MANAGER,
    });
    const creator = await createUser(ctx.prisma, {
      email: 'creator@coverage.local',
      name: 'Creator Coverage',
      role: Role.EMPLOYEE,
    });
    const other = await createUser(ctx.prisma, {
      email: 'other@coverage.local',
      name: 'Other Coverage',
      role: Role.EMPLOYEE,
    });
    managerId = manager.id;
    creatorId = creator.id;
    otherId = other.id;
    managerToken = await login(ctx.app, manager.email);
    creatorToken = await login(ctx.app, creator.email);
    otherToken = await login(ctx.app, other.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.prisma.notification.deleteMany({});
  });

  it('carries the SAME verified summary to the manager, the creator and the other employees', async () => {
    const created = await createProperty();
    expect((await approve(created.id)).status).toBe(200);
    const approved = await ctx.prisma.property.findUnique({
      where: { id: created.id },
      select: { version: true },
    });

    // The employee edits the price and sends it back for review.
    await ctx.prisma.notification.deleteMany({});
    const edited = await edit(created.id, approved?.version as number, {
      askingPrice: '300000.00',
    });
    expect(edited.status).toBe(200);

    const managerReview = (await inbox(managerToken)).find(
      (item) => item.type === 'PROPERTY_RESUBMITTED',
    );
    expect(managerReview?.title).toBe('عقار مُعدّل بانتظار موافقتك');
    expect(managerReview?.message).toContain('السعر');
    expect(managerReview?.message).toContain('300,000');

    // The manager approves: the creator and the other employees must receive
    // the same verified changes.
    await ctx.prisma.notification.deleteMany({});
    const current = await ctx.prisma.property.findUnique({
      where: { id: created.id },
      select: { version: true },
    });
    expect((await approve(created.id)).status).toBe(200);

    const creatorRows = (await inbox(creatorToken)).filter(
      (item) => item.type === 'PROPERTY_APPROVED',
    );
    expect(creatorRows).toHaveLength(1);
    expect(creatorRows[0]?.message).toContain('السعر');
    expect(creatorRows[0]?.message).toContain('300,000');
    expect(creatorRows[0]?.message).toBe(managerReview?.message);

    const availability = (await inbox(otherToken)).filter(
      (item) => item.type === 'PROPERTY_AVAILABLE',
    );
    expect(availability).toHaveLength(1);
    expect(availability[0]?.message).toContain('السعر');
    expect(availability[0]?.message).toBe(managerReview?.message);
    // The creator is never a recipient of the availability alert.
    expect(
      (await inbox(creatorToken)).filter(
        (item) => item.type === 'PROPERTY_AVAILABLE',
      ),
    ).toHaveLength(0);
    void current;
  });

  it('lists EVERY changed field, and only the changed ones', async () => {
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
      district: 'الجهراء',
      governorate: 'الجهراء',
      block: '9',
      plotNumber: '30',
      listingType: 'RENT',
    });
    expect(edited.status).toBe(200);

    const message = (await inbox(managerToken)).find(
      (item) => item.type === 'PROPERTY_RESUBMITTED',
    )?.message as string;
    // The changed fields are listed…
    expect(message).toContain('السعر');
    expect(message).toContain('275,000');
    expect(message).toContain('المساحة');
    expect(message).toContain('450');
    expect(message).toContain('المنطقة');
    expect(message).toContain('المحافظة');
    expect(message).toContain('نوع الصفقة');
    // …and the untouched ones are not.
    expect(message).not.toContain('الوصف');
    expect(message).not.toContain('عدد الغرف');
    expect(message).not.toContain('عدد الصور');
  });

  it('reports nothing for an edit that changed no value', async () => {
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

    const message = (await inbox(managerToken)).find(
      (item) => item.type === 'PROPERTY_RESUBMITTED',
    )?.message as string;
    expect(message).not.toContain('التعديلات:');
    expect(message).toMatch(/^رقم العقار: /);
  });

  it('never invents changes when the review round has no trustworthy baseline', async () => {
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

    // Every stored baseline disappears (a legacy record that predates the
    // snapshots): the approval has nothing trustworthy to compare against.
    await ctx.prisma.propertyRevision.deleteMany({
      where: { propertyId: created.id },
    });
    await ctx.prisma.notification.deleteMany({});
    expect((await approve(created.id)).status).toBe(200);

    const creatorRow = (await inbox(creatorToken)).find(
      (item) => item.type === 'PROPERTY_APPROVED',
    );
    // Without a baseline nothing is claimed — the change is simply not listed.
    expect(creatorRow?.message).not.toContain('التعديلات:');
    expect(creatorRow?.message).toMatch(/^رقم العقار: /);
  });

  it('keeps a first approval on the plain new-property wording', async () => {
    const created = await createProperty();
    expect((await approve(created.id)).status).toBe(200);

    const managerRows = await inbox(managerToken);
    expect(
      managerRows.filter((item) => item.type === 'PROPERTY_SUBMITTED'),
    ).toHaveLength(1);
    const creatorRow = (await inbox(creatorToken)).find(
      (item) => item.type === 'PROPERTY_APPROVED',
    );
    expect(creatorRow?.message).toMatch(/^رقم العقار: /);
    expect(creatorRow?.message).not.toContain('التعديلات:');
  });

  it('never puts a private contact into any of the three notifications', async () => {
    const created = await createProperty();
    expect((await approve(created.id)).status).toBe(200);
    const approved = await ctx.prisma.property.findUnique({
      where: { id: created.id },
      select: { version: true },
    });
    await ctx.prisma.notification.deleteMany({});
    await edit(created.id, approved?.version as number, {
      askingPrice: '300000.00',
    });
    await ctx.prisma.notification.deleteMany({});
    await approve(created.id);

    const all = [
      ...(await inbox(managerToken)),
      ...(await inbox(creatorToken)),
      ...(await inbox(otherToken)),
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const row of all) {
      expect(row.message).not.toContain('66661111');
      expect(row.message).not.toContain('وسيط');
    }
    void managerId;
    void creatorId;
    void otherId;
  });
});
