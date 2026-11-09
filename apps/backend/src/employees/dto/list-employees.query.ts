import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const EMPLOYEE_STATUS_FILTERS = ['all', 'active', 'inactive'] as const;
export type EmployeeStatusFilter =
  (typeof EMPLOYEE_STATUS_FILTERS)[number];

export const EMPLOYEE_SORT_KEYS = [
  'clientsCount',
  'propertiesCount',
  'dealsCount',
] as const;
export type EmployeeSortKey = (typeof EMPLOYEE_SORT_KEYS)[number];

/**
 * Cursor-paginated employee directory query. Search and status are applied
 * inside the authorized DB query before the page is selected.
 */
export class ListEmployeesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsIn(EMPLOYEE_STATUS_FILTERS)
  status?: EmployeeStatusFilter;

  /** All existing options sort descending, then by unique id ascending. */
  @IsOptional()
  @IsIn(EMPLOYEE_SORT_KEYS)
  sort?: EmployeeSortKey;

  /** Opaque `<metric>:<uuid>` cursor produced by the previous page. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(
    /^\d{1,9}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  )
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
