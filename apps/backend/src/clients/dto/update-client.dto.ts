import {
  ArrayMaxSize,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PropertyInterestInputDto } from './property-interest.dto';

/**
 * Body of `PATCH /clients/:id`.
 *
 * `notes: null` clears them and `responsibleUserId: null` unassigns the
 * client; omitted fields stay unchanged. Reassigning responsibility is a
 * manager-only capability enforced in the service — an employee editing their
 * own client can never hand it to a colleague.
 */
export class UpdateClientDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(3, 32)
  phone?: string;

  /** `null` clears the notes; `undefined` leaves them unchanged. */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  source?: string | null;

  /** Stable `User.id` of the new responsible employee; `null` unassigns. */
  @IsOptional()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'responsibleUserId must be a UUID',
  })
  responsibleUserId?: string | null;

  /**
   * Optional interests in EXISTING program properties, upserted (never
   * duplicated) on the authorised client. Links a wizard save of an existing
   * client to additional properties without creating a new client row.
   */
  @IsOptional()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PropertyInterestInputDto)
  propertyInterests?: PropertyInterestInputDto[];
}
