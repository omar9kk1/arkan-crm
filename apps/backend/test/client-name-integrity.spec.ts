import { Role } from '@arkan/shared';
import request from 'supertest';
import {
  auth,
  createTestApp,
  createUser,
  describeWithDatabase,
  login,
  resetDatabase,
  type TestContext,
} from './support/test-app';

jest.setTimeout(180000);

/**
 * The "?" corruption guard — now on BOTH write entries:
 * - the direct manager paths (`POST/PATCH /clients`), and
 * - the staged review submissions (`POST /client-reviews`), so a corrupted
 *   wizard pack can never reach a manager's approval queue either.
 *
 * The guard rejects ONLY the all-'?' corruption class; normal Arabic/Latin
 * names flow untouched. No existing row is rewritten by this guard.
 */
describeWithDatabase('Unreadable client-name corruption guard', () => {
  let ctx: TestContext;
  let managerToken: string;
  let employeeToken: string;

  const api = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'manager@nameguard.local',
      name: 'مدير حارس الأسماء',
      role: Role.MANAGER,
    });
    const employee = await createUser(ctx.prisma, {
      email: 'employee@nameguard.local',
      name: 'موظف حارس الأسماء',
      role: Role.EMPLOYEE,
    });
    await ctx.prisma.employeeProfile.upsert({ where: { userId: employee.id }, create: { userId: employee.id }, update: {} });
    managerToken = await login(ctx.app, manager.email);
    employeeToken = await login(ctx.app, employee.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('rejects creating a client whose name is only question marks (direct path)', async () => {
    const response = await api()
      .post('/clients')
      .set(auth(managerToken))
      .send({ name: '???? ?????? ??', phone: '66010201' });
    expect(response.status).toBe(400);
    expect(
      await ctx.prisma.client.count({ where: { phone: '66010201' } }),
    ).toBe(0);
  });

  it('rejects the same corruption at the review submission gate too', async () => {
    const submitted = await api()
      .post('/client-reviews')
      .set(auth(employeeToken))
      .send({ kind: 'CREATION', name: '???? ???? ??', phone: '66010201' });
    expect(submitted.status).toBe(400);
    expect(
      await ctx.prisma.clientReviewRequest.count({ where: { kind: 'CREATION' } }),
    ).toBe(0);
  });

  it('never lets a PATCH replace a REAL Arabic name with the corruption class', async () => {
    const created = await request(ctx.app.getHttpServer())
      .post('/clients')
      .set(auth(managerToken))
      .send({ name: 'عبدالله المطيري', phone: '66010202' });
    expect(created.status).toBe(201);
    const id = (created.body.data as { id: string }).id;

    const denied = await api()
      .patch(`/clients/${id}`)
      .set(auth(managerToken))
      .send({ name: '???? ???? ???? ???? ????' });
    expect(denied.status).toBe(400);
    const row = await ctx.prisma.client.findUnique({ where: { id } });
    expect(row?.name).toBe('عبدالله المطيري');
  });

  it('keeps perfectly ordinary Arabic and Latin names flowing through (both paths)', async () => {
    const arabic = await api()
      .post('/clients')
      .set(auth(managerToken))
      .send({ name: 'عبدالله المطيري', phone: '66010203' });
    expect(arabic.status).toBe(201);
    expect((arabic.body.data as { name: string }).name).toBe('عبدالله المطيري');

    const latin = await api()
      .post('/clients')
      .set(auth(managerToken))
      .send({ name: 'Abdallah M.', phone: '66010204' });
    expect(latin.status).toBe(201);
    // A name that CONTAINS a question mark among letters stays allowed —
    // only the all-'?' corruption class is rejected.
    const mixed = await api()
      .post('/clients')
      .set(auth(managerToken))
      .send({ name: 'Ab?dallah', phone: '66010205' });
    expect(mixed.status).toBe(201);

    // …and the same real names pass the review gate.
    const review = await api()
      .post('/client-reviews')
      .set(auth(employeeToken))
      .send({ kind: 'CREATION', name: 'عبدالله المطيري', phone: '66010206' });
    expect(review.status).toBe(201);
  });
});
