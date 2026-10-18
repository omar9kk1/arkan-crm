import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';
import { DECIMAL_STRING_PATTERN } from '../money';

/**
 * Accepts a monetary/area value as a JSON number or decimal string and normalises
 * it to a decimal string (so it never passes through floating-point arithmetic).
 * Combine with `@IsOptional()` for optional fields.
 */
export function IsDecimalString() {
  return applyDecorators(
    Transform(({ value }) =>
      value === undefined || value === null ? value : String(value),
    ),
    IsString(),
    Matches(DECIMAL_STRING_PATTERN, {
      message:
        'must be a non-negative decimal with at most 2 fraction digits',
    }),
  );
}
