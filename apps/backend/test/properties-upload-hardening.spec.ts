import { Role } from '@arkan/shared';
import http from 'node:http';
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

function payload(plotNumber: string, phone: string) {
  return {
    listingType: 'SALE',
    governorate: 'الفنطاس',
    district: 'الفنطاس',
    block: '6',
    plotNumber,
    sizeSqm: '300.00',
    askingPrice: '150000.00',
    negotiable: true,
    description: 'بيت للاختبار',
    floors: [{ type: 'GROUND', details: 'مجلس' }],
    newContact: { type: 'OWNER', name: 'Owner Test', phone },
  };
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describeWithDatabase('Property upload hardening', () => {
  let ctx: TestContext;
  let token: string;
  let port: number;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const employee = await createUser(ctx.prisma, {
      email: 'upload-hardening@test.local',
      name: 'Upload Hardening',
      role: Role.EMPLOYEE,
    });
    token = await login(ctx.app, employee.email);
    // The raw aborted-request test needs a real listening socket. Supertest
    // reuses the same server for the remaining assertions.
    const server = ctx.app.getHttpServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('rejects a file under a malformed/unexpected field name', async () => {
    const response = await request(ctx.app.getHttpServer())
      .post('/properties')
      .set(auth(token))
      .field('payload', JSON.stringify(payload('6101', '91110001')))
      .attach('image[999999999]', pngBytes(), 'photo.png');

    expect(response.status).toBe(400);
    expect(await ctx.prisma.property.count()).toBe(0);
  });

  it('rejects an unexpected file field without leaving an orphan', async () => {
    const response = await request(ctx.app.getHttpServer())
      .post('/properties')
      .set(auth(token))
      .field('payload', JSON.stringify(payload('6102', '91110002')))
      .attach('image', pngBytes(), 'photo.png')
      .attach('anotherImage', pngBytes(), 'second.png');

    expect(response.status).toBe(400);
    expect(await ctx.prisma.property.count()).toBe(0);
  });

  it('survives an interrupted client upload and still accepts the next request', async () => {
    const boundary = '----arkan-upload-hardening';
    const preamble =
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="payload"\r\n\r\n' +
      `${JSON.stringify(payload('6103', '91110003'))}\r\n` +
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="image"; filename="photo.png"\r\n' +
      'Content-Type: image/png\r\n\r\n';
    const body = Buffer.from(preamble, 'utf8');
    const announcedLength = body.length + pngBytes().length + 64;

    await new Promise<void>((resolve) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/properties',
          method: 'POST',
          headers: {
            ...auth(token),
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': String(announcedLength),
          },
        },
        (res) => {
          res.resume();
          res.on('end', resolve);
        },
      );
      req.on('error', () => resolve());
      req.write(body);
      // Only part of the promised image arrives, then the client vanishes.
      req.write(pngBytes().subarray(0, 32));
      void wait(30).then(() => {
        req.destroy();
        resolve();
      });
    });
    await wait(150);

    // The process is still healthy and the aborted row was never committed.
    const next = await postProperty(
      ctx.app,
      token,
      payload('6104', '91110004'),
      image,
    );
    expect(next.status).toBe(201);
    expect(await ctx.prisma.property.count()).toBe(1);
    expect(
      await ctx.prisma.property.findFirst({
        where: { plotNumber: '6103' },
      }),
    ).toBeNull();
  });

  it('returns a controlled 400 for missing or malformed multipart boundaries', async () => {
    const before = await ctx.prisma.property.count();

    const missingBoundary = await request(ctx.app.getHttpServer())
      .post('/properties')
      .set(auth(token))
      .set('Content-Type', 'multipart/form-data')
      .send('--x\r\nContent-Disposition: form-data; name="payload"\r\n\r\n{}\r\n--x--');
    expect(missingBoundary.status).toBe(400);

    const wrongBoundary = await request(ctx.app.getHttpServer())
      .post('/properties')
      .set(auth(token))
      .set('Content-Type', 'multipart/form-data; boundary=expected')
      .send(
        '--different\r\nContent-Disposition: form-data; name="payload"\r\n\r\n{}\r\n--different--',
      );
    expect(wrongBoundary.status).toBe(400);

    expect(await ctx.prisma.property.count()).toBe(before);
  });

  it('handles a bounded set of concurrent uploads without dropping or duplicating rows', async () => {
    const jobs = Array.from({ length: 5 }, (_, index) =>
      postProperty(
        ctx.app,
        token,
        payload(String(6200 + index), `9222000${index}`),
        image,
      ),
    );
    const responses = await Promise.all(jobs);
    expect(responses.map((response) => response.status)).toEqual([
      201, 201, 201, 201, 201,
    ]);
    expect(
      await ctx.prisma.property.count({
        where: { plotNumber: { in: ['6200', '6201', '6202', '6203', '6204'] } },
      }),
    ).toBe(5);
  });
});
