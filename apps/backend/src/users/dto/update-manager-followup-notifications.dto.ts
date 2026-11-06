import { IsBoolean } from 'class-validator';

export class UpdateManagerFollowUpNotificationsDto {
  @IsBoolean()
  enabled!: boolean;
}
