import Joi from 'joi';
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
    .invalid('replace-with-random-secret-at-least-32-characters')
    .required(),
  JWT_ACCESS_TTL_SECONDS: Joi.number().integer().min(60).max(3600).default(900),
  JWT_ISSUER: Joi.string().required(),
  JWT_AUDIENCE: Joi.string().required(),
});
