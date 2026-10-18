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

jest.setTimeout(60000);

describeWithDatabase('Contacts API (real authorization, isolated DB)', () => {
  let ctx: TestContext;
  let managerId: string;
  let employeeAId: string;
  let employeeBId: string;
  let managerToken: string;
  let employeeAToken: string;
  let employeeBToken: string;
  const api = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const manager = await createUser(ctx.prisma, {
      email: 'manager@test.local',
      name: 'Manager',
      role: Role.MANAGER,
    });
    const employeeA = await createUser(ctx.prisma, {
      email: 'employee.a@test.local',
      name: 'Employee A',
      role: Role.EMPLOYEE,
    });
    const employeeB = await createUser(ctx.prisma, {
      email: 'employee.b@test.local',
      name: 'Employee B',
      role: Role.EMPLOYEE,
    });
    managerId = manager.id;
    employeeAId = employeeA.id;
    employeeBId = employeeB.id;
    managerToken = await login(ctx.app, manager.email);
    employeeAToken = await login(ctx.app, employeeA.email);
    employeeBToken = await login(ctx.app, employeeB.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('rejects unauthenticated access', async () => {
    const response = await api().get('/contacts');
    expect(response.status).toBe(401);
  });

  it('lets the manager create an OWNER contact as a company record', async () => {
    const response = await api()
      .post('/contacts')
      .set(auth(managerToken))
      .send({ type: 'OWNER', name: 'Owner Co', phone: '22223333' });
    expect(response.status).toBe(201);
    expect(response.body.data.type).toBe('OWNER');
    expect(response.body.data.responsibleUserId).toBeNull();
    expect(managerId).toBeTruthy();
  });

  it('lets an employee create a BROKER contact owned by that employee', async () => {
    const response = await api()
      .post('/contacts')
      .set(auth(employeeAToken))
      .send({ type: 'BROKER', name: 'Broker A', phone: '66661111' });
    expect(response.status).toBe(201);
    expect(response.body.data.responsibleUserId).toBe(employeeAId);
  });

  it('rejects an invalid contact type and a missing phone', async () => {
    const badType = await api()
      .post('/contacts')
      .set(auth(employeeAToken))
      .send({ type: 'PARTNER', name: 'X', phone: '66660000' });
    expect(badType.status).toBe(400);
    const noPhone = await api()
      .post('/contacts')
      .set(auth(employeeAToken))
      .send({ type: 'OWNER', name: 'X' });
    expect(noPhone.status).toBe(400);
  });

  it('lets an employee list ONLY their own contacts', async () => {
    const aContact = await api()
      .post('/contacts')
      .set(auth(employeeAToken))
      .send({ type: 'OWNER', name: 'A Owner', phone: '60000001' });
    const bContact = await api()
      .post('/contacts')
      .set(auth(employeeBToken))
      .send({ type: 'OWNER', name: 'B Owner', phone: '60000002' });
    const list = await api().get('/contacts').set(auth(employeeAToken));
    expect(list.status).toBe(200);
    const ids = list.body.data.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(aContact.body.data.id);
    expect(ids).not.toContain(bContact.body.data.id);
    expect(
      list.body.data.items.every(
        (item: { responsibleUserId: string }) =>
          item.responsibleUserId === employeeAId,
      ),
    ).toBe(true);
    expect(employeeBId).toBeTruthy();
  });

  it('never lets an employee read another employee contact by id', async () => {
    const bContact = await api()
      .post('/contacts')
      .set(auth(employeeBToken))
      .send({ type: 'BROKER', name: 'B Broker', phone: '60000003' });
    const read = await api()
      .get(`/contacts/${bContact.body.data.id}`)
      .set(auth(employeeAToken));
    expect(read.status).toBe(404);
  });

  it('never lets an employee update another employee contact', async () => {
    const bContact = await api()
      .post('/contacts')
      .set(auth(employeeBToken))
      .send({ type: 'BROKER', name: 'B Broker 2', phone: '60000004' });
    const patched = await api()
      .patch(`/contacts/${bContact.body.data.id}`)
      .set(auth(employeeAToken))
      .send({ name: 'hijacked' });
    expect(patched.status).toBe(404);
    const still = await ctx.prisma.contact.findUnique({
      where: { id: bContact.body.data.id },
    });
    expect(still?.name).toBe('B Broker 2');
  });

  it('lets the manager read every employee contact', async () => {
    const aContact = await api()
      .post('/contacts')
      .set(auth(employeeAToken))
      .send({ type: 'OWNER', name: 'A Owner 2', phone: '60000005' });
    const read = await api()
      .get(`/contacts/${aContact.body.data.id}`)
      .set(auth(managerToken));
    expect(read.status).toBe(200);
    expect(read.body.data.name).toBe('A Owner 2');
  });

  it('fails closed when an employee guesses a company/manager contact id', async () => {
    const companyContact = await api()
      .post('/contacts')
      .set(auth(managerToken))
      .send({ type: 'OWNER', name: 'Company Owner', phone: '60000006' });
    const read = await api()
      .get(`/contacts/${companyContact.body.data.id}`)
      .set(auth(employeeAToken));
    expect(read.status).toBe(404);
  });

  it('prevents an employee from attaching another employee contact to a property', async () => {
    const ownedByA = await api()
      .post('/contacts')
      .set(auth(employeeAToken))
      .send({ type: 'OWNER', name: 'A Only', phone: '60000007' });
    const response = await postProperty(
      ctx.app,
      employeeBToken,
      {
        listingType: 'SALE',
        district: 'غرناطة',
        contactId: ownedByA.body.data.id,
      },
      [{ buffer: pngBytes(), filename: 'a.png' }],
    );
    expect(response.status).toBe(404);
  });
});
