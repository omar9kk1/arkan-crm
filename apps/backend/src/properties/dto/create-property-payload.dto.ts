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
 * The `payload` JSON object of a multipart `POST /properties` request. Explicit
 * field allowlist: no arbitrary Prisma object, no mass assignment, and no
 * client-controllable status/creator/contact-ownership fields.
 */
export class CreatePropertyPayloadDto {
  @IsEnum(DealType)
  listingType!: DealType;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

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
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsDecimalString()
  sizeSqm?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  floorCount?: number;

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

  /** Exactly one of `contactId` / `newContact` must be supplied. */
  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => NewContactInputDto)
  newContact?: NewContactInputDto;

  /** Only allowed for EXCHANGE listings. */
  @IsOptional()
  @ValidateNested()
  @Type(() => RequestedPropertyInputDto)
  requestedProperty?: RequestedPropertyInputDto;
}
