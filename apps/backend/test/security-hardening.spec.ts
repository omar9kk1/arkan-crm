import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Public } from '../src/auth/decorators/public.decorator';
import { configureApp } from '../src/common/configure-app';

@Public()
@Controller('security-probe')
class SecurityProbeController {
  @Get()
  ok() {
    return { allowed: true };
  }
}

describe('Baseline security headers', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SecurityProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets the non-breaking hardening headers on every response', async () => {
    const response = await request(app.getHttpServer())
      .get('/security-probe')
      .expect(200);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['permissions-policy']).toBe(
      'camera=(), microphone=(), geolocation=()',
    );
  });

  it('does not advertise the Express framework', async () => {
    const response = await request(app.getHttpServer())
      .get('/security-probe')
      .expect(200);
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
