import { resolveAuthCookieConfig } from '../src/auth/auth-cookie.config';

describe('Auth cookie configuration', () => {
  it('defaults to legacy with safe local cookie names', () => {
    const config = resolveAuthCookieConfig({
      mode: 'legacy',
      nodeEnv: 'test',
      frontendOrigin: 'http://localhost:3001',
      accessTtlSeconds: 900,
    });
    expect(config.mode).toBe('legacy');
    expect(config.secure).toBe(false);
    expect(config.accessName).toBe('arkan_dev_access');
    expect(config.refreshName).toBe('arkan_dev_refresh');
    expect(config.csrfName).toBe('arkan_dev_csrf');
    expect(config.sameSite).toBe('Lax');
    expect(config.accessPath).toBe('/');
    expect(config.refreshPath).toBe('/auth');
    expect(config.accessMaxAgeMs).toBe(900_000);
    expect(config.refreshMaxAgeMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('uses Secure host-only production names and flags', () => {
    const config = resolveAuthCookieConfig({
      mode: 'cookie',
      nodeEnv: 'production',
      frontendOrigin: 'https://app.example.com,https://admin.example.com',
      accessTtlSeconds: 900,
    });
    expect(config.mode).toBe('cookie');
    expect(config.secure).toBe(true);
    expect(config.accessName).toBe('__Host-arkan_access');
    expect(config.refreshName).toBe('__Secure-arkan_refresh');
    expect(config.csrfName).toBe('__Host-arkan_csrf');
    expect(config.sameSite).toBe('Lax');
    expect(config.allowedOrigins).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
    ]);
    expect(config.allowedOrigins).not.toContain('http://localhost:3000');
  });

  it('fails closed when production cookies are not Secure', () => {
    expect(() =>
      resolveAuthCookieConfig({
        mode: 'cookie',
        nodeEnv: 'production',
        secure: false,
        frontendOrigin: 'https://app.example.com',
      }),
    ).toThrow(/COOKIE_SECURE must be true/);
  });

  it('fails closed for an HTTP production frontend origin', () => {
    expect(() =>
      resolveAuthCookieConfig({
        mode: 'dual',
        nodeEnv: 'production',
        frontendOrigin: 'http://app.example.com',
      }),
    ).toThrow(/must use HTTPS/);
  });

  it('rejects an unknown mode', () => {
    expect(() =>
      resolveAuthCookieConfig({
        mode: 'not-a-mode',
        nodeEnv: 'test',
        frontendOrigin: 'http://localhost:3001',
      }),
    ).toThrow(/AUTH_COOKIE_MODE/);
  });

  it('honours an explicit local Secure override without changing dev names', () => {
    const config = resolveAuthCookieConfig({
      mode: 'dual',
      nodeEnv: 'test',
      secure: 'true',
      frontendOrigin: 'http://localhost:3001',
    });
    expect(config.secure).toBe(true);
    expect(config.accessName).toBe('arkan_dev_access');
  });
});
