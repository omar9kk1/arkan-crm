import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
} from '@nestjs/common';
import { Role } from '@arkan/shared';
import type { AuthUser } from '@arkan/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { EmployeesService } from './employees.service';
import { ManagerPermissionsDto } from './dto/manager-permissions.dto';

/** OWNER-only Manager directory and independent review-capability controls. */
@Controller('managers')
@Roles(Role.OWNER)
export class ManagersController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  list(@Req() request: { user: AuthUser }) {
    return this.employees.listManagers(request.user);
  }

  @Patch(':id/permissions')
  setPermissions(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManagerPermissionsDto,
  ) {
    return this.employees.setManagerPermissions(request.user, id, dto);
  }
}
