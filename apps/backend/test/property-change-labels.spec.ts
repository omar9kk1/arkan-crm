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

/**
 * Field-by-field change labels.
 *
 * Every changed field gets ITS OWN accurate Arabic label — a changed plot
 * number is "رقم القسيمة", never the vague "الموقع" — and the floors are
 * compared one by one, so a change inside one floor is reported with that
 * floor's name.
 */
describeWithDatabase('Precise property change labels', () => {
  let ctx: TestContext;
  let managerToken: string;
  let creatorToken: string;

  const api = () => request(ctx.app.getHttpServer());

  const createProperty = async (withBasement = false) => {
    const response = await postProperty(
      ctx.app,
      creatorToken,
      {
        listingType: 'SALE',
        governorate: 'الفروانية',
        district: 'غرناطة',
        block: '3',
        plotNumber: '12',
        address: 'قطعة 3 قسيمة 12',
        sizeSqm: '400.00',
        askingPrice: '250000.00',
        negotiable: true,
        description: 'بيت مستقل للبيع',
        floors: [
          { type: 'GROUND', details: 'صالة ومطبخ' },
          { type: 'FIRST', details: '3 غرف، 2 حمامات' },
          ...(withBasement
            ? [{ type: 'BASEMENT', details: 'سرداب ضيق' }]
            : []),
        ],
        newContact: { type: 'BROKER', name: 'وسيط', phone: '66661111' },
      },
      image,
    );
    expect(response.status).toBe(201);
    return response.body.data as { id: string; version: number };
  };

  const approve = (id: string) =>
    api().post(`/properties/${id}/approve`).set(auth(managerToken)).send({});

  /** The review summary the manager receives for one edit. */
  const reviewSummary = async (
    id: string,
    version: number,
    changes: Record<string, unknown>,
  ): Promise<string> => {
    await ctx.prisma.notification.deleteMany({});
    const edited = await api()
      .patch(`/properties/${id}`)
      .set(auth(creatorToken))
      .send({ version, ...changes });
    expect(edited.status).toBe(200);
    const inbox = await api()
      .get('/notifications?limit=50')
      .set(auth(managerToken));
    const row = (
      inbox.body.data as { items: { type: string; message: string }[] }
    ).items.find((item) => item.type === 'PROPERTY_RESUBMITTED');
    return row?.message ?? '';
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'manager@labels.local',
      name: 'Manager Labels',
      role: Role.MANAGER,
    });
    const creator = await createUser(ctx.prisma, {
      email: 'creator@labels.local',
      name: 'Creator Labels',
      role: Role.EMPLOYEE,
    });
    managerToken = await login(ctx.app, manager.email);
    creatorToken = await login(ctx.app, creator.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('reports a changed plot number as "رقم القسيمة", never as "الموقع"', async () => {
    const created = await createProperty();
    expect((await approve(created.id)).status).toBe(200);
    const version = (
      await ctx.prisma.property.findUnique({
        where: { id: created.id },
        select: { version: true },
      })
    )?.version as number;

    const message = await reviewSummary(created.id, version, {
      plotNumber: '45',
    });
    expect(message).toContain('رقم القسيمة');
    expect(message).toContain('45');
    expect(message).not.toContain('الموقع');
  });

  it('reports a changed block as "القطعة"', async () => {
    const created = await createProperty();
    expect((await approve(created.id)).status).toBe(200);
    const version = (
      await ctx.prisma.property.findUnique({
        where: { id: created.id },
        select: { version: true },
      })
    )?.version as number;

    const message = await reviewSummary(created.id, version, { block: '9' });
    expect(message).toContain('القطعة');
    expect(message).toContain('9');
    expect(message).not.toContain('الموقع');
  });

  it('reports a changed district and area with their own labels', async () => {
    const created = await createProperty();
    expect((await approve(created.id)).status).toBe(200);
    const version = (
      await ctx.prisma.property.findUnique({
        where: { id: created.id },
        select: { version: true },
      })
    )?.version as number;

    const message = await reviewSummary(created.id, version, {
      district: 'الجهراء',
      governorate: 'الجهراء',
      sizeSqm: '450.00',
    });
    expect(message).toContain('المنطقة');
    expect(message).toContain('الجهراء');
    expect(message).toContain('المساحة');
    expect(message).toContain('450');
    expect(message).not.toContain('الموقع');
  });

  it('reports a changed price with its old → new value', async () => {
    const created = await createProperty();
    expect((await approve(created.id)).status).toBe(200);
    const version = (
      await ctx.prisma.property.findUnique({
        where: { id: created.id },
        select: { version: true },
      })
    )?.version as number;

    const message = await reviewSummary(created.id, version, {
      askingPrice: '300000.00',
    });
    expect(message).toContain('السعر');
    expect(message).toContain('250,000');
    expect(message).toContain('300,000');
  });

  it('reports a changed floor detail with THAT floor name', async () => {
    const created = await createProperty();
    expect((await approve(created.id)).status).toBe(200);
    const version = (
      await ctx.prisma.property.findUnique({
        where: { id: created.id },
        select: { version: true },
      })
    )?.version as number;

    const message = await reviewSummary(created.id, version, {
      floors: [
        { type: 'GROUND', details: 'صالة ومطبخ' },
        { type: 'FIRST', details: '4 غرف، 3 حمامات' },
      ],
    });
    // The FIRST floor changed — and only it is named.
    expect(message).toContain('الدور الأول');
    expect(message).toContain('التفاصيل');
    expect(message).toContain('4 غرف');
    expect(message).not.toContain('الدور الأرضي');
    // A generic "the floors changed" is not enough.
    expect(message).not.toContain('تم تغيير الأدوار');
  });

  it('reports a changed basement with the basement name', async () => {
    const created = await createProperty(true);
    expect((await approve(created.id)).status).toBe(200);
    const version = (
      await ctx.prisma.property.findUnique({
        where: { id: created.id },
        select: { version: true },
      })
    )?.version as number;

    const message = await reviewSummary(created.id, version, {
      floors: [
        { type: 'GROUND', details: 'صالة ومطبخ' },
        { type: 'FIRST', details: '3 غرف، 2 حمامات' },
        { type: 'BASEMENT', details: 'سرداب واسع' },
      ],
    });
    // The basement is named, and only ITS detail is reported.
    expect(message).toContain('السرداب');
    expect(message).toContain('التفاصيل');
    expect(message).toContain('سرداب واسع');
    expect(message).not.toContain('الدور الأرضي');
  });

  it('reports an added and a removed floor', async () => {
    const created = await createProperty();
    expect((await approve(created.id)).status).toBe(200);
    const version = (
      await ctx.prisma.property.findUnique({
        where: { id: created.id },
        select: { version: true },
      })
    )?.version as number;

    const message = await reviewSummary(created.id, version, {
      floors: [
        { type: 'GROUND', details: 'صالة ومطبخ' },
        { type: 'ROOF', details: 'سطح مستغل' },
      ],
    });
    expect(message).toContain('تمت إضافة السطح');
    expect(message).toContain('تم حذف الدور الأول');
  });

  it('lists several changed fields across several floors at once', async () => {
    const created = await createProperty();
    expect((await approve(created.id)).status).toBe(200);
    const version = (
      await ctx.prisma.property.findUnique({
        where: { id: created.id },
        select: { version: true },
      })
    )?.version as number;

    const message = await reviewSummary(created.id, version, {
      askingPrice: '310000.00',
      plotNumber: '77',
      floors: [
        { type: 'GROUND', details: 'صالة ومطبخ' },
        { type: 'FIRST', details: '5 غرف' },
      ],
    });
    expect(message).toContain('السعر');
    expect(message).toContain('رقم القسيمة');
    expect(message).toContain('الدور الأول');
    expect(message).toContain('5 غرف');
  });
});
