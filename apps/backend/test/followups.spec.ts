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
import { FollowUpSchedulerService } from '../src/followups/followups-scheduler.service';
import { ensureEmployeeProfile } from '../src/clients/client-policy';

jest.setTimeout(180000);

const HOUR = 3_600_000;
const image = [{ buffer: pngBytes(), filename: 'photo.png' }];

let propertySeq = 0;
const propertyPayload = () => ({
  listingType: 'SALE',
  governorate: 'الفروانية',
  district: 'غرناطة',
  block: '3',
  plotNumber: String(900000 + ++propertySeq),
  sizeSqm: '400.00',
  askingPrice: '250000.00',
  negotiable: true,
  description: 'بيت مستقل للبيع',
  floors: [{ type: 'GROUND', details: 'صالة' }],
  newContact: { type: 'BROKER', name: 'وسيط متابعة', phone: '66001001' },
});

/**
 * The employee follow-ups feature (tasks §3–§8) against the ISOLATED test
 * database: subject materialization, employee scoping (IDOR), the atomic
 * multi-subject batch save, deactivation on terminal status and the
 * exactly-once-per-cycle late notifications.
 */
describeWithDatabase('Employee follow-ups', () => {
  let ctx: TestContext;
  let managerToken: string;
  let employeeAToken: string;
  let employeeAId: string; // User id of employee A
  let employeeAProfile: string; // EmployeeProfile id of employee A
  let employeeBProfile: string;
  let employeeBToken: string;
  let schedule: FollowUpsService;
  let scheduler: FollowUpSchedulerService;
  const api = () => request(ctx.app.getHttpServer());

  const createApprovedPropertyFor = async (token: string) => {
    const created = await postProperty(ctx.app, token, propertyPayload(), image);
    expect(created.status).toBe(201);
    const property = created.body.data as {
      id: string;
      reference: string;
      version: number;
    };
    const approved = await api()
      .post(`/properties/${property.id}/approve`)
      .set(auth(managerToken))
      .send({});
    expect([200, 201]).toContain(approved.status);
    return property;
  };

  const createApprovedPropertyForA = () => createApprovedPropertyFor(employeeAToken);

  const list = (token: string) =>
    api().get('/follow-ups').set(auth(token));

  const history = (token: string, id: string) =>
    api().get(`/follow-ups/${id}/history`).set(auth(token));

  const saveBatch = (
    token: string,
    batchId: string,
    items: Array<{ subjectId: string; note: string }>,
  ) => api().post('/follow-ups/batch').set(auth(token)).send({ batchId, items });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'manager@followups.local',
      name: 'مدير المتابعات',
      role: Role.MANAGER,
    });
    const employeeA = await createUser(ctx.prisma, {
      email: 'employee-a@followups.local',
      name: 'الموظف أ',
      role: Role.EMPLOYEE,
    });
    const employeeB = await createUser(ctx.prisma, {
      email: 'employee-b@followups.local',
      name: 'الموظف ب',
      role: Role.EMPLOYEE,
    });
    managerToken = await login(ctx.app, manager.email);
    employeeAToken = await login(ctx.app, employeeA.email);
    employeeBToken = await login(ctx.app, employeeB.email);
    employeeAId = employeeA.id;
    employeeAProfile = await ensureEmployeeProfile(ctx.prisma, employeeA.id);
    employeeBProfile = await ensureEmployeeProfile(ctx.prisma, employeeB.id);
    schedule = ctx.app.get(FollowUpsService);
    scheduler = ctx.app.get(FollowUpSchedulerService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('creates NO subject while the property is still pending approval', async () => {
    const pending = await postProperty(ctx.app, employeeAToken, propertyPayload(), image);
    expect(pending.status).toBe(201);
    await schedule.sync(null);
    const subjects = await ctx.prisma.followUpSubject.findMany({
      where: { propertyId: (pending.body.data as { id: string }).id },
    });
    expect(subjects).toHaveLength(0);
  });

  it('materializes exactly ONE subject per approved property (idempotent)', async () => {
    const property = await createApprovedPropertyForA();
    await schedule.sync(null);
    await schedule.sync(null); // repeated approval/reload/job converge on ONE row
    const rows = await ctx.prisma.followUpSubject.findMany({
      where: { propertyId: property.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetKey).toBe(`PROPERTY_OWNER:${property.id}`);
    expect(rows[0]?.active).toBe(true);
    // No look-ahead: the first due date is AHEAD of "now" by the interval.
    expect(rows[0]?.nextDueAt.getTime()).toBeGreaterThan(Date.now() + 70 * HOUR);
    // The sync re-resolves responsibility from the canonical enterer.
    expect(rows[0]?.responsibleId).toBe(employeeAProfile);
  });

  it('separates ONE person into INDEPENDENT subjects (owner request + legacy client)', async () => {
    // Structured client: TWO approved request types → TWO request subjects —
    // the WHOLE client record is NOT one subject (§3).
    const structured = await ctx.prisma.client.create({
      data: {
        name: 'أحمد محمد',
        phone: '66001111',
        notes: 'ملاحظات قديمة لا تُفسَّر أبدًا كأنواع طلبات',
        responsibleEmployeeId: employeeAProfile,
        createdById: employeeAProfile,
        requestData: JSON.stringify({
          version: 1,
          types: ['BUYER', 'RENTER'],
          requests: {},
        }),
      },
    });
    // Legacy client: notes ONLY (no document, no interests) → ONE client-level
    // subject so old rows keep working WITHOUT fabricated structure.
    const legacy = await ctx.prisma.client.create({
      data: {
        name: 'فاطمة علي',
        phone: '66002222',
        notes: 'عميلة قديمة تبحث عن شقة في حولي (نص حر)',
        responsibleEmployeeId: employeeAProfile,
        createdById: employeeAProfile,
      },
    });
    // An inquiry on the approved property of A (an existing program property).
    const interest = await ctx.prisma.clientPropertyInterest.create({
      data: {
        clientId: structured.id,
        propertyId: (
          await ctx.prisma.property.findFirstOrThrow({
            where: { createdByUserId: employeeAId, status: 'AVAILABLE' },
            select: { id: true },
          })
        ).id,
        reason: 'استفسار هاتفي',
      },
    });
    await schedule.sync(null);
    const types = await ctx.prisma.followUpSubject.findMany({
      where: { clientId: structured.id },
      select: { targetKey: true, kind: true },
    });
    expect(new Set(types.map((row) => row.targetKey))).toEqual(
      new Set([
        `CLIENT_REQUEST:${structured.id}:BUYER`,
        `CLIENT_REQUEST:${structured.id}:RENTER`,
        `INQUIRY:${interest.id}`,
      ]),
    );
    const legacyRows = await ctx.prisma.followUpSubject.findMany({
      where: { clientId: legacy.id },
      select: { kind: true },
    });
    expect(legacyRows.map((row) => row.kind)).toEqual(['CLIENT']);
  });

  it('scopes the list to the responsible employee and shows the due buckets', async () => {
    const mine = await list(employeeAToken);
    expect(mine.status).toBe(200);
    const body = mine.body.data as {
      items: Array<{ id: string; label: string; tabs: string[]; bucket: string }>;
      truncated: boolean;
    };
    expect(body.truncated).toBe(false);
    expect(body.items.length).toBeGreaterThan(0);
    // Every returned subject belongs to A (multi-subject card view comes from
    // the page). The «الكل» ordering puts the OLDEST due date first.
    const rows = await ctx.prisma.followUpSubject.findMany({
      where: { responsibleId: { not: employeeAProfile } },
      select: { id: true },
    });
    for (const foreign of rows) expect(body.items.map((i) => i.id)).not.toContain(foreign.id);
    const ownerSubject = body.items.find((item) => item.label.startsWith('مالك العقار'));
    expect(ownerSubject).toBeDefined();
    expect(ownerSubject?.tabs).toContain('sellers'); // SALE listing owner
  });

  it('answers 404 (never 403) for foreign ids and FORGED batch payloads', async () => {
    // A genuine subject of ANOTHER employee (employee B), not a fiction.
    const foreignProperty = await createApprovedPropertyFor(employeeBToken);
    await schedule.sync(null);
    const foreign = await ctx.prisma.followUpSubject.findFirstOrThrow({
      where: { propertyId: foreignProperty.id, responsibleId: employeeBProfile },
      select: { id: true },
    });
    expect((await history(employeeAToken, foreign.id)).status).toBe(404);
    const before = await ctx.prisma.followUpEntry.count();
    const forged = await saveBatch(employeeAToken, randomUUID(), [
      { subjectId: foreign.id, note: 'اختراق المحابسة' },
    ]);
    expect(forged.status).toBe(404);
    expect(await ctx.prisma.followUpEntry.count()).toBe(before);
  });

  it('saves ONE conversation atomically with per-subject notes and due resets', async () => {
    const feed = (await list(employeeAToken)).body.data as {
      items: Array<{
        id: string;
        label: string;
        entryCount: number;
        dueAt: string;
        lastSavedAt: string | null;
      }>;
    };
    // Pick one OWNER subject and one CLIENT-kinded subject of the SAME
    // employee to simulate one phone call covering several subjects (§5).
    const first = feed.items.find((item) => item.label.startsWith('مالك العقار'));
    const second = feed.items.find(
      (item) => item.id !== first?.id && !item.label.startsWith('مالك العقار'),
    );
    if (!first || !second) throw new Error('expected a property subject and a client subject');
    const beforeB = await ctx.prisma.followUpEntry.count({ where: { subjectId: second.id } });
    const firstPrevDue = await ctx.prisma.followUpSubject.findUniqueOrThrow({
      where: { id: first.id },
      select: { nextDueAt: true, cycle: true },
    });

    // Whitespace-only notes are refused, and NOTHING is written for the batch.
    const blank = await saveBatch(employeeAToken, randomUUID(), [
      { subjectId: first.id, note: '   ' },
      { subjectId: second.id, note: 'ملاحظة' },
    ]);
    expect(blank.status).toBe(400);

    const requestTime = Date.now();
    const batchId = randomUUID();
    const saved = await saveBatch(employeeAToken, batchId, [
      { subjectId: first.id, note: 'المالك أكد أن العقار ما زال متاحًا بالسعر الحالي.' },
      { subjectId: second.id, note: 'العميل ما زال يبحث عن شقة في حولي.' },
    ]);
    expect(saved.status).toBe(201);
    const result = saved.body.data as {
      replayed: boolean;
      savedCount: number;
      saved: Array<{ subjectId: string; entryId: string; nextDueAt: string }>;
    };
    expect(result.replayed).toBe(false);
    expect(result.savedCount).toBe(2);
    expect(new Set(result.saved.map((row) => row.subjectId))).toEqual(
      new Set([first.id, second.id]),
    );

    // Each subject keeps its OWN history; nothing was merged.
    for (const savedRow of result.saved) {
      const drawer = await history(employeeAToken, savedRow.subjectId);
      expect(drawer.status).toBe(200);
      const data = drawer.body.data as { entries: Array<{ note: string; batchId: string | null }> };
      const batchEntries = data.entries.filter((entry) => entry.batchId === batchId);
      expect(batchEntries).toHaveLength(1); // exactly its OWN note, once
    }
    // The property subject follows the 72h property interval; the OTHER
    // subject follows its own 120h interval — both reset independently, and
    // only the two SAVED subjects moved.
    const firstAfter = await ctx.prisma.followUpSubject.findUniqueOrThrow({
      where: { id: first.id },
      select: { nextDueAt: true, cycle: true, lastSavedAt: true },
    });
    expect(firstAfter.cycle).toBe(firstPrevDue.cycle + 1);
    expect(firstAfter.nextDueAt.getTime()).toBeGreaterThan(
      requestTime + 71 * HOUR,
    );
    expect(firstAfter.nextDueAt.getTime()).toBeLessThan(requestTime + 73 * HOUR);
    // The second subject's next due follows ITS kind's policy (checked to be a
    // fresh future instant) and its history grew by exactly ONE entry.
    const secondAfter = await ctx.prisma.followUpSubject.findUniqueOrThrow({
      where: { id: second.id },
      select: { nextDueAt: true },
    });
    expect(secondAfter.nextDueAt.getTime()).toBeGreaterThan(requestTime + 119 * HOUR);
    expect(await ctx.prisma.followUpEntry.count({ where: { subjectId: second.id } })).toBe(
      beforeB + 1,
    );

    // Idempotent replay: the SAME batchId resolves to the committed rows —
    // never a second history entry, never a schedule churn.
    const replay = await saveBatch(employeeAToken, batchId, [
      { subjectId: first.id, note: 'المالك أكد أن العقار ما زال متاحًا بالسعر الحالي.' },
      { subjectId: second.id, note: 'العميل ما زال يبحث عن شقة في حولي.' },
    ]);
    expect(replay.status).toBe(201);
    expect((replay.body.data as typeof result).replayed).toBe(true);
    expect((replay.body.data as typeof result).savedCount).toBe(2);
    expect(firstAfter.nextDueAt.getTime()).toBe(
      (await ctx.prisma.followUpSubject.findUniqueOrThrow({
        where: { id: first.id },
        select: { nextDueAt: true },
      })).nextDueAt.getTime(),
    );
    // Duplicate subject ids INSIDE one batch are refused outright.
    const duplicated = await saveBatch(employeeAToken, randomUUID(), [
      { subjectId: first.id, note: 'أ' },
      { subjectId: first.id, note: 'ب' },
    ]);
    expect(duplicated.status).toBe(400);
  });

  it('warns the employee once per cycle and never spams on re-runs', async () => {
    const subject = await ctx.prisma.followUpSubject.findFirstOrThrow({
      where: { targetKey: { startsWith: 'PROPERTY_OWNER:' }, responsibleId: employeeAProfile },
      select: { id: true, cycle: true },
    });
    const lateAt = new Date(Date.now() - 100 * HOUR); // +1 day past due (96h warn)
    await ctx.prisma.followUpSubject.update({
      where: { id: subject.id },
      data: { lastSavedAt: lateAt, activatedAt: lateAt },
    });
    await scheduler.runOnce();
    const employeeWarned = await ctx.prisma.notification.findMany({
      where: { userId: employeeAId, type: 'FOLLOWUP_EMPLOYEE_LATE' },
    });
    expect(employeeWarned).toHaveLength(1);
    expect(employeeWarned[0]?.followUpSubjectId).toBe(subject.id);
    await scheduler.runOnce(); // retry/restart — a duplicate can never occur
    expect(
      (await ctx.prisma.notification.findMany({
        where: { userId: employeeAId, type: 'FOLLOWUP_EMPLOYEE_LATE' },
      })).length,
    ).toBe(1);

    // Crossing the manager threshold escalates ONCE per cycle to every manager.
    // Backdate BOTH anchors (the escalation clock starts at the LATER one).
    await ctx.prisma.followUpSubject.update({
      where: { id: subject.id },
      data: {
        lastSavedAt: new Date(Date.now() - 130 * HOUR),
        activatedAt: new Date(Date.now() - 130 * HOUR),
      },
    });
    await scheduler.runOnce();
    expect(
      (await ctx.prisma.notification.findMany({
        where: { type: 'FOLLOWUP_MANAGER_ESCALATION', followUpSubjectId: subject.id },
      })).length,
    ).toBeGreaterThanOrEqual(1);
    // The employee is NOT warned a second time in the same cycle.
    expect(
      (await ctx.prisma.notification.findMany({
        where: { userId: employeeAId, type: 'FOLLOWUP_EMPLOYEE_LATE' },
      })).length,
    ).toBe(1);

    // A genuinely NEW follow-up cycle re-arms the employee warning.
    const batchId = randomUUID();
    const cycleSave = await saveBatch(employeeAToken, batchId, [
      { subjectId: subject.id, note: 'متابعة جديدة تعيد تفعيل دورة التنبيهات.' },
    ]);
    expect([200, 201]).toContain(cycleSave.status);
    const fresh = await ctx.prisma.followUpSubject.findUniqueOrThrow({
      where: { id: subject.id },
      select: { cycle: true },
    });
    await ctx.prisma.followUpSubject.update({
      where: { id: subject.id },
      data: { lastSavedAt: new Date(Date.now() - 101 * HOUR) },
    });
    await scheduler.runOnce();
    const rearmed = await ctx.prisma.notification.findMany({
      where: { userId: employeeAId, type: 'FOLLOWUP_EMPLOYEE_LATE' },
    });
    expect(rearmed).toHaveLength(2);
    expect(await ctx.prisma.followUpSubject.findUniqueOrThrow({ where: { id: subject.id }, select: { employeeWarnedCycle: true } })).toMatchObject({
      employeeWarnedCycle: fresh.cycle,
    });
  });

  it('deactivates the subject of a TERMINAL property and keeps the history', async () => {
    const property = await createApprovedPropertyForA();
    await schedule.sync(null);
    const subject = await ctx.prisma.followUpSubject.findFirstOrThrow({
      where: { propertyId: property.id },
      select: { id: true },
    });
    const entryBefore = await saveBatch(employeeAToken, randomUUID(), [
      { subjectId: subject.id, note: 'آخر متابعة قبل البيع.' },
    ]);
    expect([200, 201]).toContain(entryBefore.status);
    await ctx.prisma.property.update({
      where: { id: property.id },
      data: { status: 'SOLD' },
    });
    await schedule.sync(null);
    await scheduler.runOnce();
    const row = await ctx.prisma.followUpSubject.findUniqueOrThrow({
      where: { id: subject.id },
      select: { active: true, deactivatedAt: true },
    });
    expect(row.active).toBe(false);
    expect(row.deactivatedAt).not.toBeNull();
    // The permanent record is append-only and is never touched.
    expect(
      await ctx.prisma.followUpEntry.count({ where: { subjectId: subject.id } }),
    ).toBe(1);
  });
});
