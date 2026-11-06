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
 * The stored image of a property must survive every edit and resubmission.
 *
 * The wizard shows the image that is already stored and never sends an image
 * in the update payload (`PATCH /properties/:id` has no image field), so the
 * backend must keep the primary image reference and its file row untouched.
 */
describeWithDatabase('Property image retention', () => {
  let ctx: TestContext;
  let managerToken: string;
  let employeeToken: string;

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
    floors: [{ type: 'GROUND', details: 'صالة' }],
    newContact: { type: 'BROKER', name: 'وسيط', phone: '66661111' },
  });

  const createProperty = async () => {
    const response = await postProperty(
      ctx.app,
      employeeToken,
      payload(),
      image,
    );
    expect(response.status).toBe(201);
    return response.body.data as { id: string; version: number };
  };

  /** The stored image reference and the number of stored files. */
  const imageState = async (id: string) => {
    const property = await ctx.prisma.property.findUnique({
      where: { id },
      select: { primaryImageId: true },
    });
    const files = await ctx.prisma.fileAsset.count({ where: { propertyId: id } });
    return { primaryImageId: property?.primaryImageId ?? null, files };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'manager@images.local',
      name: 'Manager Images',
      role: Role.MANAGER,
    });
    const employee = await createUser(ctx.prisma, {
      email: 'employee@images.local',
      name: 'Employee Images',
      role: Role.EMPLOYEE,
    });
    managerToken = await login(ctx.app, manager.email);
    employeeToken = await login(ctx.app, employee.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('keeps the stored image through a price-only edit', async () => {
    const created = await createProperty();
    const before = await imageState(created.id);
    expect(before.primaryImageId).not.toBeNull();
    expect(before.files).toBe(1);

    const patched = await api()
      .patch(`/properties/${created.id}`)
      .set(auth(employeeToken))
      .send({ version: created.version, askingPrice: '300000.00' });
    expect(patched.status).toBe(200);

    // The image reference and its file row are untouched by the edit.
    expect(await imageState(created.id)).toEqual(before);
    // And the authorized image endpoint still serves it.
    const served = await api()
      .get(`/properties/${created.id}/image`)
      .set(auth(employeeToken));
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toContain('image/');
  });

  it('keeps the stored image through a resubmission after changes were requested', async () => {
    const created = await createProperty();
    const before = await imageState(created.id);

    // The manager asks for changes, the creator corrects the row and resubmits.
    const changes = await api()
      .post(`/properties/${created.id}/request-changes`)
      .set(auth(managerToken))
      .send({ reason: 'يرجى تعديل السعر' });
    expect(changes.status).toBe(200);

    // The review request moved the row on: the correction uses its CURRENT
    // version (a stale one is refused, exactly as before).
    const current = await ctx.prisma.property.findUnique({
      where: { id: created.id },
      select: { version: true },
    });
    const patched = await api()
      .patch(`/properties/${created.id}`)
      .set(auth(employeeToken))
      .send({ version: current?.version, askingPrice: '275000.00' });
    expect(patched.status).toBe(200);
    expect(await imageState(created.id)).toEqual(before);

    const resubmitted = await api()
      .post(`/properties/${created.id}/resubmit`)
      .set(auth(employeeToken));
    expect(resubmitted.status).toBe(200);
    expect(await imageState(created.id)).toEqual(before);
  });

  it('keeps the stored image through the approval of the corrected row', async () => {
    const created = await createProperty();
    const before = await imageState(created.id);

    const approved = await api()
      .post(`/properties/${created.id}/approve`)
      .set(auth(managerToken))
      .send({});
    expect(approved.status).toBe(200);
    expect(await imageState(created.id)).toEqual(before);
  });
});
