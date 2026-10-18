import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Role } from '@arkan/shared';

/**
 * Body of `POST /employees`.
 *
 * Only fields that are genuinely persisted are accepted: `User` (email, name,
 * role, isActive, password) plus the 1:1 `EmployeeProfile` (phone, hiredAt,
 * baseSalary). There is deliberately no `notes` field — neither model has a
 * column for it, so accepting one would silently discard data.
 */
export class CreateEmployeeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsEnum(Role)
  role!: Role;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsDateString()
  hiredAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  baseSalary?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
