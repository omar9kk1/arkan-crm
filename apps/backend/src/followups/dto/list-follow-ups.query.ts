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

export const FOLLOWUP_TABS = [
  'all',
  'owners',
  'buyers',
  'sellers',
  'renters',
  'lessors',
  'inquiries',
  'exchanges',
] as const;
export type FollowUpTabQuery = (typeof FOLLOWUP_TABS)[number];

export const FOLLOWUP_STATUS_FILTERS = [
  'all',
  'OVERDUE',
  'TODAY',
  'UPCOMING',
  'NEVER',
] as const;
export type FollowUpStatusQuery = (typeof FOLLOWUP_STATUS_FILTERS)[number];

/**
 * Query of the personal `GET /follow-ups` feed. Search, tab and due-status are
 * applied inside the authorized DB query before cursor pagination.
 */
export class ListFollowUpsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsIn(FOLLOWUP_TABS)
  tab?: FollowUpTabQuery;

  @IsOptional()
  @IsIn(FOLLOWUP_STATUS_FILTERS)
  status?: FollowUpStatusQuery;

  /** Last subject id from the previous page. */
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/** Manager supervision feed: same filters + an optional responsible employee. */
export class ListSupervisionFollowUpsQueryDto extends ListFollowUpsQueryDto {
  @IsOptional()
  @IsUUID()
  employeeUserId?: string;
}

/** Searchable/paginated responsible-employee options for supervision. */
export class ListSupervisionEmployeesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/** Full-scope statistics endpoint; the employee filter is the only dimension. */
export class SupervisionSummaryQueryDto {
  @IsOptional()
  @IsUUID()
  employeeUserId?: string;
}
