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

interface EmployeeDto {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  phone: string | null;
  hiredAt: string | null;
  baseSalary: string | null;
  propertyCount: number;
  propertiesByStatus: Record<string, number>;
  properties: { id: string; reference: string; title: string; status: string }[];
}

/**
 * The manager-only employee directory over the REAL Nest application and the
 * ISOLATED test database. It proves the endpoint only ever lists EMPLOYEE-role
 * accounts, that its property statistics come from `Property.createdByUserId`,
 * that renaming a user is reflected by the property responsible pill without
 * touching `Property` rows, and that no credential ever leaves the API.
 */
describeWithDatabase('Employees directory API', () => {
  let ctx: TestContext;
  let managerId: string;
  let employeeAId: string;
  let employeeBId: string;
  let managerToken: string;
  let employeeAToken: string;

  const api = () => request(ctx.app.getHttpServer());

  const payload = (overrides: Record<string, unknown> = {}) => ({
    listingType: 'SALE',
    governorate: 'الفروانية',
    district: 'غرناطة',
    block: '3',
    plotNumber: '12',
    sizeSqm: '400.00',
    askingPrice: '250000.00',
    negotiable: true,
    description: 'بيت مستقل للبيع',
    floors: [{ type: 'GROUND', details: 'صالة ومجلس' }],
    newContact: { type: 'BROKER', name: 'وسيط', phone: '66661111' },
    ...overrides,
  });

  const createProperty = async (
    token: string,
    overrides: Record<string, unknown> = {},
  ) => {
    const response = await postProperty(ctx.app, token, payload(overrides), image);
    expect(response.status).toBe(201);
    return response.body.data as { id: string; reference: string };
  };

  const list = async (token: string): Promise<EmployeeDto[]> => {
    const response = await api().get('/employees').set(auth(token));
    expect(response.status).toBe(200);
    return response.body.data.items as EmployeeDto[];
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'manager@employees.local',
      name: 'Manager One',
      role: Role.MANAGER,
    });
    const employeeA = await createUser(ctx.prisma, {
      email: 'employee.a@employees.local',
      name: 'Employee A',
      role: Role.EMPLOYEE,
    });
    const employeeB = await createUser(ctx.prisma, {
      email: 'employee.b@employees.local',
      name: 'Employee B',
      role: Role.EMPLOYEE,
    });
    await createUser(ctx.prisma, {
      email: 'employee.c@employees.local',
      name: 'Employee C',
      role: Role.EMPLOYEE,
    });
    managerId = manager.id;
    employeeAId = employeeA.id;
    employeeBId = employeeB.id;
    managerToken = await login(ctx.app, manager.email);
    employeeAToken = await login(ctx.app, employeeA.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('requires a session and refuses an employee', async () => {
    expect((await api().get('/employees')).status).toBe(401);
    expect((await api().get('/employees').set(auth(employeeAToken))).status).toBe(
      403,
    );
    expect(
      (
        await api()
          .patch(`/employees/${employeeAId}`)
          .set(auth(employeeAToken))
          .send({ name: 'hacked' })
      ).status,
    ).toBe(403);
    expect(
      (
        await api()
          .post('/employees')
          .set(auth(employeeAToken))
          .send({
            name: 'x',
            email: 'x@employees.local',
            password: 'TempPass123!',
            role: 'EMPLOYEE',
          })
      ).status,
    ).toBe(403);
  });

  it('lists only EMPLOYEE-role accounts and never leaks a credential', async () => {
    const items = await list(managerToken);
    expect(items.map((item) => item.email).sort()).toEqual([
      'employee.a@employees.local',
      'employee.b@employees.local',
      'employee.c@employees.local',
    ]);
    expect(items.every((item) => item.role === 'EMPLOYEE')).toBe(true);
    expect(items.some((item) => item.id === managerId)).toBe(false);
    const body = JSON.stringify(items);
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('scrypt-v1$');
  });

  it('derives the property statistics from Property.createdByUserId', async () => {
    await createProperty(employeeAToken, { district: 'غرناطة' });
    await createProperty(employeeAToken, { district: 'الفنطاس' });

    const employee = (await list(managerToken)).find(
      (item) => item.id === employeeAId,
    )!;
    expect(employee.propertyCount).toBe(2);
    expect(employee.propertiesByStatus.PENDING).toBe(2);
    expect(employee.properties).toHaveLength(2);
    expect(employee.properties.every((p) => p.status === 'PENDING')).toBe(true);

    const other = (await list(managerToken)).find(
      (item) => item.id === employeeBId,
    )!;
    expect(other.propertyCount).toBe(0);
    expect(other.properties).toEqual([]);
  });

  it('renames the display name and keeps the property pill in sync', async () => {
    const property = await createProperty(employeeAToken, {
      district: 'الجهراء',
    });
    const before = await ctx.prisma.property.findUniqueOrThrow({
      where: { id: property.id },
      select: { createdByUserId: true, version: true, status: true },
    });

    const response = await api()
      .patch(`/employees/${employeeAId}`)
      .set(auth(managerToken))
      .send({ name: 'Renamed Employee' });
    expect(response.status).toBe(200);
    expect((response.body.data as EmployeeDto).name).toBe('Renamed Employee');

    // Persisted, and every identity field stayed put.
    const stored = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: employeeAId },
      select: { name: true, email: true, role: true, passwordHash: true },
    });
    expect(stored.name).toBe('Renamed Employee');
    expect(stored.email).toBe('employee.a@employees.local');
    expect(stored.role).toBe('EMPLOYEE');
    expect(stored.passwordHash.startsWith('scrypt-v1$')).toBe(true);

    // The creator, version and status of the property are untouched…
    const after = await ctx.prisma.property.findUniqueOrThrow({
      where: { id: property.id },
      select: { createdByUserId: true, version: true, status: true },
    });
    expect(after).toEqual(before);

    // …yet the responsible pill derives the NEW name on the next read.
    const read = await api()
      .get(`/properties/${property.id}`)
      .set(auth(managerToken));
    expect(read.status).toBe(200);
    expect(read.body.data.responsibleName).toBe('Renamed Employee');
    expect(read.body.data.responsibleRole).toBe('EMPLOYEE');

    // And the account can still log in with its original password.
    expect(await login(ctx.app, 'employee.a@employees.local')).toBeTruthy();
  });

  it('refuses to rename a non-employee and rejects an empty name', async () => {
    expect(
      (
        await api()
          .patch(`/employees/${managerId}`)
          .set(auth(managerToken))
          .send({ name: 'Manager Renamed' })
      ).status,
    ).toBe(404);
    expect(
      (
        await api()
          .patch('/employees/not-a-uuid')
          .set(auth(managerToken))
          .send({ name: 'x' })
      ).status,
    ).toBe(400);
    expect(
      (
        await api()
          .patch(`/employees/${employeeBId}`)
          .set(auth(managerToken))
          .send({ name: '' })
      ).status,
    ).toBe(400);
  });

  it('creates a real, loggable-in account and persists the profile', async () => {
    const response = await api()
      .post('/employees')
      .set(auth(managerToken))
      .send({
        name: 'Fresh Hire',
        email: 'Fresh.Hire@employees.local',
        password: 'TempPass123!',
        role: 'EMPLOYEE',
        phone: '5000 1234',
        hiredAt: '2026-01-05',
        baseSalary: 900,
      });
    expect(response.status).toBe(201);
    const created = response.body.data as EmployeeDto;
    expect(created.email).toBe('fresh.hire@employees.local');
    expect(created.phone).toBe('5000 1234');
    expect(created.hiredAt?.startsWith('2026-01-05')).toBe(true);
    expect(Number(created.baseSalary)).toBe(900);
    expect(JSON.stringify(created)).not.toContain('passwordHash');

    // The new account really works against the existing login flow, with the
    // custom password the manager chose.
    const signIn = await api()
      .post('/auth/login')
      .send({ email: 'fresh.hire@employees.local', password: 'TempPass123!' });
    expect(signIn.status).toBe(200);
    expect(signIn.body.data.accessToken).toBeTruthy();

    // It shows up in the directory (empty property stats, real zero).
    const listed = (await list(managerToken)).find(
      (item) => item.id === created.id,
    )!;
    expect(listed.propertyCount).toBe(0);

    // Duplicate email is refused rather than overwritten.
    const duplicate = await api()
      .post('/employees')
      .set(auth(managerToken))
      .send({
        name: 'Other',
        email: 'fresh.hire@employees.local',
        password: 'TempPass123!',
        role: 'EMPLOYEE',
      });
    expect(duplicate.status).toBe(409);

    // An unknown role is rejected by validation.
    const badRole = await api()
      .post('/employees')
      .set(auth(managerToken))
      .send({
        name: 'Other',
        email: 'other@employees.local',
        password: 'TempPass123!',
        role: 'ADMIN',
      });
    expect(badRole.status).toBe(400);
  });

  it('never matches an employee by display name', async () => {
    // A second employee sharing the exact display name of another must stay a
    // distinct row with its own statistics.
    await api()
      .post('/employees')
      .set(auth(managerToken))
      .send({
        name: 'Employee B',
        email: 'twin@employees.local',
        password: 'TempPass123!',
        role: 'EMPLOYEE',
      });
    const items = await list(managerToken);
    const twins = items.filter((item) => item.name === 'Employee B');
    expect(twins).toHaveLength(2);
    expect(new Set(twins.map((item) => item.id)).size).toBe(2);
  });
});
