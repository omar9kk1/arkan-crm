/**
 * Content Security Policy construction.
 *
 * The policy is deliberately built in one pure place so it can be unit-tested
 * and reviewed without starting Next.js. It is emitted by `next.config.ts`
 * (report-only/enforce) and can also be used by a future nonce proxy.
 */

export const CSP_MODES = ['off', 'report-only', 'enforce'] as const;
export type CspMode = (typeof CSP_MODES)[number];

export type CspHeaderName =
  | 'Content-Security-Policy'
  | 'Content-Security-Policy-Report-Only';

export interface CspPolicyInput {
  mode?: string | null;
  isDev: boolean;
  /** Public API base URL; only its validated HTTP(S) origin is used. */
  apiUrl?: string | null;
  /** Per-request nonce for a strict nonce-based enforcement build. */
  nonce?: string | null;
  /** Optional CSP report endpoint (http/https, no credentials). */
  reportUri?: string | null;
}

export interface CspPolicy {
  mode: Exclude<CspMode, 'off'>;
  headerName: CspHeaderName;
  value: string;
  directives: Record<string, readonly string[]>;
}

export function resolveCspMode(raw: string | null | undefined): CspMode {
  const value = raw?.trim().toLowerCase();
  return CSP_MODES.includes(value as CspMode)
    ? (value as CspMode)
    : 'off';
}

/** Returns a bare HTTP(S) origin, or null for anything invalid/unsafe. */
export function toHttpOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    if (url.hostname.includes('*') || url.hostname.startsWith('.'))
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Accepts only base64/base64url-ish nonces; never allow header injection. */
export function isSafeNonce(raw: string | null | undefined): raw is string {
  return Boolean(raw && /^[A-Za-z0-9+/=_-]{16,256}$/.test(raw));
}

function validReportUri(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (/[\s"'<>]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Builds the CSP for the current environment.
 *
 * - Development adds `'unsafe-eval'` (React dev diagnostics) and the local
 *   Next.js HMR WebSocket origins. These never appear in production.
 * - A nonce is included only when supplied and only together with
 *   `'strict-dynamic'`; `'unsafe-inline'` is never emitted for scripts.
 * - Style attributes are the one deliberate style exception: the app uses a
 *   small number of React `style={...}` props, which CSP3 governs through
 *   `style-src-attr`.
 */
export function buildCspPolicy(input: CspPolicyInput): CspPolicy | null {
  const mode = resolveCspMode(input.mode);
  if (mode === 'off') return null;

  const apiOrigin = toHttpOrigin(input.apiUrl);
  const nonce = isSafeNonce(input.nonce) ? input.nonce : null;
  const reportUri = validReportUri(input.reportUri);

  const script = ["'self'"];
  if (nonce) {
    script.push(`'nonce-${nonce}'`, "'strict-dynamic'");
  }
  if (input.isDev) script.push("'unsafe-eval'");

  const style = ["'self'", 'https://fonts.googleapis.com'];
  if (nonce) style.push(`'nonce-${nonce}'`);
  if (input.isDev) style.push("'unsafe-inline'");

  const connect = ["'self'"];
  if (apiOrigin) connect.push(apiOrigin);
  if (input.isDev) {
    // Next.js dev server HMR. Explicit hosts only; production never sees them.
    connect.push(
      'ws://localhost:3001',
      'http://localhost:3001',
      'ws://127.0.0.1:3001',
      'http://127.0.0.1:3001',
    );
  }

  const directives: Record<string, readonly string[]> = {
    'default-src': ["'self'"],
    'script-src': script,
    'script-src-attr': ["'none'"],
    'style-src': style,
    'style-src-elem': style,
    // Intentionally narrow: only inline style attributes, not scripts.
    'style-src-attr': ["'unsafe-inline'"],
    'img-src': ["'self'", 'blob:', 'data:'],
    'font-src': ["'self'", 'https://fonts.gstatic.com'],
    'connect-src': connect,
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'media-src': ["'self'"],
    'frame-src': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  if (!input.isDev) directives['upgrade-insecure-requests'] = [];
  if (reportUri) directives['report-uri'] = [reportUri];

  const value = Object.entries(directives)
    .map(([name, sources]) =>
      sources.length ? `${name} ${sources.join(' ')}` : name,
    )
    .join('; ');

  return {
    mode,
    headerName:
      mode === 'report-only'
        ? 'Content-Security-Policy-Report-Only'
        : 'Content-Security-Policy',
    value,
    directives,
  };
}

/** Reads the CSP environment for `next.config.ts`. */
export function cspPolicyFromEnvironment(
  env: NodeJS.ProcessEnv,
): CspPolicy | null {
  return buildCspPolicy({
    mode: env.CSP_MODE,
    isDev: env.NODE_ENV !== 'production',
    apiUrl: env.NEXT_PUBLIC_API_URL,
    reportUri: env.CSP_REPORT_URI,
  });
}
