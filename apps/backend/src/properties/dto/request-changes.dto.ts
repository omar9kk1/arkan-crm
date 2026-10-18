import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class RequestChangesDto {
  /** Mandatory, non-empty instructions the employee must act on. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;

  /** Optional optimistic-concurrency guard; a stale version is rejected with 409. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}
