import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';

function flatten(errors: ValidationError[], parent = ''): string[] {
  const messages: string[] = [];
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property;
    if (error.constraints) messages.push(...Object.values(error.constraints));
    if (error.children?.length) messages.push(...flatten(error.children, path));
  }
  return messages;
}

/**
 * Parses a JSON payload (as sent inside a multipart `payload` field) into a DTO and
 * validates it with the same whitelist/forbidNonWhitelisted rules as the global
 * ValidationPipe. This keeps multipart bodies on an explicit field allowlist so no
 * arbitrary Prisma object or mass-assignment payload can be accepted.
 */
export async function parseAndValidatePayload<T extends object>(
  dto: new () => T,
  raw: string,
  label = 'payload',
): Promise<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestException(`${label} must be valid JSON`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new BadRequestException(`${label} must be a JSON object`);
  const instance = plainToInstance(dto, parsed);
  const errors = await validate(instance as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length) throw new BadRequestException(flatten(errors));
  return instance;
}
