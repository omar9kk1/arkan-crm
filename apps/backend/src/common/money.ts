import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Monetary and area values are accepted as decimal strings so they never pass
 * through imprecise floating-point arithmetic. The applied schema stores them as
 * `Decimal(14,2)`, so at most 2 fraction digits are accepted (the KWD 3-decimal
 * concern is documented but does not change the applied precision).
 */
export const DECIMAL_STRING_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

export function toDecimal(
  value: string | null | undefined,
  field: string,
): Prisma.Decimal | null {
  if (value === null || value === undefined || value === '') return null;
  if (!DECIMAL_STRING_PATTERN.test(value))
    throw new BadRequestException(
      `${field} must be a non-negative decimal with at most 2 fraction digits`,
    );
  return new Prisma.Decimal(value);
}
