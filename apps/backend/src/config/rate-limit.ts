/**
 * Rate-limit policy helpers.
 *
 * All limits are read at request time, so a deployment can tune them through
 * environment variables without rebuilding. Values are bounded to avoid a
 * typo disabling protection or creating an unbounded window.
 */

const DEFAULT_WINDOW_SECONDS = 60;
const MAX_WINDOW_SECONDS = 3600;
const MAX_LIMIT = 100_000;

function readInt(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

/** The shared rate-limit window. Set RATE_LIMIT_WINDOW_SECONDS for tests/ops. */
export function rateLimitWindowMs(): number {
  return (
    readInt(
      'RATE_LIMIT_WINDOW_SECONDS',
      DEFAULT_WINDOW_SECONDS,
      1,
      MAX_WINDOW_SECONDS,
    ) * 1000
  );
}

/** Returns a resolver for a named policy, e.g. rateLimit('LOGIN', 10). */
export function rateLimit(name: string, fallback: number) {
  return () => readInt(`RATE_LIMIT_${name}_PER_MIN`, fallback, 1, MAX_LIMIT);
}

export const RATE_LIMIT_DEFAULTS = {
  global: 600,
  login: 10,
  refresh: 30,
  csrf: 60,
  expensiveRead: 120,
  upload: 20,
  pushRegister: 20,
  pushTest: 5,
} as const;
