import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * One interest of the client in an EXISTING program property, delivered with a
 * wizard save. `propertyId` must be the real immutable `Property.id` (never a
 * code) — the service re-validates existence, availability and the caller's
 * visibility inside its transaction, so the reference can never be trusted
 * from the body alone.
 */
export class PropertyInterestInputDto {
  @IsUUID()
  propertyId!: string;

  /** Inquiry reason (استفسار / طلب معاينة / تفاوض على السعر ...). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  /** The customer's own notes about this property. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
