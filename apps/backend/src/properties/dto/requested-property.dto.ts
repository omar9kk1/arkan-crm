import {
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsDecimalString } from '../../common/validation/decimal.decorator';

/**
 * Requested property for an EXCHANGE listing. Every field is optional; budget may
 * be min-only, max-only, both or neither.
 */
export class RequestedPropertyInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  governorate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  block?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  plotNumber?: string;

  @IsOptional()
  @IsDecimalString()
  sizeSqm?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  floorRequirements?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsDecimalString()
  budgetMin?: string;

  @IsOptional()
  @IsDecimalString()
  budgetMax?: string;
}
