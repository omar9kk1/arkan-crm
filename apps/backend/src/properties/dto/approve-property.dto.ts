import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class ApprovePropertyDto {
  /** Optional optimistic-concurrency guard; a stale version is rejected with 409. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;

  /**
   * Explicit confirmation that the Manager reviewed a POTENTIAL_DUPLICATE
   * submission and determined it is a genuinely different physical house.
   * Required when the pending property has duplicateCandidateIds.
   */
  @IsOptional()
  @IsBoolean()
  approveAsDistinct?: boolean;
}
