import { randomUUID } from 'node:crypto';
import { Role } from '@arkan/shared';
import request from 'supertest';
import { FollowUpsService } from '../src/followups/followups.service';
import {
  auth,
  createTestApp,
  createUser,
  describeWithDatabase,
  login,
  resetDatabase,
  type TestContext,
} from './support/test-app';

jest.setTimeout(120000);

type SyncInternals = {
  syncProperties: (...args: unknown[]) => Promise<void>;
  syncClients: (...args: unknown[]) => Promise<void>;
};

describeWithDatabase('Follow-up sync optimization', () => {
  let ctx: TestContext;
  let managerToken: string;
  let employeeToken: string;
  let employeeId: string;
  let employeeProfileId: string;
  const api = () => request(ctx.app.getHttpServer());

  const internals = () =>
    ctx.app.get(FollowUpsService) as unknown as SyncInternals;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'sync.manager@test.local',
      name: 'Sync Manager',
      role: Role.MANAGER,
    });
    const employee = await createUser(ctx.prisma, {
      email: 'sync.employee@test.local',
      name: 'Sync Employee',
      role: Role.EMPLOYEE,
      managerUserId: manager.id,
    });
    employeeId = employee.id;
    employeeProfileId = (
      await ctx.prisma.employeeProfile.findUniqueOrThrow({
        where: { userId: employee.id },
        select: { id: true },
      })
    ).id;
    managerToken = await login(ctx.app, manager.email);
    employeeToken = await login(ctx.app, employee.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not repeat the full canonical scan on a repeated first page', async () => {
    const propertySpy = jest.spyOn(internals(), 'syncProperties');
    const clientSpy = jest.spyOn(internals(), 'syncClients');

    const first = await api()
      .get('/follow-ups')
      .set(auth(managerToken));
    expect(first.status).toBe(200);
    expect(propertySpy).toHaveBeenCalledTimes(1);
    expect(clientSpy).toHaveBeenCalledTimes(1);

    const second = await api()
      .get('/follow-ups')
      .set(auth(managerToken));
    expect(second.status).toBe(200);
    expect(propertySpy).toHaveBeenCalledTimes(1);
    expect(clientSpy).toHaveBeenCalledTimes(1);
  });

  it('syncs a new canonical client once, exposes it, and keeps summaries current without another scan', async () => {
    const propertySpy = jest.spyOn(internals(), 'syncProperties');
    const clientSpy = jest.spyOn(internals(), 'syncClients');
    const client = await ctx.prisma.client.create({
      data: {
        id: randomUUID(),
        name: 'Sync New Client',
        phone: '555700001',
        responsibleEmployeeId: employeeProfileId,
      },
    });

    const first = await api()
      .get('/follow-ups?limit=100')
      .set(auth(employeeToken));
    expect(first.status).toBe(200);
    expect(propertySpy).toHaveBeenCalledTimes(1);
    expect(clientSpy).toHaveBeenCalledTimes(1);

    const subject = await ctx.prisma.followUpSubject.findFirstOrThrow({
      where: { targetKey: `CLIENT:${client.id}` },
      select: { id: true },
    });
    expect(
      (first.body.data as { items: Array<{ id: string }> }).items.map(
        (item) => item.id,
      ),
    ).toContain(subject.id);

    await ctx.prisma.followUpSubject.update({
      where: { id: subject.id },
      data: { nextDueAt: new Date(Date.now() - 2 * 86400000) },
    });

    const second = await api()
      .get('/follow-ups?limit=100')
      .set(auth(employeeToken));
    expect(second.status).toBe(200);
    expect(
      (second.body.data as { summary: { overdue: number } }).summary.overdue,
    ).toBeGreaterThanOrEqual(1);
    // The canonical input did not change: the date transition is evaluated by
    // the read query, not by another synchronization pass.
    expect(propertySpy).toHaveBeenCalledTimes(1);
    expect(clientSpy).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent first-page requests into one sync without duplicate subjects', async () => {
    const client = await ctx.prisma.client.create({
      data: {
        id: randomUUID(),
        name: 'Sync Concurrent Client',
        phone: '555700002',
        responsibleEmployeeId: employeeProfileId,
      },
    });
    const clientSpy = jest.spyOn(internals(), 'syncClients');
    await ctx.prisma.client.update({
      where: { id: client.id },
      data: { name: 'Sync Concurrent Client Updated' },
    });

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        api().get('/follow-ups?limit=100').set(auth(employeeToken)),
      ),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(clientSpy).toHaveBeenCalledTimes(1);

    const rows = await ctx.prisma.followUpSubject.findMany({
      where: { targetKey: `CLIENT:${client.id}` },
      select: { id: true },
    });
    expect(rows).toHaveLength(1);
    expect(employeeId).toBeTruthy();
  });
});
