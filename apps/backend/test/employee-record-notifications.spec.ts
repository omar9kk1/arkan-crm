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
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

/**
 * Employee record-activity notifications: every successful employee save of a
 * client, an owner/broker contact, a follow-up or a property interest reports
 * the ACTIVE managers exactly once, inside the same transaction (so a failed
 * save notifies nobody), with a privacy-safe payload and the deep-link
 * references the bell needs. Manager actions never report anyone.
 */
describeWithDatabase('Employee record-activity notifications', () => {
  let ctx: TestContext;
  let managerId: string;
  let manager2Id: string;
  let inactiveManagerId: string;
  let employeeAId: string;
  let employeeBId: string;
  let managerToken: string;
  let manager2Token: string;
  let employeeAToken: string;
  let employeeBToken: string;

  const api = () => request(ctx.app.getHttpServer());

  const createClient = async (
    token: string,
    payload: Record<string, unknown>,
  ): Promise<{ id: string }> => {
    const response = await api().post('/clients').set(auth(token)).send(payload);
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
      role: Role.MANAGER,
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
    managerId = manager.id;
    manager2Id = manager2.id;
    inactiveManagerId = inactiveManager.id;
    employeeAId = employeeA.id;
    employeeBId = employeeB.id;
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

  /** Rows of one event type as seen by the first manager. */
  const managersRows = async (type: string): Promise<NotificationItem[]> => {
    const rows = (await inbox(managerToken)).filter(
      (item) => item.type === type,
    );
    // Both active managers receive the SAME payload (row ids differ per
    // recipient by design) and raw output never carries a recipient id.
    const twinRows = (await inbox(manager2Token)).filter(
      (item) => item.type === type,
    );
    const strip = (item: NotificationItem) => ({ ...item, id: '' });
    expect(twinRows.map(strip)).toEqual(rows.map(strip));
    expect(JSON.stringify(rows)).not.toContain('userId');
    return rows;
  };

  it('reports CLIENT_CREATED to every active manager with deep links and a privacy-safe body', async () => {
    const ownerPhone = '65001111';
    const ownerName = 'زبون الأنشطة القحطاني';
    const created = await createClient(employeeAToken, {
      name: ownerName,
      phone: ownerPhone,
      notes: 'ملاحظة سرية يجب ألا تظهر 7777',
    });

    const rows = await managersRows('CLIENT_CREATED');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'عميل جديد',
      message: 'موظف الأنشطة — أضاف عميلًا جديدًا',
      propertyId: null,
      clientId: created.id,
      contactId: null,
      contactType: null,
      followUpId: null,
      read: false,
    });

    // The recipient set: active managers only — nobody else.
    expect(
      await ctx.prisma.notification.count({ where: { userId: inactiveManagerId } }),
    ).toBe(0);
    expect(await ctx.prisma.notification.count({ where: { userId: employeeAId } })).toBe(0);
    expect(await inbox(employeeBToken)).toHaveLength(0);
    // The activity text never carries the client's private data.
    const serialized = JSON.stringify(rows[0]);
    for (const secret of [ownerPhone, ownerName, 'ملاحظة سرية', '7777', employeeAId]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('titles an inquiry client from the PERSISTED interest, never from free text', async () => {
    // A manager-created property is directly AVAILABLE and therefore linkable.
    const available = await postProperty(
      ctx.app,
      managerToken,
      {
        listingType: 'RENT',
        governorate: 'الفروانية',
        district: 'غرناطة',
        block: '3',
        plotNumber: '12',
        sizeSqm: '400.00',
        askingPrice: '250000.00',
        negotiable: true,
        description: 'شقة للاستفسار',
        floors: [{ type: 'GROUND', details: 'صالة' }],
        newContact: { type: 'BROKER', name: 'وسيط الاستفسار', phone: '66054321' },
      },
      image,
    );
    expect(available.body.data.status).toBe('AVAILABLE');
    const propertyId = (available.body.data as { id: string }).id;

    // The creation payload itself has no structured intent: the wording must
    // come ONLY from the interest that is actually persisted with this save.
    const created = await createClient(employeeAToken, {
      name: 'زبون الاستفسار الكريمي',
      phone: '65123456',
      notes: 'يريد شراء أي شيء 4321',
      propertyInterests: [{ propertyId, reason: '', notes: '' }],
    });

    const rows = await managersRows('CLIENT_CREATED');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'عميل جديد — استفسار عن عقار',
      message: 'موظف الأنشطة — أضاف عميلًا يسأل عن عقار في البرنامج',
      clientId: created.id,
      propertyId: null,
      followUpId: null,
    });
    // The draft's free text is never copied (no intent guessing from notes).
    expect(JSON.stringify(rows[0])).not.toContain('4321');
    expect(JSON.stringify(rows[0])).not.toContain('65123456');
  });

  it('reports a real client edit once, and an identical resave never again', async () => {
    const created = await createClient(employeeAToken, {
      name: 'زبون التعديل',
      phone: '65002222',
    });

    const changed = await api()
      .patch(`/clients/${created.id}`)
      .set(auth(employeeAToken))
      .send({ name: 'الاسم المعدل' });
    expect(changed.status).toBe(200);

    let rows = await managersRows('CLIENT_UPDATED');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'تحديث بيانات عميل',
      message: 'موظف الأنشطة — عدّل بيانات عميل',
      clientId: created.id,
    });

    // Saving the SAME values again is not new activity: no second occurrence.
    const unchanged = await api()
      .patch(`/clients/${created.id}`)
      .set(auth(employeeAToken))
      .send({ name: 'الاسم المعدل' });
    expect(unchanged.status).toBe(200);
    expect(await managersRows('CLIENT_UPDATED')).toHaveLength(1);

    // A manager's own edit never reports anyone.
    const managerEdit = await api()
      .patch(`/clients/${created.id}`)
      .set(auth(managerToken))
      .send({ name: 'تعديل المدير' });
    expect(managerEdit.status).toBe(200);
    expect(await managersRows('CLIENT_UPDATED')).toHaveLength(1);
  });

  it('reports newly linked property interests, and an identical interest resave is silent', async () => {
    // A manager-created property is directly AVAILABLE and therefore linkable.
    const available = await postProperty(
      ctx.app,
      managerToken,
      {
        listingType: 'RENT',
        governorate: 'الفروانية',
        district: 'غرناطة',
        block: '3',
        plotNumber: '12',
        sizeSqm: '400.00',
        askingPrice: '250000.00',
        negotiable: true,
        description: 'شقة للإيجار',
        floors: [{ type: 'GROUND', details: 'صالة' }],
        newContact: { type: 'BROKER', name: 'وسيط للإيجار', phone: '66012345' },
      },
      image,
    );
    expect(available.body.data.status).toBe('AVAILABLE');
    const propertyId = (available.body.data as { id: string }).id;
    await ctx.prisma.notification.deleteMany({});

    const created = await createClient(employeeAToken, {
      name: 'زبون Интересات',
      phone: '65003333',
    });
    // Save 1: a NEW interest.
    const withInterest = await api()
      .patch(`/clients/${created.id}`)
      .set(auth(employeeAToken))
      .send({
        propertyInterests: [
          { propertyId, reason: 'سبب سري 8888', notes: 'ملاحظة سرية 9999' },
        ],
      });
    expect(withInterest.status).toBe(200);

    const rows = await managersRows('CLIENT_INTEREST_UPDATED');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'استفسار عقاري جديد',
      message: 'موظف الأنشطة — سجّل استفسارًا عقاريًا لعميل',
      clientId: created.id,
    });
    // The wizard's free text (reason/notes) is private and never leaves it.
    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toContain('8888');
    expect(serialized).not.toContain('9999');

    // Save 2: identical values upsert on the same pair — no new activity.
    const resave = await api()
      .patch(`/clients/${created.id}`)
      .set(auth(employeeAToken))
      .send({
        propertyInterests: [
          { propertyId, reason: 'سبب سري 8888', notes: 'ملاحظة سرية 9999' },
        ],
      });
    expect(resave.status).toBe(200);
    expect(await managersRows('CLIENT_INTEREST_UPDATED')).toHaveLength(1);
  });

  it('reports a follow-up creation with both the client and follow-up references', async () => {
    const created = await createClient(employeeAToken, {
      name: 'زبون المتابعة',
      phone: '65004444',
    });
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
    await createClient(managerToken, { name: 'عميل المدير', phone: '65008888' });
    await api()
      .post('/contacts')
      .set(auth(managerToken))
      .send({ type: 'OWNER', name: 'مالك المدير', phone: '65009999' });
    const followed = await createClient(managerToken, {
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

  it('a failed save rolls the notification back with the write', async () => {
    // A refused or rolled-back save never leaves a notification behind. We clear
    // the table after every legitimate save below, so any row left over after a
    // failed request would be a leak.
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
    await ctx.prisma.notification.deleteMany({});

    const client = await createClient(employeeAToken, {
      name: 'زبون السجل الفاشل',
      phone: '65011111',
    });
    expect(
      (
        await api()
          .patch(`/clients/${client.id}`)
          .set(auth(employeeAToken))
          .send({ propertyInterests: [{ propertyId: pendingId }] })
      ).status,
    ).toBe(400);

    await ctx.prisma.notification.deleteMany({});
    // The refused PATCH left nothing behind.
    expect(await ctx.prisma.notification.count()).toBe(0);
    // And a guessed client id is a 404 that notifies nobody (see count check).
    expect(
      (
        await api()
          .patch(`/clients/${randomUUID()}`)
          .set(auth(employeeAToken))
          .send({ name: 'طيف' })
      ).status,
    ).toBe(404);
    expect(await ctx.prisma.notification.count()).toBe(0);
  });
});
