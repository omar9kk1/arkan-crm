import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthUser } from '@arkan/shared';
import { NotificationsService } from './notifications.service';
import { ListNotificationsQueryDto } from './dto/list-notifications.query';

/**
 * The authenticated notification bell API.
 *
 * Every handler takes its recipient from the verified JWT identity
 * (`request.user`), so a caller can only ever list, read or count their OWN
 * notifications. There is deliberately no role rule here: the MANAGER role does
 * not widen access to another user's inbox.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @Req() request: { user: AuthUser },
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notifications.list(request.user, query);
  }

  @Get('unread-count')
  unreadCount(@Req() request: { user: AuthUser }) {
    return this.notifications.unreadCount(request.user);
  }

  @Patch('read-all')
  @HttpCode(200)
  markAllRead(@Req() request: { user: AuthUser }) {
    return this.notifications.markAllRead(request.user);
  }

  @Patch(':id/read')
  @HttpCode(200)
  markRead(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.markRead(request.user, id);
  }
}
