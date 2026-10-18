import { BadRequestException } from '@nestjs/common';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Clamps a requested page size into a bounded, deterministic range. */
export function resolveLimit(limit?: number): number {
  if (limit === undefined || limit === null) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1)
    throw new BadRequestException('limit must be a positive integer');
  return Math.min(limit, MAX_PAGE_SIZE);
}
