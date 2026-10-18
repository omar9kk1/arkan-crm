import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body of `PATCH /employees/:id`.
 *
 * A manager may correct the employee's display name only. Login email, role,
 * password and every linked record (properties, notifications, deals …) stay
 * untouched, and the name is never copied onto `Property` rows — the property
 * responsible pill keeps deriving it from `Property.createdByUserId`.
 */
export class UpdateEmployeeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}
