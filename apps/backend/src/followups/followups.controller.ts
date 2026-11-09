import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Role, type AuthUser } from '@arkan/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { FollowUpsService } from './followups.service';
import { SaveFollowUpBatchDto } from './dto/save-follow-up-batch.dto';
import {
  ListFollowUpsQueryDto,
  ListSupervisionFollowUpsQueryDto,
} from './dto/list-follow-ups.query';

/**
 * Follow-ups endpoints: the personal experience (any role, each account sees
 * exactly its own responsibility scope) and the MANAGER supervision + manual
 * reminder endpoints (`@Roles(Role.MANAGER)` — employees can never reach them,
 * forged ids answer 404 from the service scope, so existence never leaks).
 *
 * The global `JwtAuthGuard` + `RolesGuard` already require a session; row-level
 * scoping lives INSIDE `FollowUpsService`.
 */
@Controller('follow-ups')
export class FollowupsController {
  constructor(private readonly followUps: FollowUpsService) {}

  /** The caller's active subjects (synchronized from canonical data first). */
  @Get()
  list(
    @Req() request: { user: AuthUser },
    @Query() query: ListFollowUpsQueryDto,
  ) {
    return this.followUps.list(request.user, query);
  }

  /** Manager overview of every company EMPLOYEE follow-up subject (§3/§4). */
  @Get('manager/overview')
  @Roles(Role.OWNER, Role.MANAGER)
  supervisionOverview(
    @Req() request: { user: AuthUser },
    @Query() query: ListSupervisionFollowUpsQueryDto,
  ) {
    return this.followUps.listSupervision(request.user, query);
  }

  /** ONE subject's permanent history, newest first (§6). */
  /** Today's saved follow-up entries authored by the caller (achievements). */
  @Get('achievements/today')
  achievementsToday(@Req() request: { user: AuthUser }) {
    return this.followUps.achievementsToday(request.user);
  }

  @Get(':id/history')
  history(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.followUps.history(request.user, id);
  }

  /**
   * Atomic multi-subject save of ONE conversation (§5): per-subject notes,
   * per-subject due-date reset, idempotent on double submission. Each account
   * saves ONLY its own responsibility scope (a manager never writes on an
   * employee subject — the scope answers 404 (§8)).
   */
  @Post('batch')
  saveBatch(
    @Req() request: { user: AuthUser },
    @Body() body: SaveFollowUpBatchDto,
  ) {
    return this.followUps.saveBatch(request.user, body);
  }

  /**
   * ONE manual manager reminder for ONE overdue employee subject (§6):
   * notifies through the existing pipeline, cooldown-deduplicated
   * server-side, and NEVER modifies due date, cycle, ownership or history.
   */
  @Post(':id/reminder')
  @Roles(Role.OWNER, Role.MANAGER)
  sendReminder(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.followUps.sendReminder(request.user, id);
  }
}
