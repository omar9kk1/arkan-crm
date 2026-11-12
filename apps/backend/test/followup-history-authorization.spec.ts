import { randomUUID } from 'node:crypto';
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

jest.setTimeout(120000);

/**
 * Regression coverage for the cross-team follow-up history leak:
 * manager history access must be limited to the manager's own subjects and
 * the CURRENT team's employee subjects, resolved in the database query.
 */
describeWithDatabase('Follow-up history authorization', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let managerAToken: string;
  let managerBToken: string;
  let employeeAToken: string;
  let employeeBToken: string;
  let managerAId: string;
  let employeeAId: string;
  let employeeAProfileId: string;
  let employeeBProfileId: string;
  let ownerDirectProfileId: string;
  let teamAEmployeeSubjectId: string;
  let teamBEmployeeSubjectId: string;
  let teamBPropertySubjectId: string;
  let managerAPersonalSubjectId: string;
  let managerBPersonalSubjectId: string;
  let ownerDirectSubjectId: string;
  let secretClientPhone: string;
  let secretContactPhone: string;
  const api = () => request(ctx.app.getHttpServer());

  const history = (token: string, id: string) =>
    api().get(`/follow-ups/${id}/history`).set(auth(token));

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);

    const owner = await createUser(ctx.prisma, {
      email: 'history.owner@test.local',
      name: 'History Owner',
      role: Role.OWNER,
    });
    const managerA = await createUser(ctx.prisma, {
      email: 'history.manager.a@test.local',
      name: 'History Manager A',
      role: Role.MANAGER,
    });
    const managerB = await createUser(ctx.prisma, {
      email: 'history.manager.b@test.local',
      name: 'History Manager B',
      role: Role.MANAGER,
    });
    const employeeA = await createUser(ctx.prisma, {
      email: 'history.employee.a@test.local',
      name: 'History Employee A',
      role: Role.EMPLOYEE,
      managerUserId: managerA.id,
    });
    const employeeB = await createUser(ctx.prisma, {
      email: 'history.employee.b@test.local',
      name: 'History Employee B',
      role: Role.EMPLOYEE,
      managerUserId: managerB.id,
    });
    const ownerDirect = await createUser(ctx.prisma, {
      email: 'history.employee.direct@test.local',
      name: 'History Owner Direct',
      role: Role.EMPLOYEE,
      managerUserId: null,
    });

    managerAId = managerA.id;
    employeeAId = employeeA.id;
    employeeAProfileId = (
      await ctx.prisma.employeeProfile.findUniqueOrThrow({
        where: { userId: employeeA.id },
        select: { id: true },
      })
    ).id;
    employeeBProfileId = (
      await ctx.prisma.employeeProfile.findUniqueOrThrow({
        where: { userId: employeeB.id },
        select: { id: true },
      })
    ).id;
    ownerDirectProfileId = (
      await ctx.prisma.employeeProfile.findUniqueOrThrow({
        where: { userId: ownerDirect.id },
        select: { id: true },
      })
    ).id;

    secretClientPhone = '555900111';
    secretContactPhone = '555900222';
    const secretContact = await ctx.prisma.contact.create({
      data: {
        id: randomUUID(),
        type: 'OWNER',
        name: 'Secret History Owner',
        phone: secretContactPhone,
      },
    });
    const secretClient = await ctx.prisma.client.create({
      data: {
        id: randomUUID(),
        name: 'Secret History Client',
        phone: secretClientPhone,
        responsibleEmployeeId: employeeBProfileId,
      },
    });
    const property = await ctx.prisma.property.create({
      data: {
        id: randomUUID(),
        reference: 'P-HISTORY-0001',
        title: 'History Property',
        area: 'History Area',
        currency: 'KWD',
        listingType: 'SALE',
        status: 'PENDING',
        createdByUserId: employeeAId,
        contactId: secretContact.id,
      },
    });

    const makeSubject = (
      responsible:
        | { responsibleId: string }
        | { responsibleUserId: string },
      relation:
        | { clientId?: string; propertyId?: string; kind: 'CLIENT' | 'PROPERTY_OWNER' } = {
        kind: 'CLIENT',
      },
    ) =>
      ctx.prisma.followUpSubject.create({
        data: {
          id: randomUUID(),
          targetKey: `HISTORY:${randomUUID()}`,
          kind: relation.kind,
          ...responsible,
          ...(relation.clientId ? { clientId: relation.clientId } : {}),
          ...(relation.propertyId ? { propertyId: relation.propertyId } : {}),
          activatedAt: new Date(Date.now() - 86400000),
          nextDueAt: new Date(Date.now() + 86400000),
        },
        select: { id: true },
      });

    teamAEmployeeSubjectId = (
      await makeSubject({ responsibleId: employeeAProfileId })
    ).id;
    teamBEmployeeSubjectId = (
      await makeSubject(
        { responsibleId: employeeBProfileId },
        { kind: 'CLIENT', clientId: secretClient.id },
      )
    ).id;
    teamBPropertySubjectId = (
      await makeSubject(
        { responsibleId: employeeBProfileId },
        { kind: 'PROPERTY_OWNER', propertyId: property.id },
      )
    ).id;
    managerAPersonalSubjectId = (
      await makeSubject({ responsibleUserId: managerA.id })
    ).id;
    managerBPersonalSubjectId = (
      await makeSubject({ responsibleUserId: managerB.id })
    ).id;
    ownerDirectSubjectId = (
      await makeSubject({ responsibleId: ownerDirectProfileId })
    ).id;

    ownerToken = await login(ctx.app, owner.email);
    managerAToken = await login(ctx.app, managerA.email);
    managerBToken = await login(ctx.app, managerB.email);
    employeeAToken = await login(ctx.app, employeeA.email);
    employeeBToken = await login(ctx.app, employeeB.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('MANAGER A cannot read Team B employee history', async () => {
    expect((await history(managerAToken, teamBEmployeeSubjectId)).status).toBe(
      404,
    );
  });

  it('MANAGER A cannot read Manager B personal history', async () => {
    expect((await history(managerAToken, managerBPersonalSubjectId)).status).toBe(
      404,
    );
  });

  it('MANAGER A cannot read OWNER-direct employee history', async () => {
    expect((await history(managerAToken, ownerDirectSubjectId)).status).toBe(
      404,
    );
  });

  it('MANAGER A can read own personal and current team history', async () => {
    expect((await history(managerAToken, managerAPersonalSubjectId)).status).toBe(
      200,
    );
    expect((await history(managerAToken, teamAEmployeeSubjectId)).status).toBe(
      200,
    );
  });

  it('OWNER keeps company-wide authorized history', async () => {
    expect((await history(ownerToken, teamBEmployeeSubjectId)).status).toBe(200);
    expect((await history(ownerToken, managerBPersonalSubjectId)).status).toBe(
      200,
    );
    expect((await history(ownerToken, ownerDirectSubjectId)).status).toBe(200);
  });

  it('EMPLOYEE cannot read another employee history', async () => {
    expect((await history(employeeAToken, teamBEmployeeSubjectId)).status).toBe(
      404,
    );
    expect((await history(employeeAToken, teamAEmployeeSubjectId)).status).toBe(
      200,
    );
    expect((await history(employeeBToken, teamAEmployeeSubjectId)).status).toBe(
      404,
    );
  });

  it('unauthorized responses expose no client/property contact details', async () => {
    const clientResponse = await history(managerAToken, teamBEmployeeSubjectId);
    expect(clientResponse.status).toBe(404);
    expect(JSON.stringify(clientResponse.body)).not.toContain(secretClientPhone);

    const propertyResponse = await history(
      managerAToken,
      teamBPropertySubjectId,
    );
    expect(propertyResponse.status).toBe(404);
    expect(JSON.stringify(propertyResponse.body)).not.toContain(
      secretContactPhone,
    );
  });

  it('reassignment immediately updates manager history visibility', async () => {
    await ctx.prisma.employeeProfile.update({
      where: { id: employeeBProfileId },
      data: { managerUserId: managerAId },
    });

    expect((await history(managerAToken, teamBEmployeeSubjectId)).status).toBe(
      200,
    );
    expect((await history(managerBToken, teamBEmployeeSubjectId)).status).toBe(
      404,
    );
    // Reassignment does not transfer the former manager's personal subject.
    expect(
      (await history(managerAToken, managerBPersonalSubjectId)).status,
    ).toBe(404);
    expect(
      (await history(managerBToken, managerBPersonalSubjectId)).status,
    ).toBe(200);
  });
});
