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
 * Replacing the primary image of an existing property.
 *
 * The replacement follows the SAME workflow as any other edit: the employee
 * sends the property back to review, the approved (public) image only changes
 * when the manager approves, a failed upload leaves the approved image
 * untouched, and another employee can never touch it.
 */
describeWithDatabase('Property image replacement', () => {
  let ctx: TestContext;
  let managerToken: string;
  let creatorToken: string;
  let otherToken: string;

  const api = () => request(ctx.app.getHttpServer());

  let seq = 0;
  const createProperty = async (token = creatorToken) => {
    const response = await postProperty(
      ctx.app,
      token,
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

  const primaryImage = async (id: string) => {
    const row = await ctx.prisma.property.findUnique({
      where: { id },
      select: { primaryImageId: true },
    });
    return row?.primaryImageId ?? null;
  };

  const assets = async (id: string) =>
    ctx.prisma.fileAsset.count({ where: { propertyId: id } });

  /** A multipart edit that carries a replacement image. */
  const replaceImage = async (
    id: string,
    version: number,
    changes: Record<string, unknown> = {},
  ) =>
    api()
      .patch(`/properties/${id}`)
      .set(auth(creatorToken))
      .field('version', String(version))
      .field(
        'payload',
        JSON.stringify({ version, ...changes }),
      )
      .attach('image', pngBytes(), 'replacement.png');

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'manager@images.local',
      name: 'Manager Images',
      role: Role.MANAGER,
    });
    const creator = await createUser(ctx.prisma, {
      email: 'creator@images.local',
      name: 'Creator Images',
      role: Role.EMPLOYEE,
    });
    const other = await createUser(ctx.prisma, {
      email: 'other@images.local',
      name: 'Other Images',
      role: Role.EMPLOYEE,
    });
    managerToken = await login(ctx.app, manager.email);
    creatorToken = await login(ctx.app, creator.email);
    otherToken = await login(ctx.app, other.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('saves a price-only edit without any image upload and keeps the image', async () => {
    const created = await createProperty();
    const before = await primaryImage(created.id);
    expect(before).not.toBeNull();
    const assetsBefore = await assets(created.id);

    const patched = await api()
      .patch(`/properties/${created.id}`)
      .set(auth(creatorToken))
      .send({ version: created.version, askingPrice: '300000.00' });
    expect(patched.status).toBe(200);

    // The image is untouched and no new file was stored.
    expect(await primaryImage(created.id)).toBe(before);
    expect(await assets(created.id)).toBe(assetsBefore);
  });

  it('stages a replacement for review and applies it only after the approval', async () => {
    const created = await createProperty();
    // The property is approved first, so the edit opens a REAL review round
    // (the manager is notified about the replacement before deciding).
    expect((await approve(created.id)).status).toBe(200);
    const before = await primaryImage(created.id);
    const assetsBefore = await assets(created.id);
    const approved = await ctx.prisma.property.findUnique({
      where: { id: created.id },
      select: { version: true },
    });

    const edited = await replaceImage(created.id, approved?.version as number, {
      askingPrice: '310000.00',
    });
    expect(edited.status).toBe(200);

    // The PUBLIC image is still the approved one, and the property waits for
    // the manager's decision.
    expect(await primaryImage(created.id)).toBe(before);
    const property = await ctx.prisma.property.findUnique({
      where: { id: created.id },
      select: { status: true },
    });
    expect(property?.status).toBe('PENDING');
    // The replacement is stored, but not as the public image yet.
    expect(await assets(created.id)).toBe(assetsBefore + 1);

    // The manager is told about the replacement.
    const inbox = await api()
      .get('/notifications?limit=50')
      .set(auth(managerToken));
    const review = (
      inbox.body.data as { items: { type: string; message: string }[] }
    ).items.find((item) => item.type === 'PROPERTY_RESUBMITTED');
    expect(review?.message).toContain('الصورة الرئيسية');

    // The approval switches the public image.
    expect((await approve(created.id)).status).toBe(200);
    const after = await primaryImage(created.id);
    expect(after).not.toBe(before);
    expect(after).not.toBeNull();
    // The previous image is kept (never physically deleted).
    expect(await assets(created.id)).toBe(assetsBefore + 1);
    const old = await ctx.prisma.fileAsset.findUnique({
      where: { id: before as string },
      select: { id: true },
    });
    expect(old?.id).toBe(before);
  });

  it('reports the image change to the creator and the other employees after the approval', async () => {
    const created = await createProperty();
    expect((await approve(created.id)).status).toBe(200);
    const approved = await ctx.prisma.property.findUnique({
      where: { id: created.id },
      select: { version: true },
    });
    expect(
      (await replaceImage(created.id, approved?.version as number)).status,
    ).toBe(200);
    expect((await approve(created.id)).status).toBe(200);

    const creatorInbox = await api()
      .get('/notifications?limit=50')
      .set(auth(creatorToken));
    const creatorRow = (
      creatorInbox.body.data as { items: { type: string; message: string }[] }
    ).items.find((item) => item.type === 'PROPERTY_APPROVED');
    expect(creatorRow?.message).toContain('الصورة الرئيسية');

    const otherInbox = await api()
      .get('/notifications?limit=50')
      .set(auth(otherToken));
    const otherRow = (
      otherInbox.body.data as { items: { type: string; message: string }[] }
    ).items.find((item) => item.type === 'PROPERTY_AVAILABLE');
    expect(otherRow?.message).toContain('الصورة الرئيسية');
    // No storage path or asset id leaks into the notification.
    expect(otherRow?.message).not.toContain('/properties/');
    expect(otherRow?.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it('keeps the original image when the upload is refused', async () => {
    const created = await createProperty();
    const before = await primaryImage(created.id);
    const assetsBefore = await assets(created.id);

    // A file that is not an image is refused by the same sanitizer.
    const refused = await api()
      .patch(`/properties/${created.id}`)
      .set(auth(creatorToken))
      .field('version', String(created.version))
      .field('payload', JSON.stringify({ version: created.version }))
      .attach('image', Buffer.from('not an image'), 'broken.png');
    expect(refused.status).toBeGreaterThanOrEqual(400);

    // The approved image and the stored files are exactly as they were.
    expect(await primaryImage(created.id)).toBe(before);
    expect(await assets(created.id)).toBe(assetsBefore);
  });

  it('never lets another employee replace the image', async () => {
    const created = await createProperty();
    const before = await primaryImage(created.id);
    const assetsBefore = await assets(created.id);

    const refused = await api()
      .patch(`/properties/${created.id}`)
      .set(auth(otherToken))
      .field('version', String(created.version))
      .field('payload', JSON.stringify({ version: created.version }))
      .attach('image', pngBytes(), 'stolen.png');
    expect(refused.status).toBe(403);

    expect(await primaryImage(created.id)).toBe(before);
    // The refused upload left no file behind.
    expect(await assets(created.id)).toBe(assetsBefore);
  });

  it('does not touch the image on an unrelated edit', async () => {
    const created = await createProperty();
    const before = await primaryImage(created.id);
    const assetsBefore = await assets(created.id);

    const edited = await replaceImage(created.id, created.version, {
      plotNumber: '45',
    });
    expect(edited.status).toBe(200);
    // The staged replacement is NOT the public image before the approval.
    expect(await primaryImage(created.id)).toBe(before);
    expect(await assets(created.id)).toBe(assetsBefore + 1);
  });
});
