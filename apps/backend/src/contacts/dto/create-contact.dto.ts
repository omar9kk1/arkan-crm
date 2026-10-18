import { ContactType } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class CreateContactDto {
  @IsEnum(ContactType)
  type!: ContactType;

  @IsString()
  @Length(1, 120)
  name!: string;

  @IsString()
  @Length(3, 32)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
