import { environmentSchema } from '../src/config/environment';

describe('Environment validation', () => {
  const valid = {
    FRONTEND_ORIGIN: 'http://localhost:3000',
    DATABASE_URL: 'postgresql://user:password@localhost:5432/arkan',
    REDIS_HOST: 'localhost',
    JWT_ACCESS_SECRET: 'test-secret-that-is-at-least-32-characters',
    JWT_ISSUER: 'arkan-api',
    JWT_AUDIENCE: 'arkan-web',
  };
  it('accepts valid settings and supplies defaults', () => {
    const result = environmentSchema.validate(valid);
    expect(result.error).toBeUndefined();
    expect(result.value.PORT).toBe(4000);
  });
  it('rejects missing or example secrets and invalid ports', () => {
    expect(
      environmentSchema.validate({ ...valid, JWT_ACCESS_SECRET: undefined })
        .error,
    ).toBeDefined();
    expect(
      environmentSchema.validate({
        ...valid,
        JWT_ACCESS_SECRET: 'replace-with-random-secret-at-least-32-characters',
      }).error,
    ).toBeDefined();
    expect(
      environmentSchema.validate({ ...valid, PORT: 99999 }).error,
    ).toBeDefined();
  });
});
