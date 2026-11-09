import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Role } from '@arkan/shared';

/**
 * Body of `POST /employees` (OWNER only). Managers may be created without an
 * EmployeeProfile; employees get one and may be assigned immediately.
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

  @IsIn([Role.MANAGER, Role.EMPLOYEE])
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

  /** EMPLOYEE only: initial Manager assignment (must be an active MANAGER). */
  @IsOptional()
  @IsUUID()
  managerUserId?: string;
}
