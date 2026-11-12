import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Body of `POST /deals` (OWNER/MANAGER only).
 *
 * Money is received as an exact decimal STRING (never a JSON float) and stored
 * in Prisma Decimal columns (Decimal(15,3), KWD fils). The service rejects
 * anything with more than three decimals with an explicit message instead of
 * silently rounding user input.
 */
export class CreateDealDto {
  @IsUUID()
  propertyId!: string;

  @IsUUID()
  clientId!: string;

  /** Stable `User.id` of the property employee (validated against the team). */
  @IsUUID()
  propertyEmployeeUserId!: string;

  /** Stable `User.id` of the client employee (validated against the team). */
  @IsUUID()
  clientEmployeeUserId!: string;

  @IsIn(['SALE', 'RENT'])
  type!: 'SALE' | 'RENT';

  @IsString()
  @Matches(/^\d{1,12}(\.\d+)?$/, {
    message: 'price must be a positive decimal string',
  })
  price!: string;

  @IsString()
  @Matches(/^\d{1,12}(\.\d+)?$/, {
    message: 'companyCommission must be a non-negative decimal string',
  })
  companyCommission!: string;

  @IsString()
  @Matches(/^\d{1,12}(\.\d+)?$/, {
    message: 'propertyCommission must be a non-negative decimal string',
  })
  propertyCommission!: string;

  @IsString()
  @Matches(/^\d{1,12}(\.\d+)?$/, {
    message: 'clientCommission must be a non-negative decimal string',
  })
  clientCommission!: string;

  /** Calendar date the deal closed (YYYY-MM-DD). */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'closedAt must be a YYYY-MM-DD date',
  })
  closedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
