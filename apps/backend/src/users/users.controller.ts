import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { Role } from '@arkan/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateManagerFollowUpNotificationsDto } from './dto/update-manager-followup-notifications.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me/notification-preferences')
  @Roles(Role.MANAGER)
  async getMyNotificationPreferences(@Req() request: { user: { id: string } }) {
    const user = await this.prisma.user.findUnique({
      where: { id: request.user.id },
      select: { notifyEmployeeFollowUps: true },
    });
    return {
      notifyEmployeeFollowUps: user?.notifyEmployeeFollowUps ?? false,
    };
  }

  @Patch('me/notification-preferences')
  @Roles(Role.MANAGER)
  async updateMyNotificationPreferences(
    @Req() request: { user: { id: string } },
    @Body() body: UpdateManagerFollowUpNotificationsDto,
  ) {
    const user = await this.prisma.user.update({
      where: { id: request.user.id, role: Role.MANAGER },
      data: { notifyEmployeeFollowUps: body.enabled },
      select: { notifyEmployeeFollowUps: true },
    });
    return { notifyEmployeeFollowUps: user.notifyEmployeeFollowUps };
  }
}
