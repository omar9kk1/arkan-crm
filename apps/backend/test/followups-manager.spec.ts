import { Role } from '@arkan/shared';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
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
import { FollowUpsService } from '../src/followups/followups.service';

jest.setTimeout(180000);

const HOUR = 3_600_000;
const image = [{ buffer: pngBytes(), filename: 'photo.png' }];

const propertyPayload = (suffix: string) => ({
  listingType: 'SALE',
  governorate: 'الفروانية',
  district: 'غرناطة',
  block: '7',
  plotNumber: `${suffix}`,
  sizeSqm: '350.00',
  askingPrice: '180000.00',
  negotiable: true,
  description: 'بيت للبيع لمتابعة المدير',
  floors: [{ type: 'GROUND', details: 'صالة' }],
  newContact: { type: 'OWNER', name: 'مالك متابعة المدير', phone: '66111101' },
});

/**
 * The MANAGER follow-ups extension (tasks §2–§8 of the manager page):
 * manager-owned subjects («متابعاتي»), responsibility transfers, the
 * read-only supervision overview and the manual reminders — everything
 * against the ISOLATED test database, never a dev-database shortcut.
 */
describeWithDatabase('Manager follow-ups (own queue, supervision, reminders)', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let managerToken: string;
  let managerId: string;
  let employeeAToken: string;
  let employeeAId: string;
  let employeeAProfile: string;
  let employeeBToken: string;
  let employeeBProfile: string;
  let schedule: FollowUpsService;
  const api = () => request(ctx.app.getHttpServer());

  const postClient = (token: string, body: Record<string, unknown>) =>
    api().post('/clients').set(auth(token)).send(body);

  const list = (token: string) => api().get('/follow-ups').set(auth(token));

  const overview = (token: string) =>
    api().get('/follow-ups/manager/overview').set(auth(token));

  const history = (token: string, id: string) =>
    api().get(`/follow-ups/${id}/history`).set(auth(token));

  const saveBatch = (
    token: string,
    batchId: string,
    items: Array<{ subjectId: string; note: string }>,
  ) => api().post('/follow-ups/batch').set(auth(token)).send({ batchId, items });

  const remind = (token: string, subjectId: string) =>
    api().post(`/follow-ups/${subjectId}/reminder`).set(auth(token));

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'manager-m@followups.local',
      name: 'مدير الإشراف',
      role: Role.MANAGER,
    });
    const employeeA = await createUser(ctx.prisma, {
      email: 'employee-a-m@followups.local',
      name: 'موظف الإشراف أ',
      role: Role.EMPLOYEE,
    });
    const employeeB = await createUser(ctx.prisma, {
      email: 'employee-b-m@followups.local',
      name: 'موظف الإشراف ب',
      role: Role.EMPLOYEE,
    });
    const owner = await createUser(ctx.prisma, {
      email: 'owner-m@followups.local',
      name: 'Owner Followups',
      role: Role.OWNER,
    });
    ownerToken = await login(ctx.app, owner.email);
    managerToken = await login(ctx.app, manager.email);
    employeeAToken = await login(ctx.app, employeeA.email);
    employeeBToken = await login(ctx.app, employeeB.email);
    managerId = manager.id;
    employeeAId = employeeA.id;
    employeeAProfile = (
      await ctx.prisma.employeeProfile.upsert({ where: { userId: employeeA.id }, create: { userId: employeeA.id }, update: {} })
    ).id;
    employeeBProfile = (
      await ctx.prisma.employeeProfile.upsert({ where: { userId: employeeB.id }, create: { userId: employeeB.id }, update: {} })
    ).id;
    schedule = ctx.app.get(FollowUpsService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  const approveProperty = async (id: string, token = ownerToken) => {
    // A Manager-created property enters review and the OWNER decides it.
    // An employee property is decided by that employee's direct Manager.
    const approved = await api()
      .post(`/properties/${id}/approve`)
      .set(auth(token))
      .send({});
    expect([200, 201, 409]).toContain(approved.status);
    if (approved.status !== 409) return;
    const row = await ctx.prisma.property.findUniqueOrThrow({
      where: { id },
      select: { status: true },
    });
    expect(row.status).toBe('AVAILABLE');
  };

  const employeeProperty = async (token: string, suffix: string) => {
    const created = await postProperty(
      ctx.app,
      token,
      propertyPayload(suffix),
      image,
    );
    expect(created.status).toBe(201);
    const property = created.body.data as { id: string };
    await approveProperty(property.id, managerToken);
    return property;
  };

  it('materializes ONE manager-owned subject for a manager-entered property', async () => {
    const created = await postProperty(
      ctx.app,
      managerToken,
      propertyPayload('111'),
      image,
    );
    expect(created.status).toBe(201);
    const property = created.body.data as { id: string };
    await approveProperty(property.id);
    await schedule.sync(null);
    await schedule.sync(null); // idempotent convergence on ONE row

    const subject = await ctx.prisma.followUpSubject.findFirstOrThrow({
      where: { propertyId: property.id },
      select: { id: true, responsibleId: true, responsibleUserId: true, nextDueAt: true },
    });
    // The responsible user is the MANAGER himself (his real account),
    // never an employee profile.
    expect(subject.responsibleUserId).toBe(managerId);
    expect(subject.responsibleId).toBeNull();
    expect(subject.nextDueAt.getTime()).toBeGreaterThan(Date.now() + 70 * HOUR);

    // «متابعاتي»: the manager's personal list lists ONLY his own subjects —
    // the employee subjects of the company never mix into it.
    const mine = (await list(managerToken)).body.data as {
      items: Array<{ id: string; responsible: { userId: string; name: string } }>;
    };
    expect(mine.items.length).toBeGreaterThan(0);
    for (const item of mine.items) expect(item.responsible?.userId).toBe(managerId);
    expect(mine.items.map((item) => item.id)).toContain(subject.id);

    // The EMPLOYEE list never carries a manager-owned subject.
    const theirs = (await list(employeeAToken)).body.data as { items: Array<{ id: string }> };
    expect(theirs.items.map((item) => item.id)).not.toContain(subject.id);

    // The manager saves HIS OWN note: recorded as the manager author.
    const batchId = randomUUID();
    const saved = await saveBatch(managerToken, batchId, [
      { subjectId: subject.id, note: 'متابعتي الشخصية: أبلغت المالك بالسعر.' },
    ]);
    expect([200, 201]).toContain(saved.status);
    const entry = await ctx.prisma.followUpEntry.findFirstOrThrow({
      where: { subjectId: subject.id },
      select: { authorId: true, authorUserId: true },
    });
    expect(entry.authorUserId).toBe(managerId);
    expect(entry.authorId).toBeNull();
    // Idempotent replay for the manager too.
    const replay = await saveBatch(managerToken, batchId, [
      { subjectId: subject.id, note: 'متابعتي الشخصية: أبلغت المالك بالسعر.' },
    ]);
    expect([200, 201]).toContain(replay.status);
    expect((replay.body.data as { replayed: boolean }).replayed).toBe(true);
  });

  it('transfers a manager-owned property subject to an assigned employee', async () => {
    // Create + approve a manager property, then find its subject.
    const created = await postProperty(
      ctx.app,
      managerToken,
      propertyPayload('222'),
      image,
    );
    const property = created.body.data as { id: string };
    await approveProperty(property.id);
    await schedule.sync(null);
    const before = await ctx.prisma.followUpSubject.findFirstOrThrow({
      where: { propertyId: property.id },
      select: { id: true },
    });
    await saveBatch(managerToken, randomUUID(), [
      { subjectId: before.id, note: 'ملاحظة قبل التسليم للموظف.' },
    ]);
    // The due read AFTER the manager's own save: the transfer must NOT
    // re-reset it.
    const dueBefore = (
      await ctx.prisma.followUpSubject.findUniqueOrThrow({
        where: { id: before.id },
        select: { nextDueAt: true },
      })
    ).nextDueAt.getTime();

    // The manager assigns employee A with an OWNER_FOLLOWUP assignment.
    await ctx.prisma.propertyAssignment.create({
      data: {
        propertyId: property.id,
        employeeId: employeeAProfile,
        purpose: 'OWNER_FOLLOWUP',
      },
    });
    await schedule.sync(null);
    await schedule.sync(null);

    // The SAME row moved (no duplicate subject, no due-date reset), and the
    // history was kept.
    const after = await ctx.prisma.followUpSubject.findFirstOrThrow({
      where: { propertyId: property.id },
      select: { id: true, responsibleId: true, responsibleUserId: true, nextDueAt: true },
    });
    expect(after.id).toBe(before.id);
    expect(after.responsibleId).toBe(employeeAProfile);
    expect(after.responsibleUserId).toBeNull();
    expect(after.nextDueAt.getTime()).toBe(dueBefore);
    const entries = await ctx.prisma.followUpEntry.findMany({
      where: { subjectId: after.id },
      select: { id: true },
    });
    expect(entries).toHaveLength(1);

    // Now it lives in the EMPLOYEE's list and left the manager's queue —
    // exactly once, never on both sides.
    const employees = (await list(employeeAToken)).body.data as { items: Array<{ id: string }> };
    expect(employees.items.map((item) => item.id)).toContain(after.id);
    const managerFeed = (await list(managerToken)).body.data as { items: Array<{ id: string }> };
    expect(managerFeed.items.map((item) => item.id)).not.toContain(after.id);
  });

  it('creates a MANAGER-owned subject for a manager-registered client and moves it on assignment', async () => {
    // Manager registers a client with NO responsible employee via the real
    // API path → the client's follow-up is HIS OWN obligation.
    const created = await postClient(managerToken, {
      name: 'عميل المدير الشخصي',
      phone: '66444001',
    });
    expect(created.status).toBe(201);
    const client = created.body.data as { id: string };
    const row = await ctx.prisma.client.findUniqueOrThrow({
      where: { id: client.id },
      select: { createdById: true, createdByUserId: true },
    });
    expect(row.createdByUserId).toBe(managerId);
    expect(row.createdById).toBeNull();

    await schedule.sync(null);
    const subject = await ctx.prisma.followUpSubject.findFirstOrThrow({
      where: { clientId: client.id },
      select: { id: true, kind: true, responsibleId: true, responsibleUserId: true },
    });
    expect(subject.kind).toBe('CLIENT');
    expect(subject.responsibleUserId).toBe(managerId);
    expect(subject.responsibleId).toBeNull();

    // The manager saves another note for his OWN client subject.
    await saveBatch(managerToken, randomUUID(), [
      { subjectId: subject.id, note: 'أول مكالمة مع عميلي الشخصي.' },
    ]);
    // Then assigns employee B → the subject moves to B's queue, history kept
    // (the manager stays visible in the history as the author).
    await ctx.prisma.client.update({
      where: { id: client.id },
      data: { responsibleEmployeeId: employeeBProfile },
    });
    await schedule.sync(null);
    const moved = await ctx.prisma.followUpSubject.findFirstOrThrow({
      where: { clientId: client.id },
      select: { id: true, responsibleId: true, responsibleUserId: true },
    });
    expect(moved.id).toBe(subject.id); // never a duplicate subject
    expect(moved.responsibleId).toBe(employeeBProfile);
    expect(moved.responsibleUserId).toBeNull();
    const drawer = await history(employeeBToken, moved.id);
    expect(drawer.status).toBe(200);
    const drawerData = drawer.body.data as {
      entries: Array<{ authorName: string | null }>;
    };
    expect(drawerData.entries).toHaveLength(1);
    expect(drawerData.entries[0]?.authorName).toBe('مدير الإشراف');
    const managerFeed = (await list(managerToken)).body.data as { items: Array<{ id: string }> };
    expect(managerFeed.items.map((item) => item.id)).not.toContain(moved.id);
  });

  it('keeps the manager out of employee subjects and the supervision endpoints employee-proof', async () => {
    const property = await employeeProperty(employeeAToken, '333');
    await schedule.sync(null);
    const subject = await ctx.prisma.followUpSubject.findFirstOrThrow({
      where: { propertyId: property.id },
      select: { id: true, responsibleId: true },
    });
    expect(subject.responsibleId).toBe(employeeAProfile);

    // The manager CANNOT write on an employee subject (404, never 403).
    const writeBefore = await ctx.prisma.followUpEntry.count();
    const write = await saveBatch(managerToken, randomUUID(), [
      { subjectId: subject.id, note: 'متابعة باسم الموظف — ممنوعة.' },
    ]);
    expect(write.status).toBe(404);
    expect(await ctx.prisma.followUpEntry.count()).toBe(writeBefore);

    // Employees can NEVER reach the manager-only overview/reminder routes.
    expect((await overview(employeeAToken)).status).toBe(403);
    const reminderAttempt = await remind(managerToken, '__spoofed__');
    expect([400, 404]).toContain(reminderAttempt.status);
    expect((await remind(employeeAToken, subject.id)).status).toBe(403);
  });

  it('answers the supervision overview with employee-owned subjects, ordered most-overdue first', async () => {
    // One employee property each (owned by A and by B).
    const propertyA = await employeeProperty(employeeAToken, '444');
    await employeeProperty(employeeBToken, '445');
    await schedule.sync(null);

    // Make subject A genuinely overdue; subject B stays upstream.
    const subjectA = await ctx.prisma.followUpSubject.findFirstOrThrow({
      where: { propertyId: propertyA.id },
      select: { id: true },
    });
    await ctx.prisma.followUpSubject.update({
      where: { id: subjectA.id },
      data: {
        nextDueAt: new Date(Date.now() - 50 * HOUR),
        activatedAt: new Date(Date.now() - 122 * HOUR),
      },
    });

    const response = await overview(managerToken);
    expect(response.status).toBe(200);
    const body = response.body.data as {
      items: Array<{
        id: string;
        responsible: { userId: string; name: string };
        lastReminderAt: string | null;
        dueAt: string;
      }>;
      truncated: boolean;
    };
    expect(body.truncated).toBe(false);
    // ONLY employee-owned subjects — manager-owned rows never mix in.
    expect(
      (await ctx.prisma.followUpSubject.count({ where: { responsibleUserId: managerId } })),
    ).toBeGreaterThan(0);
    const managerOwnedIds = (
      await ctx.prisma.followUpSubject.findMany({
        where: { responsibleUserId: { not: null } },
        select: { id: true },
      })
    ).map((row) => row.id);
    const employeeUserIds = new Set([
      employeeAId,
      (
        await ctx.prisma.employeeProfile.findUniqueOrThrow({
          where: { id: employeeBProfile },
          select: { userId: true },
        })
      ).userId,
    ]);
    for (const id of managerOwnedIds) {
      expect(body.items.map((row) => row.id)).not.toContain(id);
    }
    // Each subject carries its responsible EMPLOYEE (a real, loaded name).
    for (const row of body.items) {
      expect(employeeUserIds.has(row.responsible.userId)).toBe(true);
      expect(row.responsible.name.length).toBeGreaterThan(0);
      expect(row.lastReminderAt).toBeNull();
    }
    // Due-ascending order: OVERDUE (most overdue) first, TODAY then UPCOMING.
    const dueValues = body.items.map((row) => row.dueAt);
    expect([...dueValues].sort()).toEqual(dueValues);
  });

  it('sends ONE reminder to the responsible employee without touching the schedule', async () => {
    // An overdue employee-A subject.
    const subject = await ctx.prisma.followUpSubject.findFirstOrThrow({
      where: { responsibleId: employeeAProfile, active: true },
      select: { id: true, nextDueAt: true, cycle: true },
    });
    const overdueAt = new Date(Date.now() - 30 * HOUR);
    await ctx.prisma.followUpSubject.update({
      where: { id: subject.id },
      data: { nextDueAt: overdueAt },
    });
    const cycleBefore = subject.cycle;
    const entriesBefore = await ctx.prisma.followUpEntry.count();

    const sent = await remind(managerToken, subject.id);
    expect([200, 201]).toContain(sent.status);
    const data = sent.body.data as {
      subjectId: string;
      recipientUserId: string;
      recipientName: string;
      sentAt: string;
      replayed: boolean;
      cooldownUntil: string;
    };
    expect(data.subjectId).toBe(subject.id);
    expect(data.recipientUserId).toBe(employeeAId);
    expect(data.recipientName).toBe('موظف الإشراف أ');
    expect(new Date(data.cooldownUntil).getTime()).toBeGreaterThan(Date.now());

    // The notification went through the EXISTING pipeline…
    const rows = await ctx.prisma.notification.findMany({
      where: { userId: employeeAId, type: 'FOLLOWUP_EMPLOYEE_REMINDER' },
      select: { followUpSubjectId: true, body: true, title: true, eventKey: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.followUpSubjectId).toBe(subject.id);
    expect(rows[0]?.title).toBe('تذكير من الإدارة');
    expect(rows[0]?.body).toContain('متأخرة');
    expect(rows[0]?.body).toContain('مدير الإشراف');
    // …and the audit row recorded WHO sent the reminder and when.
    const reminder = await ctx.prisma.followUpReminder.findFirstOrThrow({
      where: { subjectId: subject.id },
      select: { senderUserId: true, recipientUserId: true, eventKey: true },
    });
    expect(reminder.senderUserId).toBe(managerId);
    expect(reminder.recipientUserId).toBe(employeeAId);

    // A reminder is NOT a completed follow-up: due, cycle and history move NOTHING.
    const untouched = await ctx.prisma.followUpSubject.findUniqueOrThrow({
      where: { id: subject.id },
      select: { nextDueAt: true, cycle: true },
    });
    expect(untouched.nextDueAt.getTime()).toBe(overdueAt.getTime());
    expect(untouched.cycle).toBe(cycleBefore);
    expect(await ctx.prisma.followUpEntry.count()).toBe(entriesBefore);

    // Retrigger within the cooldown: deduplicated server-side — no second
    // notification, and the SAME reminder row stays unique.
    const again = await remind(managerToken, subject.id);
    expect([200, 201]).toContain(again.status);
    expect((again.body.data as typeof data).replayed).toBe(true);
    expect(
      (await ctx.prisma.notification.findMany({
        where: { userId: employeeAId, type: 'FOLLOWUP_EMPLOYEE_REMINDER' },
      })).length,
    ).toBe(1);
    expect(await ctx.prisma.followUpReminder.count()).toBe(1);
    // The chronology marker is visible in the supervision feed.
    const feed = (await overview(managerToken)).body.data as {
      items: Array<{ id: string; lastReminderAt: string | null }>;
    };
    const supervised = feed.items.find((row) => row.id === subject.id);
    expect(supervised).toBeDefined();
    expect(supervised?.lastReminderAt).not.toBeNull();
  });

  it('refuses reminders for non-overdue and manager-owned subjects', async () => {
    // UPCOMING employee subject: the reminder is meaningless before it is due.
    const propertyB = await employeeProperty(employeeBToken, '555');
    await schedule.sync(null);
    const upcoming = await ctx.prisma.followUpSubject.findFirstOrThrow({
      where: { propertyId: propertyB.id },
      select: { id: true, nextDueAt: true },
    });
    expect(upcoming.nextDueAt.getTime()).toBeGreaterThan(Date.now());
    const refused = await remind(managerToken, upcoming.id);
    expect(refused.status).toBe(400);
    expect(
      await ctx.prisma.followUpReminder.count({ where: { subjectId: upcoming.id } }),
    ).toBe(0);

    // A MANAGER-owned subject has no employee to remind → 404.
    const mine = (await list(managerToken)).body.data as { items: Array<{ id: string }> };
    const own = mine.items[0];
    if (own) {
      const selfRemind = await remind(managerToken, own.id);
      expect(selfRemind.status).toBe(404);
    }
  });
});
