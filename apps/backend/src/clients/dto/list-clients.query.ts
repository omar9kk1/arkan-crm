import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const CLIENT_LIST_FILTERS = ['today', 'late', 'unmatched'] as const;
export type ClientListFilter = (typeof CLIENT_LIST_FILTERS)[number];

export const CLIENT_LIST_CLASSIFICATIONS = [
  'owner',
  'buyer',
  'renter',
  'exchanger',
  'interested',
] as const;
export type ClientListClassification =
  (typeof CLIENT_LIST_CLASSIFICATIONS)[number];

/**
 * Query of `GET /clients`.
 *
 * The list is cursor-paginated and returns a lightweight projection; full
 * follow-ups/deals/interests live on `GET /clients/:id`. `search` and the
 * optional filters are applied inside the same authorised DB query, so they
 * cover the whole dataset rather than only the loaded page. There is no total
 * record cap: `limit` only bounds one page.
 */
export class ListClientsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  /** Stable cursor: the last client id from the previous page. */
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsIn(CLIENT_LIST_FILTERS)
  filter?: ClientListFilter;

  @IsOptional()
  @IsIn(CLIENT_LIST_CLASSIFICATIONS)
  classification?: ClientListClassification;
}
