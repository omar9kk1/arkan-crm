import { DealType, PropertyStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ListPropertiesQueryDto {
  @IsOptional()
  @IsEnum(PropertyStatus)
  status?: PropertyStatus;

  @IsOptional()
  @IsEnum(DealType)
  listingType?: DealType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  governorate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;

  /**
   * Free-text search across PUBLIC listing fields only: the full property code
   * (`reference`), title, area, district and governorate. Never matches the
   * owner/broker contact rows — those stay unrelated to this filter. Limited to
   * a bounded length and always combined with the viewer's visibility filter.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsUUID()
  cursor?: string;
}
