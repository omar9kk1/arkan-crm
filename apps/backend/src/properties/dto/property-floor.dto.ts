import { FloorType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * One floor record. `type` maps to the approved `FloorType` interface; basement,
 * half and quarter floors are separate records (they are enum values, not flags).
 * `details` is free text.
 */
export class PropertyFloorInputDto {
  @IsEnum(FloorType)
  type!: FloorType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  customLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  details?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;
}
