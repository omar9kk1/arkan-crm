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
import { isDecisionNotification } from '../../frontend/features/notifications/view';

jest.setTimeout(180000);

const image = [{ buffer: pngBytes(), filename: 'photo.png' }];

describeWithDatabase('Employee property decision notifications', () => {
  let ctx: TestContext;
  let employeeAId: string;
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
      plotNumber: String(7100 + seq),
      sizeSqm: '300.00',
      askingPrice: '350000.00',
      negotiable: true,
      description: 'منزل كامل',
      floors: [{ type: 'GROUND', details: 'مجلس + ديوانية' }],
      newContact: {
        type: 'OWNER',
        name: 'Decision Owner',
        phone: '61110000',
      },
      ...overrides,
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

  const createProperty = async (overrides: Record<string, unknown> = {}) => {
    const created = await postProperty(
      ctx.app,
      employeeAToken,
      payload(overrides),
      image,
    );
    expect(created.status).toBe(201);
    return {
      id: created.body.data.id as string,
      code: created.body.data.reference as string,
    };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const owner = await createUser(ctx.prisma, {
      email: 'decision-owner@test.local',
      name: 'Decision Owner',
      role: Role.OWNER,
    });
    const manager = await createUser(ctx.prisma, {
      email: 'decision-manager@test.local',
      name: 'Decision Manager',
      role: Role.MANAGER,
    });
    const a = await createUser(ctx.prisma, {
      email: 'decision-a@test.local',
      name: 'Decision A',
      role: Role.EMPLOYEE,
    });
    const b = await createUser(ctx.prisma, {
      email: 'decision-b@test.local',
      name: 'Decision B',
      role: Role.EMPLOYEE,
    });
    employeeAId = a.id;
    ownerToken = await login(ctx.app, owner.email);
    managerToken = await login(ctx.app, manager.email);
    employeeAToken = await login(ctx.app, a.email);
    employeeBToken = await login(ctx.app, b.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('rejection notifies only the creator with code, reason and date (no false duplicate flag)', async () => {
    const { id, code } = await createProperty({ plotNumber: '7101' });
    const rejected = await api()
      .post(`/properties/${id}/reject`)
      .set(auth(managerToken))
      .send({ reason: 'بيانات غير مكتملة' });
    expect(rejected.status).toBe(200);

    const items = await notifications(employeeAToken);
    const decision = items.find(
      (item) => item.propertyId === id && item.type === 'PROPERTY_REJECTED',
    );
    expect(decision).toBeTruthy();
    expect(decision!.title).toBe('تم رفض تسجيل العقار');
    expect(decision!.message).toContain(
      'تم رفض طلب تسجيل عقارك. يمكنك الاطلاع على سبب الرفض وتفاصيل العقار.',
    );
    expect(decision!.message).toContain(code);
    expect(decision!.message).toContain('سبب الرفض: بيانات غير مكتملة');
    expect(decision!.message).toContain('التاريخ:');
    expect(decision!.message).not.toContain('عقار مشابه');

    // Another employee is never a recipient.
    expect(
      (await notifications(employeeBToken)).some(
        (item) => item.propertyId === id,
      ),
    ).toBe(false);

    // Creator-only read-only history (rejected rows are also visible normally).
    const history = await api()
      .get(`/properties/${id}/history`)
      .set(auth(employeeAToken));
    expect(history.status).toBe(200);
    expect(history.body.data.reviewNotes).toBe('بيانات غير مكتملة');
    const denied = await api()
      .get(`/properties/${id}/history`)
      .set(auth(employeeBToken));
    expect(denied.status).toBe(404);
  });

  it('OWNER soft delete with a duplicate reason flags «عقار مشابه» and keeps creator-only history', async () => {
    const { id, code } = await createProperty({ plotNumber: '7102' });

    // MANAGER must never delete, even with a valid review capability.
    const managerAttempt = await api()
      .post(`/properties/${id}/trash`)
      .set(auth(managerToken))
      .send({ reason: 'محاولة مدير' });
    expect(managerAttempt.status).toBe(403);
    expect(
      (await ctx.prisma.property.findUnique({ where: { id } }))?.deletedAt,
    ).toBeNull();

    const trashed = await api()
      .post(`/properties/${id}/trash`)
      .set(auth(ownerToken))
      .send({ reason: 'عقار مشابه لعقار مسجل' });
    expect(trashed.status).toBe(200);

    const items = await notifications(employeeAToken);
    const decision = items.find(
      (item) =>
        item.propertyId === id &&
        item.title === 'تم حذف العقار بقرار مالك النظام',
    );
    expect(decision).toBeTruthy();
    expect(decision!.message).toContain(
      'تم نقل عقارك إلى المحذوفات. يمكنك الاطلاع على تفاصيله وسبب الحذف.',
    );
    expect(decision!.message).toContain(code);
    expect(decision!.message).toContain('سبب الحذف: عقار مشابه لعقار مسجل');
    expect(decision!.message).toContain('عقار مشابه');

    const history = await api()
      .get(`/properties/${id}/history`)
      .set(auth(employeeAToken));
    expect(history.status).toBe(200);
    expect(history.body.data.deletionReason).toBe('عقار مشابه لعقار مسجل');
    expect(history.body.data.deletedAt).toBeTruthy();
    expect(history.body.data.status).toBe('PENDING');

    expect(
      (
        await api()
          .get(`/properties/${id}/history`)
          .set(auth(employeeBToken))
      ).status,
    ).toBe(404);
  });

  it('ordinary deletion is not labelled as a similar property', async () => {
    const { id } = await createProperty({ plotNumber: '7103' });
    await api()
      .post(`/properties/${id}/trash`)
      .set(auth(ownerToken))
      .send({ reason: 'طلب المالك' });
    const items = await notifications(employeeAToken);
    const decision = items.find(
      (item) =>
        item.propertyId === id &&
        item.title === 'تم حذف العقار بقرار مالك النظام',
    );
    expect(decision).toBeTruthy();
    expect(decision!.message).toContain('سبب الحذف: طلب المالك');
    expect(decision!.message).not.toContain('عقار مشابه');
  });

  it('repeated rejection requests do not create duplicate notifications', async () => {
    const { id } = await createProperty({ plotNumber: '7104' });
    await api()
      .post(`/properties/${id}/reject`)
      .set(auth(managerToken))
      .send({ reason: 'بيانات غير مكتملة' });
    const second = await api()
      .post(`/properties/${id}/reject`)
      .set(auth(managerToken))
      .send({ reason: 'بيانات غير مكتملة' });
    expect(second.status).toBe(409);
    const items = await notifications(employeeAToken);
    expect(
      items.filter(
        (item) =>
          item.propertyId === id && item.type === 'PROPERTY_REJECTED',
      ),
    ).toHaveLength(1);
  });

  it('permanent deletion keeps the decision history and answers gracefully', async () => {
    const { id, code } = await createProperty({ plotNumber: '7105' });
    await api()
      .post(`/properties/${id}/trash`)
      .set(auth(ownerToken))
      .send({ reason: 'عقار مشابه لعقار مسجل' });

    // MANAGER cannot perform the permanent deletion.
    const managerDelete = await api()
      .delete(`/properties/${id}/permanent`)
      .set(auth(managerToken))
      .send({ confirmationCode: code });
    expect(managerDelete.status).toBe(403);
    expect(
      await ctx.prisma.property.findUnique({ where: { id } }),
    ).toBeTruthy();

    const deleted = await api()
      .delete(`/properties/${id}/permanent`)
      .set(auth(ownerToken))
      .send({ confirmationCode: code });
    expect(deleted.status).toBe(200);

    const preserved = await ctx.prisma.notification.findFirst({
      where: {
        userId: employeeAId,
        eventKey: { startsWith: 'PROPERTY_TRASHED:' },
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(preserved).toBeTruthy();
    expect(preserved!.propertyId).toBeNull();
    expect(preserved!.body).toContain(code);

    const history = await api()
      .get(`/properties/${id}/history`)
      .set(auth(employeeAToken));
    expect(history.status).toBe(404);
    expect(history.body.error?.message ?? history.body.message).toContain(
      'تفاصيل العقار لم تعد متاحة بعد الحذف النهائي.',
    );
  });

  it('decision notifications route to the employee property with the decision flag', () => {
    const base = {
      clientId: null,
      contactId: null,
      contactType: null,
      clientReviewId: null,
      followUpSubjectId: null,
    };
    const rejected = notificationRoute(
      {
        ...base,
        propertyId: '11111111-1111-4111-8111-111111111111',
        eventKey: 'PROPERTY_REJECTED:round',
      },
      'EMPLOYEE',
    );
    expect(rejected?.path).toContain('/employee/properties?property=');
    expect(rejected?.path).toContain('&decision=1');

    const trashed = notificationRoute(
      {
        ...base,
        propertyId: '11111111-1111-4111-8111-111111111111',
        eventKey: 'PROPERTY_TRASHED:property',
      },
      'EMPLOYEE',
    );
    expect(trashed?.path).toContain('&decision=1');

    const normal = notificationRoute(
      {
        ...base,
        propertyId: '11111111-1111-4111-8111-111111111111',
        eventKey: 'PROPERTY_SUBMITTED:x',
      },
      'EMPLOYEE',
    );
    expect(normal?.path).not.toContain('decision=1');

    expect(isDecisionNotification({ eventKey: 'PROPERTY_REJECTED:x' })).toBe(true);
    expect(isDecisionNotification({ eventKey: 'PROPERTY_TRASHED:x' })).toBe(true);
    expect(isDecisionNotification({ eventKey: 'PROPERTY_APPROVED:x' })).toBe(false);
  });
});
