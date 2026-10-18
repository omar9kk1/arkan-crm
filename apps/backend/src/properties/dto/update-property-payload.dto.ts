import { DealType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsDecimalString } from '../../common/validation/decimal.decorator';
import { NewContactInputDto } from './new-contact.dto';
import { PropertyFloorInputDto } from './property-floor.dto';
import { RequestedPropertyInputDto } from './requested-property.dto';

/**
 * Body of `PATCH /properties/:id` (JSON). `version` is mandatory for optimistic
 * concurrency; a stale version is rejected with 409.
 */
export class UpdatePropertyPayloadDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsEnum(DealType)
  listingType?: DealType;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  governorate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  block?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  plotNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @IsOptional()
  @IsDecimalString()
  sizeSqm?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  floorCount?: number;

  /** When present, replaces the full floor list. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PropertyFloorInputDto)
  floors?: PropertyFloorInputDto[];

  @IsOptional()
  @IsDecimalString()
  askingPrice?: string;

  @IsOptional()
  @IsBoolean()
  negotiable?: boolean | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => NewContactInputDto)
  newContact?: NewContactInputDto;

  /** Only allowed for EXCHANGE listings (upsert). */
  @IsOptional()
  @ValidateNested()
  @Type(() => RequestedPropertyInputDto)
  requestedProperty?: RequestedPropertyInputDto;
}
