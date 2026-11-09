/* eslint-disable @typescript-eslint/no-require-imports -- jest.resetModules needs fresh module instances. */
import { resolveAuthMode } from '../../frontend/lib/auth-mode';

describe('Frontend auth mode resolution', () => {
  it('defaults to legacy for missing/unknown values', () => {
    expect(resolveAuthMode(undefined)).toBe('legacy');
    expect(resolveAuthMode('')).toBe('legacy');
    expect(resolveAuthMode('something-else')).toBe('legacy');
  });

  it('accepts dual and cookie explicitly', () => {
    expect(resolveAuthMode('dual')).toBe('dual');
    expect(resolveAuthMode('COOKIE')).toBe('cookie');
  });
});

describe('API client cookie/CSRF transport', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const originalUrl = process.env.NEXT_PUBLIC_API_URL;
  const originalMode = process.env.NEXT_PUBLIC_AUTH_MODE;

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = originalUrl;
    if (originalMode === undefined) delete process.env.NEXT_PUBLIC_AUTH_MODE;
    else process.env.NEXT_PUBLIC_AUTH_MODE = originalMode;
    jest.resetModules();
  });

  it('sends credentials and X-CSRF-Token in cookie mode', async () => {
    process.env.NEXT_PUBLIC_AUTH_MODE = 'cookie';
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4001';
    jest.resetModules();
    const csrf = require('../../frontend/lib/api/csrf-store') as {
      setCsrfToken(value: string): void;
    };
    csrf.setCsrfToken('a'.repeat(43));
    let init: RequestInit | undefined;
    global.fetch = jest.fn(async (_url: unknown, options?: RequestInit) => {
      init = options;
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    const { apiRequest } = require('../../frontend/lib/api-client') as {
      apiRequest<T>(path: string, options?: Record<string, unknown>): Promise<T>;
    };
    await apiRequest('/clients', { method: 'POST', body: { name: 'x' } });

    expect(init?.credentials).toBe('include');
    expect((init?.headers as Record<string, string>)['X-CSRF-Token']).toBe(
      'a'.repeat(43),
    );
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('attaches CSRF to multipart uploads without overriding the boundary', async () => {
    process.env.NEXT_PUBLIC_AUTH_MODE = 'cookie';
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4001';
    jest.resetModules();
    const csrf = require('../../frontend/lib/api/csrf-store') as {
      setCsrfToken(value: string): void;
    };
    csrf.setCsrfToken('b'.repeat(43));
    let init: RequestInit | undefined;
    global.fetch = jest.fn(async (_url: unknown, options?: RequestInit) => {
      init = options;
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    const { apiRequest } = require('../../frontend/lib/api-client') as {
      apiRequest<T>(path: string, options?: Record<string, unknown>): Promise<T>;
    };
    const formData = new FormData();
    formData.append('image', new Blob(['x']), 'x.png');
    await apiRequest('/properties/p1/image', { method: 'POST', formData });

    expect(init?.credentials).toBe('include');
    expect((init?.headers as Record<string, string>)['X-CSRF-Token']).toBe(
      'b'.repeat(43),
    );
    expect(
      (init?.headers as Record<string, string>)['Content-Type'],
    ).toBeUndefined();
    expect(init?.body).toBe(formData);
  });

  it('keeps legacy requests credential-free and CSRF-free', async () => {
    process.env.NEXT_PUBLIC_AUTH_MODE = 'legacy';
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4001';
    jest.resetModules();
    let init: RequestInit | undefined;
    global.fetch = jest.fn(async (_url: unknown, options?: RequestInit) => {
      init = options;
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    const { apiRequest } = require('../../frontend/lib/api-client') as {
      apiRequest<T>(path: string, options?: Record<string, unknown>): Promise<T>;
    };
    await apiRequest('/clients', { method: 'POST', body: { name: 'x' } });

    expect(init?.credentials).toBe('omit');
    expect(
      (init?.headers as Record<string, string>)['X-CSRF-Token'],
    ).toBeUndefined();
  });
});
