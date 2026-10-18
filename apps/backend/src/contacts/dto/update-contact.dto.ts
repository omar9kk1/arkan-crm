import { ContactType } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class UpdateContactDto {
  @IsOptional()
  @IsEnum(ContactType)
  type?: ContactType;

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
  @MaxLength(2000)
  notes?: string | null;
}
