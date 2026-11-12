import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Role } from '@arkan/shared';
import type { AuthUser } from '@arkan/shared';
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

type FingerprintInternals = {
  syncFingerprint(viewer: AuthUser | null): Promise<string>;
};

type SyncInternals = {
  syncProperties: (...args: unknown[]) => Promise<void>;
  syncClients: (...args: unknown[]) => Promise<void>;
};

describeWithDatabase('Employee follow-up fingerprint optimization', () => {
  let ctx: TestContext;
  let employeeAId: string;
  let employeeBId: string;
  let profileAId: string;
  let profileBId: string;
  let employeeAToken: string;
  let employeeBToken: string;
  const api = () => request(ctx.app.getHttpServer());

  const viewerA: AuthUser = { id: '', role: Role.EMPLOYEE };
  const viewerB: AuthUser = { id: '', role: Role.EMPLOYEE };

  const service = () =>
    ctx.app.get(FollowUpsService) as unknown as FingerprintInternals &
      SyncInternals;

  const fingerprint = (viewer: AuthUser) =>
    service().syncFingerprint(viewer);

  /** The pre-optimization implementation, kept as the oracle. */
  const oldFingerprint = async (viewer: AuthUser) => {
    const propertyScope: Prisma.PropertyWhereInput = {
      OR: [
        { createdByUserId: viewer.id },
        { createdBy: { userId: viewer.id } },
        { assignments: { some: { employee: { userId: viewer.id } } } },
      ],
    };
    const clientScope: Prisma.ClientWhereInput = {
      OR: [
        { createdBy: { userId: viewer.id } },
        { responsibleEmployee: { userId: viewer.id } },
      ],
    };
    const [properties, assignments, clients, interests, users] =
      await Promise.all([
        ctx.prisma.property.aggregate({
          where: propertyScope,
          _count: { _all: true },
          _max: { updatedAt: true },
        }),
        ctx.prisma.propertyAssignment.aggregate({
          where: { property: propertyScope },
          _count: { _all: true },
          _max: { createdAt: true },
        }),
        ctx.prisma.client.aggregate({
          where: clientScope,
          _count: { _all: true },
          _max: { updatedAt: true },
        }),
        ctx.prisma.clientPropertyInterest.aggregate({
          where: { client: clientScope },
          _count: { _all: true },
          _max: { updatedAt: true },
        }),
        ctx.prisma.user.aggregate({
          _count: { _all: true },
          _max: { updatedAt: true },
        }),
      ]);
    return JSON.stringify([
      properties._count._all,
      properties._max.updatedAt?.toISOString() ?? '',
      assignments._count._all,
      assignments._max.createdAt?.toISOString() ?? '',
      clients._count._all,
      clients._max.updatedAt?.toISOString() ?? '',
      interests._count._all,
      interests._max.updatedAt?.toISOString() ?? '',
      users._count._all,
      users._max.updatedAt?.toISOString() ?? '',
    ]);
  };

  const createClient = (seed: string, responsibleProfileId: string) =>
    ctx.prisma.client.create({
      data: {
        id: randomUUID(),
        name: `Fingerprint ${seed}`,
        phone: `5777${seed}`.slice(0, 10),
        createdById: responsibleProfileId,
        responsibleEmployeeId: responsibleProfileId,
      },
    });

  const createProperty = (seed: string, ownerUserId: string, ownerProfileId: string) =>
    ctx.prisma.property.create({
      data: {
        reference: `FP-${seed}-${randomUUID().slice(0, 8)}`,
        title: `Fingerprint property ${seed}`,
        area: 'Fingerprint area',
        listingType: 'SALE',
        status: 'AVAILABLE',
        currency: 'KWD',
        createdByUserId: ownerUserId,
        createdById: ownerProfileId,
      },
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const managerA = await createUser(ctx.prisma, {
      email: 'fp.manager.a@test.local',
      name: 'Fingerprint Manager A',
      role: Role.MANAGER,
    });
    const managerB = await createUser(ctx.prisma, {
      email: 'fp.manager.b@test.local',
      name: 'Fingerprint Manager B',
      role: Role.MANAGER,
    });
    const employeeA = await createUser(ctx.prisma, {
      email: 'fp.employee.a@test.local',
      name: 'Fingerprint Employee A',
      role: Role.EMPLOYEE,
      managerUserId: managerA.id,
    });
    const employeeB = await createUser(ctx.prisma, {
      email: 'fp.employee.b@test.local',
      name: 'Fingerprint Employee B',
      role: Role.EMPLOYEE,
      managerUserId: managerB.id,
    });
    employeeAId = employeeA.id;
    employeeBId = employeeB.id;
    profileAId = (
      await ctx.prisma.employeeProfile.findUniqueOrThrow({
        where: { userId: employeeA.id },
        select: { id: true },
      })
    ).id;
    profileBId = (
      await ctx.prisma.employeeProfile.findUniqueOrThrow({
        where: { userId: employeeB.id },
        select: { id: true },
      })
    ).id;
    viewerA.id = employeeA.id;
    viewerA.role = Role.EMPLOYEE;
    viewerB.id = employeeB.id;
    viewerB.role = Role.EMPLOYEE;
    employeeAToken = await login(ctx.app, employeeA.email);
    employeeBToken = await login(ctx.app, employeeB.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('matches the previous five-query fingerprint for both teams', async () => {
    await createClient('A1', profileAId);
    await createProperty('A1', employeeAId, profileAId);
    await createClient('B1', profileBId);
    await createProperty('B1', employeeBId, profileBId);

    expect(await fingerprint(viewerA)).toBe(await oldFingerprint(viewerA));
    expect(await fingerprint(viewerB)).toBe(await oldFingerprint(viewerB));
    expect(await fingerprint(viewerA)).not.toBe(await fingerprint(viewerB));
  });

  it("does not change when another team's records change", async () => {
    const beforeA = await fingerprint(viewerA);
    const beforeB = await fingerprint(viewerB);

    await createClient('B2', profileBId);
    await createProperty('B2', employeeBId, profileBId);

    expect(await fingerprint(viewerA)).toBe(beforeA);
    expect(await fingerprint(viewerB)).not.toBe(beforeB);
    expect(await fingerprint(viewerB)).toBe(await oldFingerprint(viewerB));
  });

  it('changes for own client, property, assignment and interest edits', async () => {
    const start = await fingerprint(viewerA);

    await createClient('A2', profileAId);
    const afterClient = await fingerprint(viewerA);
    expect(afterClient).not.toBe(start);
    expect(afterClient).toBe(await oldFingerprint(viewerA));

    await new Promise((resolve) => setTimeout(resolve, 10));
    const client = await ctx.prisma.client.findFirstOrThrow({
      where: { name: 'Fingerprint A2' },
      select: { id: true },
    });
    await ctx.prisma.client.update({
      where: { id: client.id },
      data: { name: 'Fingerprint A2 updated' },
    });
    const afterUpdate = await fingerprint(viewerA);
    expect(afterUpdate).not.toBe(afterClient);

    const property = await createProperty('A2', employeeAId, profileAId);
    const afterProperty = await fingerprint(viewerA);
    expect(afterProperty).not.toBe(afterUpdate);

    await ctx.prisma.propertyAssignment.create({
      data: {
        propertyId: property.id,
        employeeId: profileAId,
        purpose: 'MARKETING',
      },
    });
    const afterAssignment = await fingerprint(viewerA);
    expect(afterAssignment).not.toBe(afterProperty);

    await ctx.prisma.clientPropertyInterest.create({
      data: { clientId: client.id, propertyId: property.id },
    });
    const afterInterest = await fingerprint(viewerA);
    expect(afterInterest).not.toBe(afterAssignment);
    expect(afterInterest).toBe(await oldFingerprint(viewerA));
  });

  it('keeps employee first-page synchronization single-flight', async () => {
    const propertySpy = jest.spyOn(service(), 'syncProperties');
    const clientSpy = jest.spyOn(service(), 'syncClients');

    await createClient('A3', profileAId);
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        api().get('/follow-ups?limit=1').set(auth(employeeAToken)),
      ),
    );
    for (const response of responses) expect(response.status).toBe(200);
    expect(propertySpy).toHaveBeenCalledTimes(1);
    expect(clientSpy).toHaveBeenCalledTimes(1);
  });

  it('never exposes another team subject to the employee list', async () => {
    const otherClient = await createClient('B3', profileBId);
    await api().get('/follow-ups?limit=1').set(auth(employeeBToken));
    const otherSubject = await ctx.prisma.followUpSubject.findFirstOrThrow({
      where: { targetKey: `CLIENT:${otherClient.id}` },
      select: { id: true },
    });

    const ownPage = await api()
      .get('/follow-ups?limit=100')
      .set(auth(employeeAToken));
    expect(ownPage.status).toBe(200);
    const ids = (ownPage.body.data as { items: Array<{ id: string }> }).items.map(
      (item) => item.id,
    );
    expect(ids).not.toContain(otherSubject.id);

    const otherPage = await api()
      .get('/follow-ups?limit=100')
      .set(auth(employeeBToken));
    expect(
      (otherPage.body.data as { items: Array<{ id: string }> }).items.map(
        (item) => item.id,
      ),
    ).toContain(otherSubject.id);
  });
});
