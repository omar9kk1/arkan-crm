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
  // Optional private storage root for uploaded property images. When unset the
  // StorageService falls back to `<home>/.arkan-crm/storage` (outside the repo).
  STORAGE_ROOT: Joi.string().optional(),
});
