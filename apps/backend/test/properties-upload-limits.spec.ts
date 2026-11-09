import { Role } from '@arkan/shared';
import request from 'supertest';
import {
  auth,
  createTestApp,
  createUser,
  describeWithDatabase,
  login,
  pngBytes,
  resetDatabase,
  type TestContext,
} from './support/test-app';

jest.setTimeout(120000);

describeWithDatabase('Property upload multipart envelope limits', () => {
  let ctx: TestContext;
  let token: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const employee = await createUser(ctx.prisma, {
      email: 'upload-limits@test.local',
      name: 'Upload Limits',
      role: Role.EMPLOYEE,
    });
    token = await login(ctx.app, employee.email);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('rejects a multipart request with too many text fields', async () => {
    const payload = JSON.stringify({
      listingType: 'SALE',
      governorate: 'الفنطاس',
      district: 'الفنطاس',
      block: '9',
      plotNumber: '9090',
      newContact: { type: 'OWNER', name: 'Owner', phone: '90009000' },
    });

    let builder = request(ctx.app.getHttpServer())
      .post('/properties')
      .set(auth(token))
      .field('payload', payload)
      .attach('image', pngBytes(), 'photo.png');
    for (let index = 0; index < 12; index += 1) {
      builder = builder.field(`extra${index}`, 'value');
    }

    const response = await builder;
    expect(response.status).toBe(400);
    expect(await ctx.prisma.property.count()).toBe(0);
  });
});
