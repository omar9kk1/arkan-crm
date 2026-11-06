import { Role } from '@arkan/shared';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { ContactType } from '@prisma/client';
import {
  auth,
  createTestApp,
  createUser,
  describeWithDatabase,
  login,
  resetDatabase,
  type TestContext,
} from './support/test-app';
import { NotificationsService } from '../src/notifications/notifications.service';

jest.setTimeout(180000);

/**
 * The manager notification fan-out of the employee follow-up batch save.
 *
 * Regression coverage for the 500 that made every employee save fail inside
 * its transaction, plus the required guarantees:
 *  - preference OFF → the save succeeds and nobody is notified;
 *  - preference ON → exactly ONE notification per committed entry;
 *  - a replayed batchId never duplicates history or notifications;
 *  - a notification delivery failure never rolls back a committed save;
 *  - a manager's own save never notifies managers;
 *  - an invalid/expired session gets a controlled 401 and writes nothing;
 *  - the body names the REAL person category (owner/broker/buyer/tenant/…)
 *    from persisted subject data, never a blanket «عميل».
 */
describeWithDatabase('Follow-up batch manager notifications', () => {
  let ctx: TestContext;
  let managerId: string;
  let managerToken: string;
  let employeeProfileId: string;
  let employeeToken: string;
  let referenceCounter = 0;
  const api = () => request(ctx.app.getHttpServer());

  const nextReference = () =>
    `A-9${String((referenceCounter += 1)).padStart(5, '0')}`;

  const saveBatch = (
    token: string,
    batchId: string,
    items: Array<{ subjectId: string; note: string }>,
  ) =>
    api().post('/follow-ups/batch').set(auth(token)).send({ batchId, items });

  const createSubject = async (options?: {
    managerOwned?: boolean;
  }): Promise<string> => {
    const row = await ctx.prisma.followUpSubject.create({
      data: {
        targetKey: `INQUIRY:manager-notify:${randomUUID()}`,
        kind: 'INQUIRY',
        responsibleId: options?.managerOwned ? null : employeeProfileId,
        responsibleUserId: options?.managerOwned ? managerId : null,
        activatedAt: new Date(),
        nextDueAt: new Date(Date.now() + 72 * 3_600_000),
      },
      select: { id: true },
    });
    return row.id;
  };

  /** Builds a subject WITH its real linked person/record, like `sync` does. */
  const createSubjectWithPerson = async (options: {
    kind: 'PROPERTY_OWNER' | 'CLIENT_REQUEST' | 'INQUIRY' | 'CLIENT';
    personType?: ContactType; // PROPERTY_OWNER only (owner vs broker card)
    requestType?: 'BUYER' | 'RENTER' | 'EXCHANGER'; // CLIENT_REQUEST only
    personName: string;
    withIdentity?: boolean; // false → broken/legacy shape for the fallback case
  }): Promise<string> => {
    if (options.kind === 'PROPERTY_OWNER') {
      const contact = await ctx.prisma.contact.create({
        data: {
          type: options.personType ?? 'OWNER',
          name: options.personName,
          phone: `66${String(referenceCounter).padStart(6, '0')}`,
        },
      });
      const property = await ctx.prisma.property.create({
        data: {
          reference: nextReference(),
          title: 'عقار الإشعارات',
          area: 'الجهراء',
          currency: 'KWD',
          listingType: 'SALE',
          contactId: options.withIdentity === false ? null : contact.id,
        },
      });
      const row = await ctx.prisma.followUpSubject.create({
        data: {
          targetKey: `PROPERTY_OWNER:${property.id}`,
          kind: 'PROPERTY_OWNER',
          responsibleId: employeeProfileId,
          propertyId: property.id,
          activatedAt: new Date(),
          nextDueAt: new Date(Date.now() + 72 * 3_600_000),
        },
        select: { id: true },
      });
      return row.id;
    }

    if (options.withIdentity === false) {
      // A legacy/ambiguous subject: no reliable identity is readable, the
      // wording must fall back to the neutral «متابعة جديدة».
      const row = await ctx.prisma.followUpSubject.create({
        data: {
          targetKey: `BROKEN:${randomUUID()}`,
          kind: 'CLIENT',
          responsibleId: employeeProfileId,
          activatedAt: new Date(),
          nextDueAt: new Date(Date.now() + 72 * 3_600_000),
        },
        select: { id: true },
      });
      return row.id;
    }

    const client = await ctx.prisma.client.create({
      data: {
        name: options.personName,
        phone: `66${String(referenceCounter).padStart(6, '0')}`,
        responsibleEmployeeId: employeeProfileId,
        ...(options.kind === 'CLIENT_REQUEST'
          ? { requestData: JSON.stringify({ types: [options.requestType] }) }
          : {}),
      },
    });

    if (options.kind === 'CLIENT_REQUEST') {
      const requestType = options.requestType ?? 'BUYER';
      const row = await ctx.prisma.followUpSubject.create({
        data: {
          targetKey: `CLIENT_REQUEST:${client.id}:${requestType}`,
          kind: 'CLIENT_REQUEST',
          responsibleId: employeeProfileId,
          clientId: client.id,
          activatedAt: new Date(),
          nextDueAt: new Date(Date.now() + 72 * 3_600_000),
        },
        select: { id: true },
      });
      return row.id;
    }

    if (options.kind === 'CLIENT') {
      const row = await ctx.prisma.followUpSubject.create({
        data: {
          targetKey: `CLIENT:${client.id}`,
          kind: 'CLIENT',
          responsibleId: employeeProfileId,
          clientId: client.id,
          activatedAt: new Date(),
          nextDueAt: new Date(Date.now() + 72 * 3_600_000),
        },
        select: { id: true },
      });
      return row.id;
    }

    // INQUIRY: client + their saved interest on a property.
    const property = await ctx.prisma.property.create({
      data: {
        reference: nextReference(),
        title: 'استفسار الإشعارات',
        area: 'الأحمدي',
        currency: 'KWD',
        listingType: 'RENT',
      },
    });
    const interest = await ctx.prisma.clientPropertyInterest.create({
      data: { clientId: client.id, propertyId: property.id },
    });
    const row = await ctx.prisma.followUpSubject.create({
      data: {
        targetKey: `INQUIRY:${interest.id}`,
        kind: 'INQUIRY',
        responsibleId: employeeProfileId,
        clientId: client.id,
        interestId: interest.id,
        propertyId: property.id,
        activatedAt: new Date(),
        nextDueAt: new Date(Date.now() + 72 * 3_600_000),
      },
      select: { id: true },
    });
    return row.id;
  };

  /** The ONE manager notification a committed employee save produced. */
  const singleNotificationBody = async (subjectId: string): Promise<string> => {
    const rows = await ctx.prisma.notification.findMany({
      where: { userId: managerId, followUpSubjectId: subjectId },
      select: { body: true },
    });
    expect(rows).toHaveLength(1);
    return rows[0]!.body;
  };

  const saveAndReadBody = async (subjectId: string): Promise<string> => {
    await setPreference(true);
    const response = await saveBatch(employeeToken, randomUUID(), [
      { subjectId, note: 'ملاحظة الكلمات المرتبطة بالإشعار.' },
    ]);
    expect([200, 201]).toContain(response.status);
    return singleNotificationBody(subjectId);
  };

  const setPreference = (enabled: boolean) =>
    ctx.prisma.user.update({
      where: { id: managerId },
      data: { notifyEmployeeFollowUps: enabled },
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'manager-notify@followups.local',
      name: 'مدير الإشعارات',
      role: Role.MANAGER,
    });
    const employee = await createUser(ctx.prisma, {
      email: 'employee-notify@followups.local',
      name: 'موظف المتابعة',
      role: Role.EMPLOYEE,
    });
    managerId = manager.id;
    managerToken = await login(ctx.app, manager.email);
    employeeToken = await login(ctx.app, employee.email);
    employeeProfileId = (
      await ctx.prisma.employeeProfile.create({ data: { userId: employee.id } })
    ).id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('saves normally while the manager preference is OFF (no notification)', async () => {
    await setPreference(false);
    const subjectId = await createSubject();
    const batchId = randomUUID();

    const response = await saveBatch(employeeToken, batchId, [
      { subjectId, note: 'ملاحظة عادية والإشعارات متوقفة.' },
    ]);

    expect([200, 201]).toContain(response.status);
    expect(response.body.data).toMatchObject({
      replayed: false,
      savedCount: 1,
    });
    expect(
      await ctx.prisma.followUpEntry.count({ where: { subjectId, batchId } }),
    ).toBe(1);
    expect(
      await ctx.prisma.notification.count({
        where: { userId: managerId, followUpSubjectId: subjectId },
      }),
    ).toBe(0);
  });

  it('notifies ONE manager exactly once when the preference is ON', async () => {
    await setPreference(true);
    const subjectId = await createSubject();
    const batchId = randomUUID();

    const response = await saveBatch(employeeToken, batchId, [
      { subjectId, note: 'ملاحظة تستحق إشعار المدير.' },
    ]);

    expect([200, 201]).toContain(response.status);
    expect(response.body.data).toMatchObject({
      replayed: false,
      savedCount: 1,
    });
    const rows = await ctx.prisma.notification.findMany({
      where: { userId: managerId, followUpSubjectId: subjectId },
      select: {
        type: true,
        title: true,
        body: true,
        eventKey: true,
        followUpSubjectId: true,
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('FOLLOWUP_CREATED');
    expect(rows[0]?.followUpSubjectId).toBe(subjectId);
    expect(rows[0]?.body).toContain('موظف المتابعة');
    expect(rows[0]?.eventKey).toContain('FOLLOWUP_CREATED:');
  });

  it('replays the same batchId without duplicate history or notifications', async () => {
    await setPreference(true);
    const subjectId = await createSubject();
    const batchId = randomUUID();
    const payload = [{ subjectId, note: 'ملاحظة تُحفظ مرة واحدة فقط.' }];

    const first = await saveBatch(employeeToken, batchId, payload);
    expect([200, 201]).toContain(first.status);
    const notificationCountAfterFirst = await ctx.prisma.notification.count({
      where: { userId: managerId, followUpSubjectId: subjectId },
    });
    expect(notificationCountAfterFirst).toBe(1);

    const replay = await saveBatch(employeeToken, batchId, payload);
    expect([200, 201]).toContain(replay.status);
    expect(replay.body.data).toMatchObject({ replayed: true, savedCount: 1 });
    expect(
      await ctx.prisma.followUpEntry.count({ where: { subjectId, batchId } }),
    ).toBe(1);
    expect(
      await ctx.prisma.notification.count({
        where: { userId: managerId, followUpSubjectId: subjectId },
      }),
    ).toBe(notificationCountAfterFirst);
  });

  it('keeps a committed save when notification delivery fails afterward', async () => {
    await setPreference(true);
    const subjectId = await createSubject();
    const batchId = randomUUID();
    const notifications = ctx.app.get(NotificationsService);
    const spy = jest
      .spyOn(notifications, 'deliverDrafts')
      .mockRejectedValueOnce(new Error('simulated notification outage'));

    const response = await saveBatch(employeeToken, batchId, [
      { subjectId, note: 'الحفظ يجب أن ينجح رغم فشل الإشعار.' },
    ]);

    spy.mockRestore();
    expect([200, 201]).toContain(response.status);
    expect(response.body.data).toMatchObject({
      replayed: false,
      savedCount: 1,
    });
    expect(
      await ctx.prisma.followUpEntry.count({ where: { subjectId, batchId } }),
    ).toBe(1);
    expect(
      await ctx.prisma.followUpSubject.findUniqueOrThrow({
        where: { id: subjectId },
        select: { cycle: true },
      }),
    ).toMatchObject({ cycle: 2 });
    expect(
      await ctx.prisma.notification.count({
        where: { userId: managerId, followUpSubjectId: subjectId },
      }),
    ).toBe(0);
  });

  it('never notifies managers for a manager-owned save', async () => {
    await setPreference(true);
    const subjectId = await createSubject({ managerOwned: true });
    const before = await ctx.prisma.notification.count({
      where: { userId: managerId },
    });

    const response = await saveBatch(managerToken, randomUUID(), [
      { subjectId, note: 'متابعة المدير الشخصية.' },
    ]);

    expect([200, 201]).toContain(response.status);
    expect(await ctx.prisma.followUpEntry.count({ where: { subjectId } })).toBe(
      1,
    );
    expect(
      await ctx.prisma.notification.count({ where: { userId: managerId } }),
    ).toBe(before);
  });

  it('exposes the subject and entry deep-link ids to the monitoring manager', async () => {
    await setPreference(true);
    const subjectId = await createSubject();
    const batchId = randomUUID();
    const response = await saveBatch(employeeToken, batchId, [
      { subjectId, note: 'روابط الإشعار تظل معتمِدة على البيانات المخزونة.' },
    ]);
    const entryId = (
      response.body.data as { saved: Array<{ entryId: string }> }
    ).saved[0]?.entryId;

    const feed = await api()
      .get('/notifications?limit=20')
      .set(auth(managerToken));
    expect(feed.status).toBe(200);
    const row = (
      feed.body.data as {
        items: Array<{
          type: string;
          followUpSubjectId: string | null;
          eventKey: string | null;
        }>;
      }
    ).items.find(
      (candidate) =>
        candidate.type === 'FOLLOWUP_CREATED' &&
        candidate.followUpSubjectId === subjectId,
    );
    expect(row).toBeDefined();
    // The monitoring manager's copy carries the SAME deep-link ids the
    // employee late-warning rows already carry for their recipients. The
    // entry id arrives inside the stored dedup key
    // `FOLLOWUP_CREATED:<entryId>` (the legacy `followUpId` column points at
    // the legacy FollowUp table, never at FollowUpEntry rows).
    expect(row?.eventKey ?? null).toBe(`FOLLOWUP_CREATED:${entryId ?? ''}`);
  });

  it('answers a controlled 401 for an expired/invalid session and writes nothing', async () => {
    const subjectId = await createSubject();
    const entriesBefore = await ctx.prisma.followUpEntry.count();
    const body = {
      batchId: randomUUID(),
      items: [{ subjectId, note: 'لا يجب أن تُحفظ بلا جلسة.' }],
    };

    const anonymous = await api().post('/follow-ups/batch').send(body);
    const invalid = await api()
      .post('/follow-ups/batch')
      .set('Authorization', 'Bearer not-a-valid-token')
      .send(body);

    expect(anonymous.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(await ctx.prisma.followUpEntry.count()).toBe(entriesBefore);
  });

  it('serves the notification inbox for a valid session and 401 otherwise', async () => {
    const page = await api()
      .get('/notifications?limit=20')
      .set(auth(employeeToken));
    const unread = await api()
      .get('/notifications/unread-count')
      .set(auth(employeeToken));
    const invalid = await api()
      .get('/notifications?limit=20')
      .set('Authorization', 'Bearer not-a-valid-token');

    expect(page.status).toBe(200);
    expect(unread.status).toBe(200);
    expect(invalid.status).toBe(401);
  });

  // --- The body names the REAL person, never a blanket «عميل» ---------------

  it('says «المالك» with the person name and the property code for an owner subject', async () => {
    const subjectId = await createSubjectWithPerson({
      kind: 'PROPERTY_OWNER',
      personType: 'OWNER',
      personName: 'أبو ديجو',
    });
    const row = await ctx.prisma.followUpSubject.findUniqueOrThrow({
      where: { id: subjectId },
      select: { property: { select: { reference: true } } },
    });
    expect(await saveAndReadBody(subjectId)).toBe(
      `سجّل موظف المتابعة متابعة مع المالك أبو ديجو بخصوص العقار ${row.property?.reference ?? ''}.`,
    );
  });

  it('says «الوسيط» for a broker contact (person role, not the subject type)', async () => {
    const subjectId = await createSubjectWithPerson({
      kind: 'PROPERTY_OWNER',
      personType: 'BROKER',
      personName: 'أحمد',
    });
    expect(await saveAndReadBody(subjectId)).toBe(
      'سجّل موظف المتابعة متابعة مع الوسيط أحمد.',
    );
  });

  it('says «المشتري» for a buyer request subject', async () => {
    const subjectId = await createSubjectWithPerson({
      kind: 'CLIENT_REQUEST',
      requestType: 'BUYER',
      personName: 'أحمد',
    });
    expect(await saveAndReadBody(subjectId)).toBe(
      'سجّل موظف المتابعة متابعة مع المشتري أحمد بخصوص طلب شراء.',
    );
  });

  it('says «المستأجر» for a renter request subject', async () => {
    const subjectId = await createSubjectWithPerson({
      kind: 'CLIENT_REQUEST',
      requestType: 'RENTER',
      personName: 'خالد',
    });
    expect(await saveAndReadBody(subjectId)).toBe(
      'سجّل موظف المتابعة متابعة مع المستأجر خالد بخصوص طلب إيجار.',
    );
  });

  it('labels an exchange-request subject accurately as «مبدل عقار»', async () => {
    const subjectId = await createSubjectWithPerson({
      kind: 'CLIENT_REQUEST',
      requestType: 'EXCHANGER',
      personName: 'فهد',
    });
    expect(await saveAndReadBody(subjectId)).toBe(
      'سجّل موظف المتابعة متابعة مع مبدل عقار فهد بخصوص طلب بدل.',
    );
  });

  it('describes an inquiry subject by its property code', async () => {
    const subjectId = await createSubjectWithPerson({
      kind: 'INQUIRY',
      personName: 'سعود',
    });
    const row = await ctx.prisma.followUpSubject.findUniqueOrThrow({
      where: { id: subjectId },
      select: { property: { select: { reference: true } } },
    });
    expect(await saveAndReadBody(subjectId)).toBe(
      `سجّل موظف المتابعة متابعة مع العميل سعود بخصوص استفسار العقار ${row.property?.reference ?? ''}.`,
    );
  });

  it('falls back to the neutral «متابعة جديدة» for legacy clients', async () => {
    const subjectId = await createSubjectWithPerson({
      kind: 'CLIENT',
      personName: 'ماجد',
    });
    expect(await saveAndReadBody(subjectId)).toBe(
      'سجّل موظف المتابعة متابعة جديدة مع ماجد.',
    );
  });

  it('falls back to a bare neutral wording when no identity is readable', async () => {
    const subjectId = await createSubjectWithPerson({
      kind: 'CLIENT',
      personName: 'كذا',
      withIdentity: false,
    });
    expect(await saveAndReadBody(subjectId)).toBe(
      'سجّل موظف المتابعة متابعة جديدة.',
    );
  });

  it('keeps the followUpSubjectId deep link on the reworded notification', async () => {
    // The wording change does not touch delivery/deep links: the row still
    // carries exactly one followUpSubjectId per notification.
    const subjectId = await createSubjectWithPerson({
      kind: 'PROPERTY_OWNER',
      personType: 'OWNER',
      personName: 'غالب',
    });
    expect(await saveAndReadBody(subjectId)).toContain('المالك');
    const rows = await ctx.prisma.notification.findMany({
      where: { userId: managerId, followUpSubjectId: subjectId },
      select: { followUpSubjectId: true, eventKey: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.followUpSubjectId).toBe(subjectId);
    expect(rows[0]?.eventKey).toContain('FOLLOWUP_CREATED:');
  });

  it('serves the notification inbox for a valid session and 401 otherwise', async () => {
    const page = await api()
      .get('/notifications?limit=20')
      .set(auth(employeeToken));
    const unread = await api()
      .get('/notifications/unread-count')
      .set(auth(employeeToken));
    const invalid = await api()
      .get('/notifications?limit=20')
      .set('Authorization', 'Bearer not-a-valid-token');

    expect(page.status).toBe(200);
    expect(unread.status).toBe(200);
    expect(invalid.status).toBe(401);
  });
});
