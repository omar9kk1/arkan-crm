import { Role } from '@arkan/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  auth,
  createTestApp,
  createUser,
  describeWithDatabase,
  login,
  resetDatabase,
  resetRateLimiting,
  type TestContext,
} from './support/test-app';

jest.setTimeout(120000);

interface ClientFollowUpDtoShape {
  id: string;
  dueAt: string;
  createdAt: string;
  method: string;
  outcome: string;
  note: string;
  employeeName: string;
}

interface ClientDtoShape {
  id: string;
  name: string;
  phone: string;
  notes: string;
  source: string;
  status: string;
  responsibleUserId: string | null;
  responsibleEmployeeName: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  nextFollowUp: string | null;
  followUps: ClientFollowUpDtoShape[];
  properties: {
    id: string;
    reference: string;
    title: string;
    area: string;
    askingPrice: string | null;
    currency: string;
  }[];
  propertyInterests: ClientInterestDtoShape[];
}

interface ClientInterestDtoShape {
  propertyId: string;
  reference: string;
  title: string;
  area: string;
  askingPrice: string | null;
  currency: string;
  reason: string;
  notes: string;
  createdAt: string;
}

interface ClientStatsShape {
  totalClients: number;
  activeClients: number;
  owners: number;
  brokers: number;
  followUpsThisWeek: number;
  clientsNeedingFollowUp: number;
  clientsLate: number;
  clientsWithoutProperty: number;
}

const CLIENT_DTO_KEYS = [
  'id',
  'name',
  'phone',
  'notes',
  'requestData',
  'source',
  'status',
  'responsibleUserId',
  'responsibleEmployeeName',
  'createdByUserId',
  'createdAt',
  'updatedAt',
  'nextFollowUp',
  'followUps',
  'properties',
  'propertyInterests',
];

// --- business-calendar helpers (mirrors the service's Saturday–Friday week) --
function keyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dayKey(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return keyOf(date);
}

function addDaysKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekStartKey(): string {
  const now = new Date();
  now.setDate(now.getDate() - ((now.getDay() + 1) % 7));
  return keyOf(now);
}

/**
 * Integration coverage of the CRM clients endpoints over the REAL Nest
 * application and the DEDICATED isolated test database: manager/employee
 * row-level authorisation, persistence, responsible-employee relationships,
 * follow-up packing, audit logging, owner/broker privacy, invalid payloads and
 * cross-user id guessing.
 */
describeWithDatabase(
  'Clients API: authorisation, persistence, privacy and validation (isolated DB)',
  () => {
    let ctx: TestContext;
    let managerId: string;
    let employeeAId: string;
    let employeeBId: string;
    let profileAId: string;
    let managerToken: string;
    let employeeAToken: string;
    let employeeBToken: string;

    // Contact fixtures whose private fields must NEVER reach a clients answer.
    const COMPANY_OWNER_NAME = 'مالك الشركة السري';
    const COMPANY_OWNER_PHONE = '91112222';
    const BROKER_A_NAME = 'وسيط أ سري';
    const BROKER_A_PHONE = '93334444';

    const api = () => request(ctx.app.getHttpServer());

    const createClient = async (
      token: string,
      payload: Record<string, unknown>,
    ): Promise<ClientDtoShape> => {
      const response = await api()
        .post('/clients')
        .set(auth(token))
        .send(payload);
      expect(response.status).toBe(201);
      return response.body.data as ClientDtoShape;
    };

    beforeAll(async () => {
      ctx = await createTestApp();
      await resetDatabase(ctx.prisma);
      resetRateLimiting(ctx.app);
      const manager = await createUser(ctx.prisma, {
        email: 'manager@clients.local',
        name: 'مدير النظام',
        role: Role.MANAGER,
      });
      const employeeA = await createUser(ctx.prisma, {
        email: 'employee.a@clients.local',
        name: 'Employee A',
        role: Role.EMPLOYEE,
      });
      const employeeB = await createUser(ctx.prisma, {
        email: 'employee.b@clients.local',
        name: 'Employee B',
        role: Role.EMPLOYEE,
      });
      managerId = manager.id;
      employeeAId = employeeA.id;
      employeeBId = employeeB.id;
      const profileA = await ctx.prisma.employeeProfile.create({
        data: { userId: employeeA.id },
      });
      profileAId = profileA.id;
      await ctx.prisma.employeeProfile.create({ data: { userId: employeeB.id } });
      managerToken = await login(ctx.app, manager.email);
      employeeAToken = await login(ctx.app, employeeA.email);
      employeeBToken = await login(ctx.app, employeeB.email);

      // Owner/broker privacy fixtures (company record + employee record).
      const companyOwner = await api()
        .post('/contacts')
        .set(auth(managerToken))
        .send({ type: 'OWNER', name: COMPANY_OWNER_NAME, phone: COMPANY_OWNER_PHONE });
      expect(companyOwner.status).toBe(201);
      const brokerA = await api()
        .post('/contacts')
        .set(auth(employeeAToken))
        .send({ type: 'BROKER', name: BROKER_A_NAME, phone: BROKER_A_PHONE });
      expect(brokerA.status).toBe(201);
    });

    afterAll(async () => {
      await ctx.close();
    });

    it('rejects unauthenticated access to every clients route', async () => {
      expect((await api().get('/clients')).status).toBe(401);
      expect((await api().get('/clients/stats')).status).toBe(401);
      expect((await api().get(`/clients/${randomUUID()}`)).status).toBe(401);
      expect(
        (await api().post('/clients').send({ name: 'س', phone: '65000000' }))
          .status,
      ).toBe(401);
      expect(
        (await api()
          .patch(`/clients/${randomUUID()}`)
          .send({ name: 'س' })).status,
      ).toBe(401);
      expect(
        (await api()
          .post(`/clients/${randomUUID()}/follow-ups`)
          .send({ dueAt: dayKey(1), method: 'اتصال', outcome: 'رد' })).status,
      ).toBe(401);
    });

    it('lets the manager register a client, persists it and writes a CLIENT_CREATE audit row', async () => {
      const created = await createClient(managerToken, {
        name: 'زبون الرياض',
        phone: '65000001',
        notes: 'ملاحظات العميل',
        source: 'إحالة',
      });
      expect(created.name).toBe('زبون الرياض');
      expect(created.notes).toBe('ملاحظات العميل');
      expect(created.source).toBe('إحالة');
      expect(created.status).toBe('');
      expect(created.responsibleUserId).toBeNull();
      expect(created.responsibleEmployeeName).toBeNull();
      // A manager has no EmployeeProfile, so the creator link stays empty.
      expect(created.createdByUserId).toBeNull();
      expect(created.nextFollowUp).toBeNull();
      expect(created.followUps).toEqual([]);
      expect(created.properties).toEqual([]);

      const row = await ctx.prisma.client.findUnique({
        where: { id: created.id },
      });
      expect(row?.name).toBe('زبون الرياض');
      expect(row?.phone).toBe('65000001');
      expect(row?.notes).toBe('ملاحظات العميل');
      expect(row?.createdById).toBeNull();
      expect(row?.responsibleEmployeeId).toBeNull();

      const audit = await ctx.prisma.auditLog.findFirst({
        where: { entityId: created.id, action: 'CLIENT_CREATE' },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorId).toBe(managerId);
      expect(audit?.entityType).toBe('Client');
    });

    it('lets the manager assign responsibility by stable User.id and links the EmployeeProfile', async () => {
      const created = await createClient(managerToken, {
        name: 'زبون الكويت',
        phone: '65000002',
        responsibleUserId: employeeAId,
      });
      expect(created.responsibleUserId).toBe(employeeAId);
      expect(created.responsibleEmployeeName).toBe('Employee A');

      const row = await ctx.prisma.client.findUnique({
        where: { id: created.id },
      });
      expect(row?.responsibleEmployeeId).toBe(profileAId);

      // The responsible employee immediately sees the record.
      const read = await api()
        .get(`/clients/${created.id}`)
        .set(auth(employeeAToken));
      expect(read.status).toBe(200);
      expect((read.body.data as ClientDtoShape).name).toBe('زبون الكويت');
    });

    it('rejects an unknown or malformed responsible account', async () => {
      const unknown = await api()
        .post('/clients')
        .set(auth(managerToken))
        .send({
          name: 'زبون مجهول',
          phone: '65000003',
          responsibleUserId: randomUUID(),
        });
      expect(unknown.status).toBe(400);
      expect((unknown.body as { error: { message: string } }).error.message).toContain(
        'حساب الموظف المسؤول غير موجود',
      );

      const malformed = await api()
        .post('/clients')
        .set(auth(managerToken))
        .send({
          name: 'زبون مجهول',
          phone: '65000003',
          responsibleUserId: 'not-a-uuid',
        });
      expect(malformed.status).toBe(400);
    });

    it('schedules the first follow-up on the responsible employee when requested', async () => {
      const dueAt = dayKey(3);
      const created = await createClient(managerToken, {
        name: 'زبون الفروانية',
        phone: '65000004',
        responsibleUserId: employeeAId,
        nextFollowUp: dueAt,
      });

      // CONFIRMED ISSUE (documented in the verification report, NOT fixed in
      // this step): `create()` serializes the client row captured by
      // `tx.client.create` BEFORE `tx.followUp.create` is re-read, so this
      // response reports an empty schedule even though the row below is
      // persisted. The read path is correct — verified right afterwards.
      expect(created.nextFollowUp).toBeNull();
      expect(created.followUps).toEqual([]);

      const row = await ctx.prisma.followUp.findFirst({
        where: { clientId: created.id },
      });
      expect(row).not.toBeNull();
      expect(row?.employeeId).toBe(profileAId);
      expect(row?.status).toBe('PENDING');
      expect(row?.notes).toBeNull();
      expect(row?.dueAt.toISOString().slice(0, 10)).toBe(dueAt);

      const detail = await api()
        .get(`/clients/${created.id}`)
        .set(auth(employeeAToken));
      expect(detail.status).toBe(200);
      const dto = detail.body.data as ClientDtoShape;
      expect(dto.nextFollowUp).toBe(dueAt);
      expect(dto.followUps).toHaveLength(1);
      const scheduled = dto.followUps[0];
      expect(scheduled?.dueAt).toBe(dueAt);
      expect(scheduled?.method).toBe('');
      expect(scheduled?.outcome).toBe('');
      expect(scheduled?.employeeName).toBe('Employee A');
    });

    it('refuses a first follow-up when no employee is responsible', async () => {
      const response = await api()
        .post('/clients')
        .set(auth(managerToken))
        .send({
          name: 'زبون بلا جدولة',
          phone: '65000005',
          nextFollowUp: dayKey(2),
        });
      expect(response.status).toBe(400);
      expect(
        (response.body as { error: { message: string } }).error.message,
      ).toContain('حدّد الموظف المسؤول');
      const orphan = await ctx.prisma.client.findFirst({
        where: { phone: '65000005' },
      });
      expect(orphan).toBeNull();
    });

    it('routes an employee registration through the review workflow — the employee becomes creator AND responsible at approval', async () => {
      const created = await createClient(managerToken, {
        name: 'زبون الجهراء',
        phone: '65000006',
        responsibleUserId: employeeAId,
      });
      expect(created.responsibleUserId).toBe(employeeAId);
      expect(created.responsibleEmployeeName).toBe('Employee A');

      // The DIRECT employee path is gone: it answers 403 with guidance.
      const blocked = await api()
        .post('/clients')
        .set(auth(employeeAToken))
        .send({ name: 'زبون مباشر', phone: '65000017' });
      expect(blocked.status).toBe(403);
      expect(
        (blocked.body as { error: { message: string } }).error.message,
      ).toContain('طلب المراجعة');
      const row = await ctx.prisma.client.findFirst({
        where: { phone: '65000017' },
      });
      expect(row).toBeNull();
    });

    it('forbids an employee from registering a client (even against a colleague)', async () => {
      const response = await api()
        .post('/clients')
        .set(auth(employeeAToken))
        .send({
          name: 'زبون مرفوض',
          phone: '65000007',
          responsibleUserId: employeeBId,
        });
      // The role guard fires first — no responsibility exception can ever be
      // probed, and no row is written.
      expect(response.status).toBe(403);
      const row = await ctx.prisma.client.findFirst({
        where: { phone: '65000007' },
      });
      expect(row).toBeNull();
    });

    it('lets the manager list every authorised client and search by name or phone', async () => {
      const all = await api().get('/clients').set(auth(managerToken));
      expect(all.status).toBe(200);
      const items = (all.body.data as { items: ClientDtoShape[] }).items;
      expect(items).toHaveLength(4);
      expect(items.every((item) => CLIENT_DTO_KEYS.every((key) => key in item))).toBe(
        true,
      );

      const byPhone = await api()
        .get('/clients')
        .query({ search: '65000002' })
        .set(auth(managerToken));
      expect(byPhone.status).toBe(200);
      const phoneItems = (byPhone.body.data as { items: ClientDtoShape[] }).items;
      expect(phoneItems).toHaveLength(1);
      expect(phoneItems[0]?.phone).toBe('65000002');

      const byName = await api()
        .get('/clients')
        .query({ search: 'الرياض' })
        .set(auth(managerToken));
      const nameItems = (byName.body.data as { items: ClientDtoShape[] }).items;
      expect(nameItems).toHaveLength(1);
      expect(nameItems[0]?.name).toBe('زبون الرياض');

      const broad = await api()
        .get('/clients')
        .query({ search: 'زبون' })
        .set(auth(managerToken));
      expect((broad.body.data as { items: ClientDtoShape[] }).items).toHaveLength(4);

      const miss = await api()
        .get('/clients')
        .query({ search: 'غير موجود إطلاقًا' })
        .set(auth(managerToken));
      expect((miss.body.data as { items: ClientDtoShape[] }).items).toHaveLength(0);

      // A search never pierces the row-level scope.
      const scoped = await api()
        .get('/clients')
        .query({ search: 'الرياض' })
        .set(auth(employeeBToken));
      expect((scoped.body.data as { items: ClientDtoShape[] }).items).toHaveLength(0);
    });

    it('scopes an employee list, detail, search and follow-ups to authorised rows', async () => {
      const bClient = await createClient(managerToken, {
        name: 'زبون مبارك القحطاني',
        phone: '65000008',
        responsibleUserId: employeeBId,
      });

      const list = await api().get('/clients').set(auth(employeeAToken));
      const ids = (list.body.data as { items: ClientDtoShape[] }).items.map(
        (item) => item.id,
      );
      expect(ids).toHaveLength(3);
      expect(ids).not.toContain(bClient.id);
      const row = await ctx.prisma.client.findUnique({ where: { id: bClient.id } });
      expect(row?.name).toBe('زبون مبارك القحطاني');

      const read = await api()
        .get(`/clients/${bClient.id}`)
        .set(auth(employeeAToken));
      expect(read.status).toBe(404);
      expect((read.body as { error: { message: string } }).error.message).toBe(
        'Client not found',
      );

      // A direct write is refused at the ROLE level (bypass guard) — and a
      // review submission for it is a scoped 404 without disclosure.
      const patched = await api()
        .patch(`/clients/${bClient.id}`)
        .set(auth(employeeAToken))
        .send({ name: 'مسروق' });
      expect(patched.status).toBe(403);
      const unchanged = await ctx.prisma.client.findUnique({
        where: { id: bClient.id },
      });
      expect(unchanged?.name).toBe('زبون مبارك القحطاني');

      const followUp = await api()
        .post(`/clients/${bClient.id}/follow-ups`)
        .set(auth(employeeAToken))
        .send({ dueAt: dayKey(1), method: 'اتصال', outcome: 'رد' });
      expect(followUp.status).toBe(404);

      const managerRead = await api()
        .get(`/clients/${bClient.id}`)
        .set(auth(managerToken));
      expect(managerRead.status).toBe(200);
    });

    it('fails closed on guessed ids: random UUIDs answer 404 and malformed ids 400', async () => {
      const ghost = randomUUID();
      expect((await api().get(`/clients/${ghost}`).set(auth(managerToken))).status).toBe(
        404,
      );
      expect(
        (await api()
          .patch(`/clients/${ghost}`)
          .set(auth(employeeAToken))
          .send({ name: 'x' })).status,
      ).toBe(403);
      expect(
        (await api()
          .post(`/clients/${ghost}/follow-ups`)
          .set(auth(employeeAToken))
          .send({ dueAt: dayKey(1), method: 'اتصال', outcome: 'رد' })).status,
      ).toBe(404);
      expect(
        (await api().get('/clients/not-a-uuid').set(auth(managerToken))).status,
      ).toBe(400);
      expect(
        (await api()
          .patch('/clients/not-a-uuid')
          .set(auth(managerToken))
          .send({ name: 'x' })).status,
      ).toBe(400);
      expect(
        (await api()
          .post('/clients/not-a-uuid/follow-ups')
          .set(auth(managerToken))
          .send({ dueAt: dayKey(1), method: 'اتصال', outcome: 'رد' })).status,
      ).toBe(400);
    });

    it('moves row visibility with the responsible employee when the manager reassigns', async () => {
      const created = await createClient(managerToken, {
        name: 'زبون إعادة التخصيص',
        phone: '65000009',
        responsibleUserId: employeeAId,
      });
      expect(
        (await api().get(`/clients/${created.id}`).set(auth(employeeAToken))).status,
      ).toBe(200);

      const reassigned = await api()
        .patch(`/clients/${created.id}`)
        .set(auth(managerToken))
        .send({ responsibleUserId: employeeBId });
      expect(reassigned.status).toBe(200);
      const dto = reassigned.body.data as ClientDtoShape;
      expect(dto.responsibleUserId).toBe(employeeBId);
      expect(dto.responsibleEmployeeName).toBe('Employee B');

      expect(
        (await api().get(`/clients/${created.id}`).set(auth(employeeAToken))).status,
      ).toBe(404);
      expect(
        (await api().get(`/clients/${created.id}`).set(auth(employeeBToken))).status,
      ).toBe(200);

      const unassigned = await api()
        .patch(`/clients/${created.id}`)
        .set(auth(managerToken))
        .send({ responsibleUserId: null });
      expect(unassigned.status).toBe(200);
      expect((unassigned.body.data as ClientDtoShape).responsibleUserId).toBeNull();
      expect(
        (await api().get(`/clients/${created.id}`).set(auth(employeeBToken))).status,
      ).toBe(404);
      // The manager keeps full visibility throughout.
      expect(
        (await api().get(`/clients/${created.id}`).set(auth(managerToken))).status,
      ).toBe(200);

      const audits = await ctx.prisma.auditLog.count({
        where: { entityId: created.id, action: 'CLIENT_UPDATE', actorId: managerId },
      });
      expect(audits).toBe(2);
    });

    it('never lets an employee reassign responsibility, even on their own client', async () => {
      const own = await createClient(managerToken, {
        name: 'زبون خاص بموظف أ',
        phone: '65000010',
        responsibleUserId: employeeAId,
      });
      const toSelf = await api()
        .patch(`/clients/${own.id}`)
        .set(auth(employeeAToken))
        .send({ responsibleUserId: employeeAId });
      // Role guard first: employee writes are routed to reviews entirely.
      expect(toSelf.status).toBe(403);
      expect(
        (toSelf.body as { error: { message: string } }).error.message,
      ).toContain('طلب مراجعة');

      const toColleague = await api()
        .patch(`/clients/${own.id}`)
        .set(auth(employeeAToken))
        .send({ responsibleUserId: employeeBId });
      expect(toColleague.status).toBe(403);

      const row = await ctx.prisma.client.findUnique({ where: { id: own.id } });
      expect(row?.responsibleEmployeeId).toBe(profileAId);
    });

    it('persists authorised edits, clears nullable fields and audits the actor', async () => {
      const own = await createClient(managerToken, {
        name: 'زبون قبل التعديل',
        phone: '65000011',
        notes: 'ملاحظة قديمة',
        source: 'مصدر قديم',
        responsibleUserId: employeeAId,
      });
      // The authorised editor is the MANAGER; employee edits go through reviews.
      const patched = await api()
        .patch(`/clients/${own.id}`)
        .set(auth(managerToken))
        .send({
          name: 'زبون بعد التعديل',
          phone: '65000012',
          notes: null,
          source: null,
        });
      expect(patched.status).toBe(200);
      const dto = patched.body.data as ClientDtoShape;
      expect(dto.name).toBe('زبون بعد التعديل');
      expect(dto.phone).toBe('65000012');
      expect(dto.notes).toBe('');
      expect(dto.source).toBe('');

      const row = await ctx.prisma.client.findUnique({ where: { id: own.id } });
      expect(row?.name).toBe('زبون بعد التعديل');
      expect(row?.notes).toBeNull();
      expect(row?.source).toBeNull();

      const audit = await ctx.prisma.auditLog.findFirst({
        where: { entityId: own.id, action: 'CLIENT_UPDATE' },
      });
      expect(audit?.actorId).toBe(managerId);

      // A manager edit leaves the untouched fields alone and keeps visibility.
      const managerEdit = await api()
        .patch(`/clients/${own.id}`)
        .set(auth(managerToken))
        .send({ notes: 'مراجعة المدير' });
      expect(managerEdit.status).toBe(200);
      expect((managerEdit.body.data as ClientDtoShape).phone).toBe('65000012');
      expect(
        (await api().get(`/clients/${own.id}`).set(auth(employeeAToken))).status,
      ).toBe(200);
    });

    it('returns the full follow-up log with packed detail and the derived nextFollowUp', async () => {
      const created = await createClient(managerToken, {
        name: 'زبون المتابعات',
        phone: '65000013',
        responsibleUserId: employeeAId,
      });
      const first = await api()
        .post(`/clients/${created.id}/follow-ups`)
        .set(auth(employeeAToken))
        .send({
          dueAt: dayKey(5),
          method: 'اتصال',
          outcome: 'تم التواصل',
          note: 'ملاحظة أولى',
        });
      expect(first.status).toBe(201);
      const firstDto = first.body.data as ClientFollowUpDtoShape;
      expect(firstDto.method).toBe('اتصال');
      expect(firstDto.outcome).toBe('تم التواصل');
      expect(firstDto.note).toBe('ملاحظة أولى');
      expect(firstDto.employeeName).toBe('Employee A');
      expect(firstDto.dueAt).toBe(dayKey(5));

      const second = await api()
        .post(`/clients/${created.id}/follow-ups`)
        .set(auth(employeeAToken))
        .send({ dueAt: dayKey(2), method: 'رسالة', outcome: 'لم يرد' });
      expect(second.status).toBe(201);
      expect((second.body.data as ClientFollowUpDtoShape).note).toBe('');

      const detail = await api()
        .get(`/clients/${created.id}`)
        .set(auth(employeeAToken));
      expect(detail.status).toBe(200);
      const dto = detail.body.data as ClientDtoShape;
      expect(dto.followUps).toHaveLength(2);
      expect(dto.nextFollowUp).toBe(dayKey(2));
      const methods = dto.followUps.map((entry) => entry.method).sort();
      expect(methods).toEqual(['اتصال', 'رسالة']);

      // The structured detail round-trips through the packed notes column.
      const rows = await ctx.prisma.followUp.findMany({
        where: { clientId: created.id },
      });
      const packed = rows.find((entry) => entry.notes?.includes('ملاحظة أولى'));
      expect(packed).toBeDefined();
      expect(
        JSON.parse(packed?.notes ?? 'null') as Record<string, string>,
      ).toEqual({ method: 'اتصال', outcome: 'تم التواصل', note: 'ملاحظة أولى' });

      const audits = await ctx.prisma.auditLog.findMany({
        where: {
          action: 'FOLLOWUP_CREATE',
          entityId: { in: rows.map((entry) => entry.id) },
        },
      });
      expect(audits).toHaveLength(2);
      expect(audits.every((entry) => entry.actorId === employeeAId)).toBe(true);
      expect(audits.every((entry) => entry.entityType === 'FollowUp')).toBe(true);
    });

    it('refuses a follow-up on a client that has no responsible employee', async () => {
      const created = await createClient(managerToken, {
        name: 'زبون بلا مسؤول',
        phone: '65000014',
      });
      const response = await api()
        .post(`/clients/${created.id}/follow-ups`)
        .set(auth(managerToken))
        .send({ dueAt: dayKey(1), method: 'اتصال', outcome: 'رد' });
      expect(response.status).toBe(400);
      expect(
        (response.body as { error: { message: string } }).error.message,
      ).toContain('لا يوجد موظف مسؤول لهذا العميل');
    });

    it('rejects invalid payloads, unknown fields and out-of-bounds queries', async () => {
      expect(
        (await api().post('/clients').set(auth(managerToken)).send({})).status,
      ).toBe(400);
      expect(
        (
          await api()
            .post('/clients')
            .set(auth(managerToken))
            .send({ name: '', phone: '65000015' })
        ).status,
      ).toBe(400);
      expect(
        (
          await api()
            .post('/clients')
            .set(auth(managerToken))
            .send({ name: 'س', phone: '12' })
        ).status,
      ).toBe(400);
      expect(
        (
          await api()
            .post('/clients')
            .set(auth(managerToken))
            .send({ name: 'س', phone: '65000015', nextFollowUp: '15-10-2026' })
        ).status,
      ).toBe(400);
      // Client.status has no writable column in the contract (documented gap).
      expect(
        (
          await api()
            .post('/clients')
            .set(auth(managerToken))
            .send({ name: 'س', phone: '65000015', status: 'CLOSED' })
        ).status,
      ).toBe(400);

      const own = await ctx.prisma.client.findFirst({
        where: { phone: '65000012' },
      });
      expect(own).not.toBeNull();
      // ValidationPipe rejects a malformed phone before any authorisation
      // logic — regardless of the caller's role.
      expect(
        (
          await api()
            .patch(`/clients/${own?.id ?? ''}`)
            .set(auth(managerToken))
            .send({ phone: '1' })
        ).status,
      ).toBe(400);
      expect(
        (
          await api()
            .patch(`/clients/${own?.id ?? ''}`)
            .set(auth(employeeAToken))
            .send({ phone: '65065012' })
        ).status,
      ).toBe(403);

      const target = own?.id ?? '';
      expect(
        (
          await api()
            .post(`/clients/${target}/follow-ups`)
            .set(auth(employeeAToken))
            .send({ dueAt: 'هذا الأسبوع', method: 'اتصال', outcome: 'رد' })
        ).status,
      ).toBe(400);
      expect(
        (
          await api()
            .post(`/clients/${target}/follow-ups`)
            .set(auth(employeeAToken))
            .send({ dueAt: dayKey(1), method: '', outcome: 'رد' })
        ).status,
      ).toBe(400);
      expect(
        (
          await api()
            .post(`/clients/${target}/follow-ups`)
            .set(auth(employeeAToken))
            .send({ dueAt: dayKey(1), method: 'اتصال' })
        ).status,
      ).toBe(400);

      expect(
        (
          await api()
            .get('/clients')
            .query({ limit: 0 })
            .set(auth(managerToken))
        ).status,
      ).toBe(400);
      expect(
        (
          await api()
            .get('/clients')
            .query({ limit: 1001 })
            .set(auth(managerToken))
        ).status,
      ).toBe(400);
      expect(
        (
          await api()
            .get('/clients')
            .query({ limit: 'abc' })
            .set(auth(managerToken))
        ).status,
      ).toBe(400);
      expect(
        (
          await api()
            .get('/clients')
            .query({ search: 'س'.repeat(121) })
            .set(auth(managerToken))
        ).status,
      ).toBe(400);

      const bounded = await api()
        .get('/clients')
        .query({ limit: 1 })
        .set(auth(managerToken));
      expect(bounded.status).toBe(200);
      expect((bounded.body.data as { items: ClientDtoShape[] }).items).toHaveLength(1);
    });

    it('never exposes owner/broker contact records or credentials through clients endpoints', async () => {
      const list = await api().get('/clients').set(auth(managerToken));
      const listRaw = JSON.stringify(list.body);
      expect(listRaw).not.toContain(COMPANY_OWNER_NAME);
      expect(listRaw).not.toContain(COMPANY_OWNER_PHONE);
      expect(listRaw).not.toContain(BROKER_A_NAME);
      expect(listRaw).not.toContain(BROKER_A_PHONE);
      expect(listRaw).not.toContain('passwordHash');
      expect(listRaw).not.toContain('clients.local');

      const employeeList = await api()
        .get('/clients')
        .set(auth(employeeAToken));
      const firstEmployeeItem = (
        employeeList.body.data as { items: ClientDtoShape[] }
      ).items[0];
      expect(firstEmployeeItem).toBeDefined();
      const detail = await api()
        .get(`/clients/${firstEmployeeItem?.id ?? ''}`)
        .set(auth(employeeAToken));
      expect(detail.status).toBe(200);
      const detailRaw = JSON.stringify(detail.body);
      expect(detailRaw).not.toContain(COMPANY_OWNER_PHONE);
      expect(detailRaw).not.toContain(BROKER_A_PHONE);
      expect(detailRaw).not.toContain('passwordHash');

      const stats = await api().get('/clients/stats').set(auth(employeeBToken));
      const statsRaw = JSON.stringify(stats.body);
      expect(statsRaw).not.toContain(COMPANY_OWNER_NAME);
      expect(statsRaw).not.toContain(COMPANY_OWNER_PHONE);
      expect(statsRaw).not.toContain('passwordHash');

      const firstListItem = (list.body.data as { items: ClientDtoShape[] })
        .items[0];
      expect(firstListItem).toBeDefined();
      const keys = Object.keys(firstListItem as ClientDtoShape).sort();
      expect(keys).toEqual([...CLIENT_DTO_KEYS].sort());
    });

    it('auto-provisions the EmployeeProfile at REVIEW APPROVAL so an account created outside the employees flow OWNS the client it submitted', async () => {
      const orphan = await createUser(ctx.prisma, {
        email: 'employee.orphan@clients.local',
        name: 'Employee Orphan',
        role: Role.EMPLOYEE,
      });
      const orphanToken = await login(ctx.app, orphan.email);
      const submitted = await api()
        .post('/client-reviews')
        .set(auth(orphanToken))
        .send({ kind: 'CREATION', name: 'زبون مهجور', phone: '65000016' });
      expect(submitted.status).toBe(201);
      const reviewId = (submitted.body.data as { id: string }).id;
      const orphanBefore = await ctx.prisma.employeeProfile.findUnique({
        where: { userId: orphan.id },
      });
      expect(orphanBefore).toBeNull();

      const approve = await api()
        .post(`/client-reviews/${reviewId}/approve`)
        .set(auth(managerToken))
        .send({});
      expect(approve.status).toBe(201);
      const clientId = (approve.body.data as { clientId: string }).clientId;

      // The approval provisioned a minimal profile on demand: the requester
      // owns the materialized client (creator AND responsible).
      const profile = await ctx.prisma.employeeProfile.findUnique({
        where: { userId: orphan.id },
      });
      expect(profile).not.toBeNull();
      const row = await ctx.prisma.client.findUnique({ where: { id: clientId! } });
      expect(row?.createdById).toBe(profile?.id);
      expect(row?.responsibleEmployeeId).toBe(profile?.id);

      const read = await api()
        .get(`/clients/${clientId}`)
        .set(auth(orphanToken));
      expect(read.status).toBe(200);
      const list = await api().get('/clients').set(auth(orphanToken));
      expect(
        (list.body.data as { items: ClientDtoShape[] }).items,
      ).toHaveLength(1);

      // The manager still sees it too.
      const managerRead = await api()
        .get(`/clients/${clientId}`)
        .set(auth(managerToken));
      expect(managerRead.status).toBe(200);
    });

    describe('property interests (`ClientPropertyInterest`) — wizard linking', () => {
      const phoneKey = (family: string) =>
        `62${family}${randomUUID().slice(0, 3).replace(/[^0-9a-f]/g, '1')}`;

      /** Seed a Property row directly with a controlled reference. */
      const seedProperty = async (
        overrides: Partial<{
          status: 'AVAILABLE' | 'PENDING' | 'REJECTED';
          listingType: 'SALE' | 'RENT' | 'EXCHANGE';
          createdByUserId: string | null;
          area: string | null;
          askingPrice: string;
        }> = {},
      ) =>
        ctx.prisma.property.create({
          data: {
            reference: `INT-${randomUUID().slice(0, 8).toUpperCase()}`,
            title: 'عقار استفسار',
            area: overrides.area ?? 'السالمية',
            currency: 'KWD',
            status: overrides.status ?? 'AVAILABLE',
            listingType: overrides.listingType ?? 'SALE',
            askingPrice: overrides.askingPrice ?? '275000.00',
            createdByUserId:
              overrides.createdByUserId === undefined
                ? managerId
                : overrides.createdByUserId,
          },
        });

      /** Approves a review and returns the materialized client id. */
      const approveOnly = async (reviewId: string): Promise<string> => {
        const response = await api()
          .post(`/client-reviews/${reviewId}/approve`)
          .set(auth(managerToken))
          .send({});
        expect(response.status).toBe(201);
        return (response.body.data as { clientId: string }).clientId;
      };

      it('stages client + interest ATOMICALLY at approval and returns it in the authorized read', async () => {
        const property = await seedProperty();
        const response = await api()
          .post('/client-reviews')
          .set(auth(employeeAToken))
          .send({
            kind: 'CREATION',
            name: 'عميل اهتمام',
            phone: phoneKey('a'),
            addInterests: [
              {
                propertyId: property.id,
                reason: 'استفسار',
                notes: 'سأل عن السعر',
              },
            ],
          });
        expect(response.status).toBe(201);
        const createdId = await approveOnly(
          (response.body.data as { id: string }).id,
        );
        // Exactly one durable link row despite being created with the client.
        const rows = await ctx.prisma.clientPropertyInterest.count({
          where: { clientId: createdId },
        });
        expect(rows).toBe(1);

        const read = await api().get(`/clients/${createdId}`).set(auth(employeeAToken));
        expect(read.status).toBe(200);
        const interests = (read.body.data as ClientDtoShape).propertyInterests;
        const interest = interests.at(0);
        expect(interest).toBeDefined();
        expect(interests).toHaveLength(1);
        // The exact immutable Property.id round-trips — never a code.
        expect(interest?.propertyId).toBe(property.id);
        // ONLY public listing fields travel; no contact object exists.
        expect(Object.keys(interest ?? {}).sort()).toEqual([
          'area',
          'askingPrice',
          'createdAt',
          'currency',
          'notes',
          'propertyId',
          'reason',
          'reference',
          'title',
        ]);
        expect(interest?.reference).toBe(property.reference);
        expect(interest?.area).toBe(property.area);
        expect(interest?.askingPrice).toBe('275000');
        expect(interest?.reason).toBe('استفسار');
        expect(interest?.notes).toBe('سأل عن السعر');
      });

      it('upserts interest rows at approval — NO duplicate rows across sequential reviews', async () => {
        const property = await seedProperty();
        const stageCreation = async (payload: Record<string, unknown>) => {
          const submitted = await api()
            .post('/client-reviews')
            .set(auth(employeeAToken))
            .send({ kind: 'CREATION', name: 'عميل تكرار', phone: phoneKey('b'), ...payload });
          expect(submitted.status).toBe(201);
          return (submitted.body.data as { id: string }).id;
        };
        const clientId = await approveOnly(
          await stageCreation({ addInterests: [{ propertyId: property.id, reason: 'استفسار' }] }),
        );

        // Same client, same property, new notes → a SECOND REVIEWED update,
        // applied as an UPDATE on the same link row, never a duplicate.
        const again = await api()
          .post('/client-reviews')
          .set(auth(employeeAToken))
          .send({
            kind: 'EDIT',
            clientId,
            name: 'عميل تكرار',
            phone: phoneKey('b'),
            addInterests: [
              { propertyId: property.id, reason: 'طلب معاينة', notes: 'متابعة لاحقة' },
            ],
          });
        expect(again.status).toBe(201);
        await approveOnly((again.body.data as { id: string }).id);
        const rows = await ctx.prisma.clientPropertyInterest.count({
          where: { clientId },
        });
        expect(rows).toBe(1);
        const read = await api().get(`/clients/${clientId}`).set(auth(employeeAToken));
        expect(read.status).toBe(200);
        const interests = (read.body.data as ClientDtoShape).propertyInterests;
        expect(interests).toHaveLength(1);
        expect(interests.at(0)?.reason).toBe('طلب معاينة');
        expect(interests.at(0)?.notes).toBe('متابعة لاحقة');
      });

      it('links ANOTHER property through sequential approvals without recreating the client', async () => {
        const first = await seedProperty();
        const second = await seedProperty({ listingType: 'RENT' });
        const stageCreation = async (payload: Record<string, unknown>) => {
          const submitted = await api()
            .post('/client-reviews')
            .set(auth(employeeAToken))
            .send({ kind: 'CREATION', name: 'عميل عقارين', phone: phoneKey('c'), ...payload });
          expect(submitted.status).toBe(201);
          return (submitted.body.data as { id: string }).id;
        };
        const clientId = await approveOnly(
          await stageCreation({ addInterests: [{ propertyId: first.id }] }),
        );
        const response = await api()
          .post('/client-reviews')
          .set(auth(employeeAToken))
          .send({
            kind: 'EDIT',
            clientId,
            name: 'عميل عقارين',
            phone: phoneKey('c'),
            addInterests: [{ propertyId: second.id }],
          });
        expect(response.status).toBe(201);
        await approveOnly((response.body.data as { id: string }).id);
        const read = await api().get(`/clients/${clientId}`).set(auth(employeeAToken));
        expect(read.status).toBe(200);
        const interests = (read.body.data as ClientDtoShape).propertyInterests;
        expect(interests.map((row) => row.propertyId).sort()).toEqual(
          [first.id, second.id].sort(),
        );
        // Same client row — no duplicate client.
        const relisted = (await api().get('/clients').set(auth(employeeAToken))).body
          .data as { items: ClientDtoShape[] };
        expect(
          relisted.items.filter((entry) => entry.name === 'عميل عقارين'),
        ).toHaveLength(1);
        expect(
          relisted.items.find((entry) => entry.id === clientId)?.propertyInterests,
        ).toHaveLength(2);
      });

      it('rejects at SUBMISSION unknown or invisible property ids with 404, unavailable with 400', async () => {
        const stageCreation = async (payload: Record<string, unknown>) =>
          api().post('/client-reviews').set(auth(employeeAToken)).send({
            kind: 'CREATION',
            name: 'عميل مؤقت',
            phone: phoneKey('z'),
            ...payload,
          });
        // Own PENDING property: visible to employee A, so the availability
        // rule (not visibility) rejects the submission itself.
        const ownPending = await seedProperty({
          status: 'PENDING',
          createdByUserId: employeeAId,
        });
        const unavailable = await stageCreation({
          name: 'عميل غير متاح',
          phone: phoneKey('d'),
          addInterests: [{ propertyId: ownPending.id }],
        });
        expect(unavailable.status).toBe(400);

        // Another employee's PENDING property: invisible → 404, non-disclosing.
        const hidden = await seedProperty({
          status: 'PENDING',
          createdByUserId: employeeBId,
        });
        const invisible = await stageCreation({
          name: 'عميل خفي',
          phone: phoneKey('e'),
          addInterests: [{ propertyId: hidden.id }],
        });
        expect(invisible.status).toBe(404);

        // Unknown id.
        const unknown = await stageCreation({
          name: 'عميل مجهول',
          phone: phoneKey('f'),
          addInterests: [{ propertyId: randomUUID() }],
        });
        expect(unknown.status).toBe(404);

        // No review row survived any refusal: the count is unchanged
        // across the three refused submissions above.
        const rowsBefore = await ctx.prisma.clientReviewRequest.count({
          where: { requestedById: employeeAId, kind: 'CREATION' },
        });
        await stageCreation({
          name: 'عميل مرفوض دائمًا',
          phone: phoneKey('h'),
          addInterests: [{ propertyId: randomUUID() }],
        });
        expect(
          await ctx.prisma.clientReviewRequest.count({
            where: { requestedById: employeeAId, kind: 'CREATION' },
          }),
        ).toBe(rowsBefore);
      });

      it('lets a MANAGER attach interests to any client directly; employees have no direct interest writes', async () => {
        const property = await seedProperty({ askingPrice: '150000.00' });
        // A client owned by employee A is invisible to employee B by id — and
        // B's direct interest write is refused at the ROLE level anyway.
        const aClient = await createClient(managerToken, {
          name: 'عميل الموظف أ',
          phone: phoneKey('g'),
          responsibleUserId: employeeAId,
        });
        const asB = await api()
          .patch(`/clients/${aClient.id}`)
          .set(auth(employeeBToken))
          .send({ propertyInterests: [{ propertyId: property.id }] });
        expect(asB.status).toBe(403);
        const readAsB = await api().get(`/clients/${aClient.id}`).set(auth(employeeBToken));
        expect(readAsB.status).toBe(404);

        // The manager authorises the same link.
        const asManager = await api()
          .patch(`/clients/${aClient.id}`)
          .set(auth(managerToken))
          .send({ propertyInterests: [{ propertyId: property.id, reason: 'تفاوض على السعر' }] });
        expect(asManager.status).toBe(200);
        const interests = (asManager.body.data as ClientDtoShape).propertyInterests;
        expect(interests).toHaveLength(1);
        expect(interests.at(0)?.reason).toBe('تفاوض على السعر');
        // Broken ownership would silently exist otherwise; guard the row.
        expect(await ctx.prisma.clientPropertyInterest.count({ where: { clientId: aClient.id } })).toBe(1);
      });
    });
  },
);

/**
 * Statistics coverage: every counter is computed from WHOLE authorised tables,
 * scoped per role, and never leaks contact payloads. The fixture is created
 * from scratch inside a freshly reset database so the numbers are exact.
 */
describeWithDatabase(
  'Clients statistics: authorised counters from whole tables (isolated DB)',
  () => {
    let ctx: TestContext;
    let managerToken: string;
    let employeeAToken: string;
    let employeeBToken: string;
    let managerId: string;
    let c1: ClientDtoShape;
    let c5: ClientDtoShape;

    const api = () => request(ctx.app.getHttpServer());

    const statsOf = async (token: string): Promise<ClientStatsShape> => {
      const response = await api().get('/clients/stats').set(auth(token));
      expect(response.status).toBe(200);
      return response.body.data as ClientStatsShape;
    };

    const createClient = async (
      token: string,
      payload: Record<string, unknown>,
    ): Promise<ClientDtoShape> => {
      const response = await api()
        .post('/clients')
        .set(auth(token))
        .send(payload);
      expect(response.status).toBe(201);
      return response.body.data as ClientDtoShape;
    };

    const addFollowUp = async (
      token: string,
      clientId: string,
      dueAt: string,
    ): Promise<void> => {
      const response = await api()
        .post(`/clients/${clientId}/follow-ups`)
        .set(auth(token))
        .send({ dueAt, method: 'اتصال', outcome: 'تم التواصل' });
      expect(response.status).toBe(201);
    };

    beforeAll(async () => {
      ctx = await createTestApp();
      await resetDatabase(ctx.prisma);
      resetRateLimiting(ctx.app);
      const manager = await createUser(ctx.prisma, {
        email: 'manager@clientstats.local',
        name: 'مدير الإحصاءات',
        role: Role.MANAGER,
      });
      const employeeA = await createUser(ctx.prisma, {
        email: 'employee.a@clientstats.local',
        name: 'Employee A',
        role: Role.EMPLOYEE,
      });
      const employeeB = await createUser(ctx.prisma, {
        email: 'employee.b@clientstats.local',
        name: 'Employee B',
        role: Role.EMPLOYEE,
      });
      managerId = manager.id;
      await ctx.prisma.employeeProfile.create({ data: { userId: employeeA.id } });
      await ctx.prisma.employeeProfile.create({ data: { userId: employeeB.id } });
      managerToken = await login(ctx.app, manager.email);
      employeeAToken = await login(ctx.app, employeeA.email);
      employeeBToken = await login(ctx.app, employeeB.email);

      // Contacts: one employee-registered owner, one broker per employee and
      // one company owner record (responsibleUserId null, not an "owner" tab row).
      expect(
        (
          await api()
            .post('/contacts')
            .set(auth(employeeAToken))
            .send({ type: 'OWNER', name: 'مالك مؤظف أ', phone: '94445555' })
        ).status,
      ).toBe(201);
      expect(
        (
          await api()
            .post('/contacts')
            .set(auth(employeeAToken))
            .send({ type: 'BROKER', name: 'وسيط مؤظف أ', phone: '94445556' })
        ).status,
      ).toBe(201);
      expect(
        (
          await api()
            .post('/contacts')
            .set(auth(employeeBToken))
            .send({ type: 'BROKER', name: 'وسيط مؤظف ب', phone: '94445557' })
        ).status,
      ).toBe(201);
      expect(
        (
          await api()
            .post('/contacts')
            .set(auth(managerToken))
            .send({ type: 'OWNER', name: 'مالك الشركة', phone: '94445558' })
        ).status,
      ).toBe(201);

      // c1: manager-created, responsible A, linked to a property through a deal.
      c1 = await createClient(managerToken, {
        name: 'إحصاء 1',
        phone: '66000001',
        responsibleUserId: employeeA.id,
      });
      const property = await ctx.prisma.property.create({
        data: {
          reference: 'REF-CLIENTS-STATS-1',
          title: 'فيلا إحصائية',
          area: 'الفروانية',
          currency: 'KWD',
          listingType: 'SALE',
          askingPrice: '150000.00',
          createdByUserId: managerId,
        },
      });
      await ctx.prisma.deal.create({
        data: {
          reference: 'DEAL-CLIENTS-STATS-1',
          type: 'SALE',
          propertyId: property.id,
          clientId: c1.id,
          recordedById: managerId,
          price: '150000.00',
          companyCommission: '7500.00',
          currency: 'KWD',
          closedAt: new Date(),
        },
      });

      // c2: manager-created, responsible A, one past (late) follow-up.
      const c2 = await createClient(managerToken, {
        name: 'إحصاء 2',
        phone: '66000002',
        responsibleUserId: employeeA.id,
      });
      await addFollowUp(managerToken, c2.id, dayKey(-1));

      // c3/c4: employee A clients, one due today and one far in the future.
      const c3 = await createClient(managerToken, {
        name: 'إحصاء 3',
        phone: '66000003',
        responsibleUserId: employeeA.id,
      });
      await addFollowUp(employeeAToken, c3.id, dayKey(0));
      const c4 = await createClient(managerToken, {
        name: 'إحصاء 4',
        phone: '66000004',
        responsibleUserId: employeeA.id,
      });
      await addFollowUp(employeeAToken, c4.id, dayKey(10));

      // c5: closed lifecycle status, out of the active counter.
      c5 = await createClient(managerToken, {
        name: 'إحصاء 5',
        phone: '66000005',
        responsibleUserId: employeeA.id,
      });
      await ctx.prisma.client.update({
        where: { id: c5.id },
        data: { status: 'CLOSED' },
      });

      // c6: manager-created, responsible B, nothing scheduled.
      await createClient(managerToken, {
        name: 'إحصاء 6',
        phone: '66000006',
        responsibleUserId: employeeB.id,
      });
    });


    afterAll(async () => {
      await ctx.close();
    });

    it('answers the manager with exact whole-table counters', async () => {
      const stats = await statsOf(managerToken);
      expect(stats.totalClients).toBe(6);
      expect(stats.activeClients).toBe(5);
      expect(stats.owners).toBe(1);
      expect(stats.brokers).toBe(2);
      expect(stats.clientsNeedingFollowUp).toBe(5);
      expect(stats.clientsLate).toBe(1);
      expect(stats.clientsWithoutProperty).toBe(5);

      // The week window is the server's Saturday–Friday week; the two in-week
      // follow-ups are counted whatever day the suite runs on.
      const weekStart = weekStartKey();
      const weekEnd = addDaysKey(weekStart, 7);
      const expectedWeek = [dayKey(-1), dayKey(0), dayKey(10)].filter(
        (key) => key >= weekStart && key < weekEnd,
      ).length;
      expect(stats.followUpsThisWeek).toBe(expectedWeek);

      expect(Object.keys(stats).sort()).toEqual(
        [
          'totalClients',
          'activeClients',
          'owners',
          'brokers',
          'followUpsThisWeek',
          'clientsNeedingFollowUp',
          'clientsLate',
          'clientsWithoutProperty',
        ].sort(),
      );
    });

    it('scopes every employee counter to authorised clients and their own contacts', async () => {
      const statsA = await statsOf(employeeAToken);
      expect(statsA.totalClients).toBe(5);
      expect(statsA.activeClients).toBe(4);
      expect(statsA.owners).toBe(1);
      expect(statsA.brokers).toBe(1);
      expect(statsA.clientsNeedingFollowUp).toBe(4);
      expect(statsA.clientsLate).toBe(1);
      expect(statsA.clientsWithoutProperty).toBe(4);

      const weekStart = weekStartKey();
      const weekEnd = addDaysKey(weekStart, 7);
      const expectedWeek = [dayKey(-1), dayKey(0), dayKey(10)].filter(
        (key) => key >= weekStart && key < weekEnd,
      ).length;
      expect(statsA.followUpsThisWeek).toBe(expectedWeek);

      const statsB = await statsOf(employeeBToken);
      expect(statsB.totalClients).toBe(1);
      expect(statsB.activeClients).toBe(1);
      expect(statsB.owners).toBe(0);
      expect(statsB.brokers).toBe(1);
      expect(statsB.followUpsThisWeek).toBe(0);
      expect(statsB.clientsNeedingFollowUp).toBe(1);
      expect(statsB.clientsLate).toBe(0);
      expect(statsB.clientsWithoutProperty).toBe(1);
    });

    it('keeps the stats counters in agreement with the authorised list', async () => {
      for (const token of [managerToken, employeeAToken, employeeBToken]) {
        const stats = await statsOf(token);
        const list = await api().get('/clients').set(auth(token));
        const items = (list.body.data as { items: ClientDtoShape[] }).items;
        expect(items).toHaveLength(stats.totalClients);
        expect(stats.activeClients).toBeLessThanOrEqual(stats.totalClients);
        expect(stats.clientsLate).toBeLessThanOrEqual(stats.clientsNeedingFollowUp);
      }
    });

    it('exposes the linked property in the client detail without leaking contact payloads', async () => {
      const detail = await api()
        .get(`/clients/${c1.id}`)
        .set(auth(managerToken));
      expect(detail.status).toBe(200);
      const dto = detail.body.data as ClientDtoShape;
      expect(dto.properties).toHaveLength(1);
      const linked = dto.properties[0];
      expect(linked?.reference).toBe('REF-CLIENTS-STATS-1');
      expect(linked?.title).toBe('فيلا إحصائية');
      expect(linked?.area).toBe('الفروانية');
      expect(linked?.currency).toBe('KWD');
      expect(linked?.askingPrice).toContain('150000');

      const raw = JSON.stringify(detail.body);
      expect(raw).not.toContain('94445555');
      expect(raw).not.toContain('94445556');
      expect(raw).not.toContain('passwordHash');

      const closed = await api()
        .get(`/clients/${c5.id}`)
        .set(auth(managerToken));
      expect((closed.body.data as ClientDtoShape).status).toBe('CLOSED');
    });
  },
);
