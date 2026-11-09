import { IsBoolean } from 'class-validator';

/** Body of `PATCH /managers/:id/permissions` (OWNER only). */
export class ManagerPermissionsDto {
  @IsBoolean()
  canApprove!: boolean;

  @IsBoolean()
  canReject!: boolean;
}
