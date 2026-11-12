import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** `GET /deals` — cursor pagination over the authorised deal log. */
export class ListDealsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** Last deal id of the previous page. */
  @IsOptional()
  @IsUUID()
  cursor?: string;
}
