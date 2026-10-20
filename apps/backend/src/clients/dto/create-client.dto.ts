import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PropertyInterestInputDto } from './property-interest.dto';

/**
 * Body of `POST /clients`.
 *
 * Only fields with a real `Client` column are accepted, plus the approved
 * `propertyInterests` array: interests recorded against EXISTING program
 * properties (each carrying its immutable `Property.id`). `responsibleUserId`
 * links the client to an employee account by stable `User.id`.
 */
export class CreateClientDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsString()
  @Length(3, 32)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  source?: string;

  /** Stable `User.id` of the responsible employee (manager only). */
  @IsOptional()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'responsibleUserId must be a UUID',
  })
  responsibleUserId?: string;

  /** Optional first scheduled follow-up, a plain calendar date. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'nextFollowUp must be a YYYY-MM-DD date',
  })
  nextFollowUp?: string;

  /**
   * Optional interests in EXISTING program properties; each `propertyId` is
   * re-validated server-side (existence, availability, viewer visibility) and
   * saved atomically with the client itself.
   */
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => PropertyInterestInputDto)
  @ArrayMaxSize(10)
  propertyInterests?: PropertyInterestInputDto[];
}
