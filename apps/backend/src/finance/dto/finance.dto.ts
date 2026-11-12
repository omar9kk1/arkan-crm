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
  Matches,
} from 'class-validator';

export const FINANCE_PERIODS = ['today', 'week', 'month', 'all'] as const;
export const FINANCE_TYPES = [
  'income',
  'commission',
  'payroll',
  'manual',
] as const;

export type FinancePeriod = (typeof FINANCE_PERIODS)[number];
export type FinanceMovementType = (typeof FINANCE_TYPES)[number];

/** `GET /finance` — OWNER-only ledger page with cursor pagination. */
export class ListFinanceQueryDto {
  @IsOptional()
  @IsIn(FINANCE_PERIODS)
  period?: FinancePeriod;

  @IsOptional()
  @IsIn(FINANCE_TYPES)
  type?: FinanceMovementType;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  party?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  query?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** Last movement id of the previous page. */
  @IsOptional()
  @IsUUID()
  cursor?: string;
}

export class CreateManualExpenseDto {
  @IsString()
  @MaxLength(120)
  type!: string;

  /** Exact decimal string; KWD/EGP amounts never pass through JSON floats. */
  @IsString()
  @Matches(/^\d{1,12}(\.\d{1,3})?$/, {
    message: 'amount must be a positive decimal string',
  })
  amount!: string;

  @IsIn(['KWD', 'EGP'])
  currency!: 'KWD' | 'EGP';

  /** Calendar date (YYYY-MM-DD). */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be a YYYY-MM-DD date',
  })
  date!: string;

  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @IsString()
  @MaxLength(1000)
  description!: string;

  /**
   * Client-generated idempotency key. Repeating the same request (retry,
   * double-click, concurrent submission) returns the same manual expense and
   * ledger movement instead of creating another one.
   */
  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export class ConfirmCommissionPayoutDto {
  /** Actual OWNER-confirmed payment date (YYYY-MM-DD). */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'paidAt must be a YYYY-MM-DD date',
  })
  paidAt!: string;
}
