import {
  buildCspPolicy,
  cspPolicyFromEnvironment,
  isSafeNonce,
  resolveCspMode,
  toHttpOrigin,
} from '../../frontend/lib/csp';

const PROD = {
  isDev: false,
  apiUrl: 'https://api.arkan.example/v1',
};

function directive(policy: ReturnType<typeof buildCspPolicy>, name: string) {
  return policy?.directives[name] ?? [];
}

describe('CSP mode and origin resolution', () => {
  it('defaults unknown/missing modes to off', () => {
    expect(resolveCspMode(undefined)).toBe('off');
    expect(resolveCspMode('')).toBe('off');
    expect(resolveCspMode('whatever')).toBe('off');
    expect(resolveCspMode('REPORT-ONLY')).toBe('report-only');
    expect(resolveCspMode('enforce')).toBe('enforce');
  });

  it('accepts only bare HTTP(S) origins', () => {
    expect(toHttpOrigin('http://localhost:4001/path?x=1')).toBe(
      'http://localhost:4001',
    );
    expect(toHttpOrigin('https://api.arkan.example')).toBe(
      'https://api.arkan.example',
    );
    expect(toHttpOrigin('ws://localhost:4001')).toBeNull();
    expect(toHttpOrigin('javascript:alert(1)')).toBeNull();
    expect(toHttpOrigin('https://user:pass@api.arkan.example')).toBeNull();
    expect(toHttpOrigin('not a url')).toBeNull();
  });

  it('rejects unsafe nonces', () => {
    expect(isSafeNonce('a'.repeat(24))).toBe(true);
    expect(isSafeNonce('bad nonce with spaces')).toBe(false);
    expect(isSafeNonce('bad;report-uri=x')).toBe(false);
    expect(isSafeNonce('short')).toBe(false);
  });
});

describe('CSP production policy', () => {
  it('builds a strict report-only policy with no script unsafe-inline', () => {
    const policy = buildCspPolicy({ ...PROD, mode: 'report-only' });
    expect(policy?.headerName).toBe('Content-Security-Policy-Report-Only');
    expect(directive(policy, 'script-src')).toEqual(["'self'"]);
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'");
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-eval'");
    expect(policy?.value).not.toContain("script-src 'unsafe-inline'");
    expect(policy?.value).not.toMatch(/(^|\s)\*(\s|;|$)/);
  });

  it('builds an enforcing policy with the required hard directives', () => {
    const policy = buildCspPolicy({ ...PROD, mode: 'enforce' });
    expect(policy?.headerName).toBe('Content-Security-Policy');
    expect(directive(policy, 'object-src')).toEqual(["'none'"]);
    expect(directive(policy, 'base-uri')).toEqual(["'self'"]);
    expect(directive(policy, 'frame-ancestors')).toEqual(["'none'"]);
    expect(directive(policy, 'frame-src')).toEqual(["'none'"]);
    expect(directive(policy, 'form-action')).toEqual(["'self'"]);
    expect(directive(policy, 'script-src-attr')).toEqual(["'none'"]);
    expect(directive(policy, 'worker-src')).toEqual(["'self'"]);
    expect(policy?.directives['upgrade-insecure-requests']).toEqual([]);
  });

  it('derives connect-src from the validated API origin only', () => {
    const policy = buildCspPolicy({ ...PROD, mode: 'enforce' });
    expect(directive(policy, 'connect-src')).toEqual([
      "'self'",
      'https://api.arkan.example',
    ]);
    expect(policy?.value).not.toContain('localhost:3001');
    expect(policy?.value).not.toContain('*');
  });

  it('allows the known external font and blob image sources', () => {
    const policy = buildCspPolicy({ ...PROD, mode: 'enforce' });
    expect(directive(policy, 'style-src-elem')).toContain(
      'https://fonts.googleapis.com',
    );
    expect(directive(policy, 'font-src')).toContain(
      'https://fonts.gstatic.com',
    );
    expect(directive(policy, 'img-src')).toEqual([
      "'self'",
      'blob:',
      'data:',
    ]);
    // Narrow style exception for React style attributes only.
    expect(directive(policy, 'style-src-attr')).toEqual(["'unsafe-inline'"]);
  });

  it('adds a nonce and strict-dynamic when provided', () => {
    const nonce = 'a'.repeat(32);
    const policy = buildCspPolicy({ ...PROD, mode: 'enforce', nonce });
    expect(directive(policy, 'script-src')).toEqual([
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
    ]);
    expect(directive(policy, 'style-src-elem')).toContain(`'nonce-${nonce}'`);
    expect(policy?.value).not.toContain("'unsafe-inline' 'nonce");
  });

  it('ignores an injected/invalid nonce instead of emitting it', () => {
    const policy = buildCspPolicy({
      ...PROD,
      mode: 'enforce',
      nonce: "x'; report-uri https://evil.example",
    });
    expect(policy?.value).not.toContain('evil.example');
    expect(directive(policy, 'script-src')).toEqual(["'self'"]);
  });

  it('adds a valid report-uri only', () => {
    const policy = buildCspPolicy({
      ...PROD,
      mode: 'report-only',
      reportUri: 'https://csp.arkan.example/report',
    });
    expect(directive(policy, 'report-uri')).toEqual([
      'https://csp.arkan.example/report',
    ]);
    const invalid = buildCspPolicy({
      ...PROD,
      mode: 'report-only',
      reportUri: 'javascript:alert(1)',
    });
    expect(invalid?.directives['report-uri']).toBeUndefined();
  });
});

describe('CSP development policy', () => {
  it('adds only the development eval/HMR allowances', () => {
    const policy = buildCspPolicy({
      mode: 'report-only',
      isDev: true,
      apiUrl: 'http://localhost:4001',
    });
    expect(directive(policy, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'");
    expect(directive(policy, 'connect-src')).toContain(
      'ws://localhost:3001',
    );
    expect(directive(policy, 'connect-src')).toContain(
      'http://localhost:4001',
    );
    expect(policy?.directives['upgrade-insecure-requests']).toBeUndefined();
  });
});

describe('CSP environment configuration', () => {
  it('returns null when disabled', () => {
    expect(
      cspPolicyFromEnvironment({
        NODE_ENV: 'production',
        CSP_MODE: 'off',
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it('uses report-only plus the configured API origin', () => {
    const policy = cspPolicyFromEnvironment({
      NODE_ENV: 'production',
      CSP_MODE: 'report-only',
      NEXT_PUBLIC_API_URL: 'https://api.arkan.example',
    } as NodeJS.ProcessEnv);
    expect(policy?.headerName).toBe('Content-Security-Policy-Report-Only');
    expect(directive(policy, 'connect-src')).toEqual([
      "'self'",
      'https://api.arkan.example',
    ]);
  });

  it('never emits a wildcard when the API URL is invalid', () => {
    const policy = cspPolicyFromEnvironment({
      NODE_ENV: 'production',
      CSP_MODE: 'enforce',
      NEXT_PUBLIC_API_URL: 'https://*.example.com',
    } as NodeJS.ProcessEnv);
    expect(directive(policy, 'connect-src')).toEqual(["'self'"]);
    expect(policy?.value).not.toContain('*');
  });
});
