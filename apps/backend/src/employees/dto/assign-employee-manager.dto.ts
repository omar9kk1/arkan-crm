import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

/** Body of `PATCH /employees/:id/manager` (OWNER only). `null` unassigns. */
export class AssignEmployeeManagerDto {
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  managerUserId!: string | null;
}
