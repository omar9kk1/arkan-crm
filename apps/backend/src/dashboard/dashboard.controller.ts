import { Controller, Get, Query, Req } from '@nestjs/common';
import { Role, type AuthUser } from '@arkan/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ManagerDashboardQueryDto } from './dashboard-query.dto';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** Manager-only live home dashboard aggregates for the selected period. */
  @Roles(Role.MANAGER)
  @Get('manager')
  manager(
    @Req() request: { user: AuthUser },
    @Query() query: ManagerDashboardQueryDto,
  ) {
    return this.dashboard.managerDashboard(request.user, query.period);
  }
}
