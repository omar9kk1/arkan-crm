import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { Role, type AuthUser } from '@arkan/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { PushService } from './push.service';
import {
  SubscribePushDto,
  UnsubscribePushDto,
} from './dto/push-subscription.dto';

/**
 * The manager's Web Push API.
 *
 * Every handler is MANAGER-only, and every handler derives the session
 * lineage from the VERIFIED request identity (the live session row), never
 * from the request body: a browser can therefore never claim another
 * session's lineage or another account's subscription.
 */
@Controller('push')
@Roles(Role.MANAGER)
export class PushController {
  constructor(private readonly push: PushService) {}

  /** The VAPID public key and whether the server is ready to push. */
  @Get('config')
  configuration() {
    return this.push.configuration();
  }

  /** Whether THIS browser currently holds a subscription. */
  @Get('subscriptions')
  status(@Req() request: { user: AuthUser }) {
    return this.push.status(request.user);
  }

  /** Binds this browser's subscription to the authenticated manager. */
  @Put('subscriptions')
  subscribe(
    @Req() request: { user: AuthUser },
    @Body() dto: SubscribePushDto,
  ) {
    return this.push.subscribe(request.user, dto);
  }

  /** Removes this browser's subscription (the "OFF" switch of the device). */
  @Delete('subscriptions')
  unsubscribe(
    @Req() request: { user: AuthUser },
    @Body() dto: UnsubscribePushDto,
  ) {
    return this.push.unsubscribe(request.user, dto);
  }

  /**
   * Sends a test message to the caller's own devices — the one-click proof
   * that the whole path works. It creates no business record and no in-app
   * notification row.
   */
  @Post('test')
  @HttpCode(200)
  test(@Req() request: { user: AuthUser }) {
    return this.push.sendTestToSelf(request.user);
  }
}
