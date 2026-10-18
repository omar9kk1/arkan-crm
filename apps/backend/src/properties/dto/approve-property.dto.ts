import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class ApprovePropertyDto {
  /** Optional optimistic-concurrency guard; a stale version is rejected with 409. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}
