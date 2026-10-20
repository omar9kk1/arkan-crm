import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Query of `GET /clients`.
 *
 * `search` matches name or phone as a case-insensitive substring; the default
 * limit returns the whole authorised list so the existing client-side search,
 * tabs and counters keep working on real data without a new paging control.
 * The bound is explicit so the endpoint can never turn into an unbounded scan.
 */
export class ListClientsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}
