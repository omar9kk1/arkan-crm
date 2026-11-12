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
import { notificationRoute } from '../../frontend/features/notifications/notification-target';
import { notificationAffectsPropertyLists } from '../../frontend/features/notifications/view';

jest.setTimeout(180000);

const image = [{ buffer: pngBytes(), filename: 'photo.png' }];

describeWithDatabase('Employee property restoration notification', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let managerToken: string;
  let employeeAToken: string;
  let employeeBToken: string;
  let seq = 0;
  const api = () => request(ctx.app.getHttpServer());

  const payload = (overrides: Record<string, unknown> = {}) => {
    seq += 1;
    return {
      listingType: 'SALE',
      governorate: 'الجهراء',
      district: 'مدينة المطلاع',
      block: '8',
      plotNumber: String(960000 + seq),
      sizeSqm: '300.00',
      askingPrice: '350000.00',
      negotiable: true,
      description: 'منزل كامل',
      floors: [{ type: 'GROUND', details: 'مجلس + ديوانية' }],
      newContact: { type: 'OWNER', name: 'Restore Owner', phone: '61110000' },
      ...overrides,
    };
  };

  const createProperty = async (
    token = employeeAToken,
    overrides: Record<string, unknown> = {},
  ) => {
    const created = await postProperty(
      ctx.app,
      token,
      payload(overrides),
      image,
    );
    expect(created.status).toBe(201);
    return created.body.data as {
      id: string;
      reference: string;
      submissionReference: string;
      approvedReference: string | null;
      version: number;
    };
  };

  const notifications = async (token: string) => {
    const response = await api()
      .get('/notifications?limit=100')
      .set(auth(token));
    expect(response.status).toBe(200);
    return response.body.data.items as Array<{
      id: string;
      type: string;
      title: string;
      message: string;
      propertyId: string | null;
      eventKey: string | null;
    }>;
  };

  const restoreNotifications = async (token: string, propertyId: string) =>
    (await notifications(token)).filter(
      (item) =>
        item.propertyId === propertyId &&
        item.title === 'تم استعادة العقار',
    );

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const owner = await createUser(ctx.prisma, {
      email: 'restore-owner@test.local',
      name: 'Restore Owner',
      role: Role.OWNER,
    });
    const manager = await createUser(ctx.prisma, {
      email: 'restore-manager@test.local',
      name: 'Restore Manager',
      role: Role.MANAGER,
    });
    const a = await createUser(ctx.prisma, {
      email: 'restore-a@test.local',
      name: 'Restore A',
      role: Role.EMPLOYEE,
    });
    const b = await createUser(ctx.prisma, {
      email: 'restore-b@test.local',
      name: 'Restore B',
      role: Role.EMPLOYEE,
    });
    ownerToken = await login(ctx.app, owner.email);
    managerToken = await login(ctx.app, manager.email);
    employeeAToken = await login(ctx.app, a.email);
    employeeBToken = await login(ctx.app, b.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('notifies the original employee after a successful restore (PENDING stays PENDING)', async () => {
    const created = await createProperty(employeeAToken, {
      plotNumber: '960101',
    });
    await api()
      .post(`/properties/${created.id}/trash`)
      .set(auth(ownerToken))
      .send({ reason: 'اختبار' });

    const restored = await api()
      .post(`/properties/${created.id}/restore`)
      .set(auth(ownerToken))
      .send({});
    expect(restored.status).toBe(200);
    expect(restored.body.data.status).toBe('PENDING');
    expect(restored.body.data.reference).toBe(created.reference);
    expect(restored.body.data.approvedReference).toBeNull();

    const items = await notifications(employeeAToken);
    const decision = items.find(
      (item) =>
        item.propertyId === created.id &&
        item.title === 'تم استعادة العقار',
    );
    expect(decision).toBeTruthy();
    expect(decision!.message).toContain(
      'قام مالك النظام باستعادة عقارك من المحذوفات، وأصبح متاحًا مرة أخرى في قائمة عقاراتك.',
    );
    expect(decision!.message).toContain(created.reference);
    expect(decision!.message).toContain('التاريخ:');
    expect(decision!.propertyId).toBe(created.id);

    // Only the creator receives it.
    expect(
      (await notifications(employeeBToken)).some(
        (item) => item.propertyId === created.id,
      ),
    ).toBe(false);

    // The restored row is visible to the creator again.
    const list = await api()
      .get('/properties?limit=100')
      .set(auth(employeeAToken));
    expect(
      list.body.data.items.some(
        (item: { id: string }) => item.id === created.id,
      ),
    ).toBe(true);
  });

  it('keeps the official A code and AVAILABLE status for an approved property', async () => {
    const created = await createProperty(employeeAToken, {
      plotNumber: '960102',
    });
    const approved = await api()
      .post(`/properties/${created.id}/approve`)
      .set(auth(managerToken))
      .send({ version: created.version });
    expect(approved.status).toBe(200);
    const aCode = approved.body.data.reference as string;
    expect(aCode).toMatch(/^A-\d{6}$/);

    await api()
      .post(`/properties/${created.id}/trash`)
      .set(auth(ownerToken))
      .send({ reason: 'اختبار' });
    const restored = await api()
      .post(`/properties/${created.id}/restore`)
      .set(auth(ownerToken))
      .send({});
    expect(restored.status).toBe(200);
    expect(restored.body.data.status).toBe('AVAILABLE');
    expect(restored.body.data.reference).toBe(aCode);
    expect(restored.body.data.submissionReference).toBe(created.reference);
    expect(restored.body.data.approvedReference).toBe(aCode);

    const [decision] = await restoreNotifications(
      employeeAToken,
      created.id,
    );
    expect(decision).toBeTruthy();
    expect(decision!.message).toContain(aCode);
  });

  it('does not duplicate the notification on a repeated restore request', async () => {
    const created = await createProperty(employeeAToken, {
      plotNumber: '960103',
    });
    await api()
      .post(`/properties/${created.id}/trash`)
      .set(auth(ownerToken))
      .send({});
    const first = await api()
      .post(`/properties/${created.id}/restore`)
      .set(auth(ownerToken))
      .send({});
    expect(first.status).toBe(200);
    const second = await api()
      .post(`/properties/${created.id}/restore`)
      .set(auth(ownerToken))
      .send({});
    expect(second.status).toBe(400);
    expect(await restoreNotifications(employeeAToken, created.id)).toHaveLength(
      1,
    );
  });

  it('sends nothing when restore fails (not trashed or identity conflict)', async () => {
    // Not trashed.
    const active = await createProperty(employeeAToken, {
      plotNumber: '960104',
    });
    const failed = await api()
      .post(`/properties/${active.id}/restore`)
      .set(auth(ownerToken))
      .send({});
    expect(failed.status).toBe(400);
    expect(await restoreNotifications(employeeAToken, active.id)).toHaveLength(
      0,
    );

    // Identity conflict: another active property with the same block/plot.
    const first = await createProperty(employeeAToken, {
      plotNumber: '960105',
    });
    await api()
      .post(`/properties/${first.id}/trash`)
      .set(auth(ownerToken))
      .send({});
    await createProperty(employeeBToken, { plotNumber: '960105' });
    const conflict = await api()
      .post(`/properties/${first.id}/restore`)
      .set(auth(ownerToken))
      .send({});
    expect(conflict.status).toBe(409);
    expect(await restoreNotifications(employeeAToken, first.id)).toHaveLength(
      0,
    );
  });

  it('routes the notification to the employee property drawer and refreshes lists', () => {
    const propertyId = '11111111-1111-4111-8111-111111111111';
    const route = notificationRoute(
      {
        propertyId,
        eventKey: 'PROPERTY_RESTORED:property:123',
        clientId: null,
        contactId: null,
        contactType: null,
        clientReviewId: null,
        followUpSubjectId: null,
      },
      'EMPLOYEE',
    );
    expect(route?.path).toContain(`/employee/properties?property=${propertyId}`);
    expect(route?.path).not.toContain('decision=1');

    expect(
      notificationAffectsPropertyLists({
        propertyId,
        type: 'SYSTEM',
      }),
    ).toBe(true);
  });
});
