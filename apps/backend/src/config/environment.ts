import Joi from 'joi';

const INSECURE_JWT_SECRET_PATTERNS = [
  /change[_-]?later/i,
  /replace[-_]?with/i,
  /change[-_]?me/i,
  /placeholder/i,
  /^(.)\1+$/,
  /^(qwerty|asdfgh|123456|abcdef)/i,
];

export const environmentSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(4000),
  FRONTEND_ORIGIN: Joi.string()
    .custom((value: string, helpers) => {
      const origins = value.split(',').map((origin) => origin.trim());
      if (
        origins.some((origin) => {
          try {
            const url = new URL(origin);
            return (
              !['http:', 'https:'].includes(url.protocol) ||
              url.origin !== origin
            );
          } catch {
            return true;
          }
        })
      )
        return helpers.error('any.invalid');
      return origins.join(',');
    })
    .required(),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  JWT_ACCESS_SECRET: Joi.string()
    .min(32)
    .invalid(
      'replace-with-random-secret-at-least-32-characters',
      'dev_access_secret_change_later_please_make_it_long',
    )
    .custom((value: string, helpers) => {
      if (INSECURE_JWT_SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
        return helpers.error('any.invalid');
      }
      return value;
    })
    .required(),
  JWT_ACCESS_TTL_SECONDS: Joi.number().integer().min(60).max(3600).default(900),
  JWT_ISSUER: Joi.string().required(),
  JWT_AUDIENCE: Joi.string().required(),
  /**
   * legacy (default) keeps the existing Bearer/sessionStorage behavior.
   * dual issues cookies only when the client proves CSRF and keeps legacy
   * tokens available; cookie is the future secure mode with no token JSON.
   */
  AUTH_COOKIE_MODE: Joi.string()
    .valid('legacy', 'dual', 'cookie')
    .default('legacy'),
  /** Explicit override for local HTTPS testing; production must be true. */
  COOKIE_SECURE: Joi.boolean().optional(),
  // Optional private storage root for uploaded property images. When unset the
  // StorageService falls back to `<home>/.arkan-crm/storage` (outside the repo).
  STORAGE_ROOT: Joi.string().optional(),
  // Rate limiting / proxy topology. Trust proxy stays disabled unless the
  // owner supplies explicit proxy IP/CIDR entries.
  TRUST_PROXY: Joi.string().allow('').optional(),
  RATE_LIMIT_STORAGE: Joi.string().valid('memory', 'redis').default('memory'),
  RATE_LIMIT_WINDOW_SECONDS: Joi.number().integer().min(1).max(3600).optional(),
  RATE_LIMIT_GLOBAL_PER_MIN: Joi.number().integer().min(1).max(100000).optional(),
  RATE_LIMIT_LOGIN_PER_MIN: Joi.number().integer().min(1).max(100000).optional(),
  RATE_LIMIT_REFRESH_PER_MIN: Joi.number().integer().min(1).max(100000).optional(),
  RATE_LIMIT_CSRF_PER_MIN: Joi.number().integer().min(1).max(100000).optional(),
  RATE_LIMIT_EXPENSIVE_READ_PER_MIN: Joi.number().integer().min(1).max(100000).optional(),
  RATE_LIMIT_UPLOAD_PER_MIN: Joi.number().integer().min(1).max(100000).optional(),
  RATE_LIMIT_PUSH_REGISTER_PER_MIN: Joi.number().integer().min(1).max(100000).optional(),
  RATE_LIMIT_PUSH_TEST_PER_MIN: Joi.number().integer().min(1).max(100000).optional(),
  RATE_LIMIT_KEY_PREFIX: Joi.string().optional(),
  // Web Push (VAPID) — secrets only, never hardcoded. The feature stays off
  // (and the API answers "not configured") until the keys are provided.
  PUSH_VAPID_PUBLIC_KEY: Joi.string().optional().allow(''),
  PUSH_VAPID_PRIVATE_KEY: Joi.string().optional().allow(''),
  PUSH_VAPID_SUBJECT: Joi.string().optional().allow(''),
  // Employee follow-ups scheduling (task §4/§7) — centralized, optional,
  // validated hours/minutes. Defaults live in `followup-schedule.ts` and match
  // the product requirement exactly (property 72/96/120h, client 120/144/168h,
  // background scan every 15 minutes).
  FOLLOWUP_PROPERTY_INTERVAL_HOURS: Joi.number().integer().min(1).optional(),
  FOLLOWUP_PROPERTY_EMPLOYEE_WARN_HOURS: Joi.number().integer().min(1).optional(),
  FOLLOWUP_PROPERTY_MANAGER_ESCALATE_HOURS: Joi.number().integer().min(1).optional(),
  FOLLOWUP_CLIENT_INTERVAL_HOURS: Joi.number().integer().min(1).optional(),
  FOLLOWUP_CLIENT_EMPLOYEE_WARN_HOURS: Joi.number().integer().min(1).optional(),
  FOLLOWUP_CLIENT_MANAGER_ESCALATE_HOURS: Joi.number().integer().min(1).optional(),
  FOLLOWUP_SCAN_MINUTES: Joi.number().integer().min(1).optional(),
  FOLLOWUP_REMINDER_COOLDOWN_HOURS: Joi.number().integer().min(1).optional(),
});
