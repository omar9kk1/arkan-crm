/* eslint-disable @typescript-eslint/no-require-imports -- jest.resetModules needs fresh module instances. */
class ApiError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

describe('Frontend authorized request', () => {
  let apiRequest: jest.Mock;
  let refreshAccessToken: jest.Mock;
  let ensureCsrfToken: jest.Mock;
  let usesCookieSession: jest.Mock;
  let getStoredAccessToken: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    process.env.NEXT_PUBLIC_AUTH_MODE = 'cookie';
    apiRequest = jest.fn();
    refreshAccessToken = jest.fn();
    ensureCsrfToken = jest.fn().mockResolvedValue('csrf-token');
    usesCookieSession = jest.fn().mockReturnValue(true);
    getStoredAccessToken = jest.fn().mockReturnValue(null);
    jest.doMock('../../frontend/lib/api-client', () => ({
      ApiError,
      apiRequest,
    }));
    jest.doMock('../../frontend/features/auth/session', () => ({
      ensureCsrfToken,
      getStoredAccessToken,
      refreshAccessToken,
      usesCookieSession,
    }));
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_AUTH_MODE;
    jest.dontMock('../../frontend/lib/api-client');
    jest.dontMock('../../frontend/features/auth/session');
  });

  function load() {
    return require('../../frontend/lib/api/authorized') as {
      authorizedRequest<T>(
        path: string,
        options?: Record<string, unknown>,
      ): Promise<T>;
    };
  }

  it('refreshes exactly once and retries after a 401', async () => {
    apiRequest
      .mockRejectedValueOnce(new ApiError(401))
      .mockResolvedValueOnce('ok');
    refreshAccessToken.mockResolvedValue(true);

    await expect(load().authorizedRequest('/clients')).resolves.toBe('ok');
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it('never treats a CSRF 403 as an expired session', async () => {
    apiRequest.mockRejectedValue(new ApiError(403));

    await expect(
      load().authorizedRequest('/clients', { method: 'POST' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('stops after one failed refresh instead of looping', async () => {
    apiRequest.mockRejectedValue(new ApiError(401));
    refreshAccessToken.mockResolvedValue(false);

    await expect(load().authorizedRequest('/clients')).rejects.toMatchObject({
      status: 401,
    });
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('bootstraps CSRF before an unsafe cookie-mode request', async () => {
    apiRequest.mockResolvedValue({ ok: true });

    await load().authorizedRequest('/clients', { method: 'POST' });
    expect(ensureCsrfToken).toHaveBeenCalledTimes(1);
  });

  it('does not bootstrap CSRF for safe GET requests', async () => {
    apiRequest.mockResolvedValue({ ok: true });

    await load().authorizedRequest('/clients');
    expect(ensureCsrfToken).not.toHaveBeenCalled();
  });
});
