import { randomUUID } from 'node:crypto';
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
  clientId: string | null;
  contactId: string | null;
  contactType: string | null;
  followUpId: string | null;
  clientReviewId: string | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

/**
 * Record-activity notifications in the REVIEWED era.
 *
 * Employee CLIENT writes no longer exist as direct saves: an employee client
 * submission reports the ACTIVE managers through the CLIENT_REVIEW_* events
 * (exactly once, inside the same transaction, privacy-safe). Follow-up and
 * owner/broker contact saves keep reporting; manager actions never report
 * anyone; a failed save notifies nobody.
 */
describeWithDatabase('Record-activity notifications (reviewed era)', () => {
  let ctx: TestContext;
  let inactiveManagerId: string;
  let employeeAId: string;
  let managerToken: string;
  let manager2Token: string;
  let employeeAToken: string;
  let employeeBToken: string;

  const api = () => request(ctx.app.getHttpServer());

  /** A manager-registered client assigned to employee A (authorized edits). */
  const managerClient = async (
    payload: Record<string, unknown>,
    responsibleUserId?: string,
  ): Promise<{ id: string }> => {
    const response = await api()
      .post('/clients')
      .set(auth(managerToken))
      .send({ ...payload, ...(responsibleUserId ? { responsibleUserId } : {}) });
    expect(response.status).toBe(201);
    return response.body.data as { id: string };
  };

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
      email: 'manager@records.local',
      name: 'Manager Records',
      role: Role.MANAGER,
    });
    const manager2 = await createUser(ctx.prisma, {
      email: 'manager.two@records.local',
      name: 'Manager Two Records',
      role: Role.OWNER,
    });
    const inactiveManager = await createUser(ctx.prisma, {
      email: 'manager.off@records.local',
      name: 'Manager Off Records',
      role: Role.MANAGER,
    });
    await ctx.prisma.user.update({
      where: { id: inactiveManager.id },
      data: { isActive: false },
    });
    const employeeA = await createUser(ctx.prisma, {
      email: 'employee.a@records.local',
      name: 'موظف الأنشطة',
      role: Role.EMPLOYEE,
    });
    const employeeB = await createUser(ctx.prisma, {
      email: 'employee.b@records.local',
      name: 'Employee B Records',
      role: Role.EMPLOYEE,
    });
    inactiveManagerId = inactiveManager.id;
    employeeAId = employeeA.id;
    // Ownership resolves ONLY through EmployeeProfile profiles — provision them.
    await ctx.prisma.employeeProfile.upsert({ where: { userId: employeeA.id }, create: { userId: employeeA.id }, update: {} });
    await ctx.prisma.employeeProfile.upsert({ where: { userId: employeeB.id }, create: { userId: employeeB.id }, update: {} });
    managerToken = await login(ctx.app, manager.email);
    manager2Token = await login(ctx.app, manager2.email);
    employeeAToken = await login(ctx.app, employeeA.email);
    employeeBToken = await login(ctx.app, employeeB.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.prisma.notification.deleteMany({});
  });

  /** Rows of one event type as seen by the direct Manager. */
  const managersRows = async (type: string): Promise<NotificationItem[]> => {
    const rows = (await inbox(managerToken)).filter(
      (item) => item.type === type,
    );
    // The direct Manager is the sole recipient; the OWNER receives no copy
    // of the same review request.
    const ownerRows = (await inbox(manager2Token)).filter(
      (item) => item.type === type,
    );
    expect(ownerRows).toHaveLength(0);
    expect(JSON.stringify(rows)).not.toContain('userId');
    return rows;
  };

  it('reports CLIENT_REVIEW_SUBMITTED to the direct Manager only, privacy-safe', async () => {
    const ownerPhone = '65001111';
    const ownerName = 'زبون الأنشطة القحطاني';
    const review = await api()
      .post('/client-reviews')
      .set(auth(employeeAToken))
      .send({
        kind: 'CREATION',
        name: ownerName,
        phone: ownerPhone,
        notes: 'ملاحظة سرية يجب ألا تظهر 7777',
      });
    expect(review.status).toBe(201);
    const reviewId = (review.body.data as { id: string }).id;

    const rows = await managersRows('CLIENT_REVIEW_SUBMITTED');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'طلب عميل بانتظار المراجعة',
      propertyId: null,
      clientId: null,
      contactId: null,
      contactType: null,
      followUpId: null,
      clientReviewId: reviewId,
      read: false,
    });
    expect(rows[0]?.message).toContain('موظف الأنشطة');
    // A pending CREATION carries no clientId deep link (nothing approved yet).

    // The recipient set: the direct Manager only — nobody else.
    expect(
      await ctx.prisma.notification.count({ where: { userId: inactiveManagerId } }),
    ).toBe(0);
    expect(await ctx.prisma.notification.count({ where: { userId: employeeAId } })).toBe(0);
    expect(await inbox(employeeBToken)).toHaveLength(0);
    // The activity text never carries the proposed private data.
    const serialized = JSON.stringify(rows[0]);
    for (const secret of [ownerPhone, ownerName, 'ملاحظة سرية', '7777']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('no longer reports CLIENT record events: the direct paths are blocked for employees', async () => {
    const blocked = await api()
      .post('/clients')
      .set(auth(employeeAToken))
      .send({ name: 'عميل محظور', phone: '65002222' });
    expect(blocked.status).toBe(403);

    const client = await managerClient({
      name: 'عميل سجات',
      phone: '65002333',
    }, employeeAId);
    // Even an employee PATCH is refused — no CLIENT_UPDATED can ever exist.
    const denied = await api()
      .patch(`/clients/${client.id}`)
      .set(auth(employeeAToken))
      .send({ name: 'ممنوع' });
    expect(denied.status).toBe(403);

    const managerEdit = await api()
      .patch(`/clients/${client.id}`)
      .set(auth(managerToken))
      .send({ name: 'تعديل المدير'});
    expect(managerEdit.status).toBe(200);

    expect(await managersRows('CLIENT_CREATED')).toHaveLength(0);
    expect(await managersRows('CLIENT_UPDATED')).toHaveLength(0);
    expect(await managersRows('CLIENT_INTEREST_UPDATED')).toHaveLength(0);
  });

  it('reports a follow-up creation with both the client and follow-up references', async () => {
    const created = await managerClient(
      { name: 'زبون المتابعة', phone: '65004444' },
      employeeAId,
    );
    const dueAt = new Date(Date.now() + 7 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    const response = await api()
      .post(`/clients/${created.id}/follow-ups`)
      .set(auth(employeeAToken))
      .send({ dueAt, method: 'اتصال', outcome: 'رد', note: 'ملاحظة المتابعة 1234' });
    expect(response.status).toBe(201);
    const followUpId = (response.body.data as { id: string }).id;

    const rows = await managersRows('FOLLOWUP_CREATED');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'متابعة جديدة',
      message: 'موظف الأنشطة — سجّل متابعة لعميل',
      clientId: created.id,
      followUpId,
      propertyId: null,
      contactId: null,
    });
    // The free-text follow-up never leaks into the notification.
    expect(JSON.stringify(rows[0])).not.toContain('1234');
  });

  it('reports contact (owner/broker) creation with the card kind, never name or phone, and identical resaves stay silent', async () => {
    const owner = await api()
      .post('/contacts')
      .set(auth(employeeAToken))
      .send({ type: 'OWNER', name: 'مالك سرا', phone: '65005555' });
    expect(owner.status).toBe(201);
    const ownerId = (owner.body.data as { id: string }).id;

    const created = await managersRows('CONTACT_CREATED');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      title: 'جهة اتصال جديدة',
      message: 'موظف الأنشطة — سجّل جهة اتصال (مالك)',
      contactId: ownerId,
      contactType: 'OWNER',
      clientId: null,
    });
    expect(JSON.stringify(created[0])).not.toContain('65005555');
    expect(JSON.stringify(created[0])).not.toContain('مالك سرا');

    // Same values again: silent.
    const resave = await api()
      .patch(`/contacts/${ownerId}`)
      .set(auth(employeeAToken))
      .send({ name: 'مالك سرا', phone: '65005555' });
    expect(resave.status).toBe(200);
    expect(
      (await inbox(managerToken)).filter((item) => item.type === 'CONTACT_UPDATED'),
    ).toHaveLength(0);

    // A real change on a BROKER card carries the broker wording.
    const broker = await api()
      .post('/contacts')
      .set(auth(employeeAToken))
      .send({ type: 'BROKER', name: 'وسيط سرا', phone: '65006666' });
    expect(broker.status).toBe(201);
    const brokerId = (broker.body.data as { id: string }).id;
    await ctx.prisma.notification.deleteMany({});

    const patch = await api()
      .patch(`/contacts/${brokerId}`)
      .set(auth(employeeAToken))
      .send({ phone: '65007777' });
    expect(patch.status).toBe(200);

    const updated = await managersRows('CONTACT_UPDATED');
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      title: 'تحديث جهة اتصال',
      message: 'موظف الأنشطة — عدّل جهة اتصال (وسيط)',
      contactId: brokerId,
      contactType: 'BROKER',
    });
    expect(JSON.stringify(updated[0])).not.toContain('65007777');
    expect(JSON.stringify(updated[0])).not.toContain('وسيط سرا');
  });

  it('manager actions produce no record-activity notifications at all', async () => {
    await managerClient({ name: 'عميل المدير', phone: '65008888' });
    await api()
      .post('/contacts')
      .set(auth(managerToken))
      .send({ type: 'OWNER', name: 'مالك المدير', phone: '65009999' });
    const followed = await managerClient({
      name: 'عميل مدير متابعة',
      phone: '65010000',
    });
    await api()
      .post(`/clients/${followed.id}/follow-ups`)
      .set(auth(managerToken))
      .send({
        dueAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10),
        method: 'اتصال',
        outcome: 'رد',
      });

    expect(await ctx.prisma.notification.count()).toBe(0);
  });

  it('a failed submission or decision rolls the notification back with the write', async () => {
    // A PENDING property is visible to its employee but never linkable.
    const pending = await postProperty(ctx.app, employeeAToken, {
      listingType: 'SALE',
      governorate: 'الفروانية',
      district: 'غرناطة',
      block: '3',
      plotNumber: '12',
      sizeSqm: '400.00',
      askingPrice: '250000.00',
      negotiable: true,
      description: 'عقار معلق',
      floors: [{ type: 'GROUND', details: 'صالة' }],
      newContact: { type: 'BROKER', name: 'وسيط خاص', phone: '66661111' },
    }, image);
    const pendingId = (pending.body?.data as { id?: string } | undefined)?.id;
    // Clear the property-submission recording rows; only the failure below matters.
    await ctx.prisma.notification.deleteMany({});

    const reviewsBefore = await ctx.prisma.clientReviewRequest.count();
    const refused = await api()
      .post('/client-reviews')
      .set(auth(employeeAToken))
      .send({
        kind: 'CREATION',
        name: 'زبون السجل الفاشل',
        phone: '65011111',
        addInterests: [{ propertyId: pendingId }],
      });
    expect(refused.status).toBe(400);
    expect(await ctx.prisma.notification.count()).toBe(0);
    expect(await ctx.prisma.clientReviewRequest.count()).toBe(reviewsBefore);

    // A guessed EDIT target is a 404 that notifies nobody.
    await ctx.prisma.notification.deleteMany({});
    const ghost = await api()
      .post('/client-reviews')
      .set(auth(employeeAToken))
      .send({
        kind: 'EDIT',
        clientId: randomUUID(),
        name: 'طيف',
        phone: '65012222',
      });
    expect(ghost.status).toBe(404);
    expect(await ctx.prisma.notification.count()).toBe(0);
  });
});
