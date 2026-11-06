import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { Role, type AuthUser } from '@arkan/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { ClientReviewsService } from './client-reviews.service';
import {
  DecideClientReviewDto,
  SubmitClientReviewDto,
} from './dto/create-client-review.dto';

/**
 * The staged client-change review endpoints.
 *
 * `GET` answers both roles with row-level scoping set INSIDE the service
 * (an employee reads only their own submissions; a manager reads all).
 * The decision routes are manager-only; POST/PATCH are employee-only by the
 * same in-service checks (a manager saves clients directly — no review).
 * Unauthorised ids answer 404, so an employee can never discover another
 * employee's submission by guessing.
 */
@Controller('client-reviews')
export class ClientReviewsController {
  constructor(private readonly reviews: ClientReviewsService) {}

  @Post()
  submit(
    @Req() request: { user: AuthUser },
    @Body() body: SubmitClientReviewDto,
  ) {
    return this.reviews.submit(request.user, body);
  }

  /** The «تحت المراجعة» badge: exact PENDING count, scoped in-service. */
  @Get('count')
  count(@Req() request: { user: AuthUser }) {
    return this.reviews.countPending(request.user);
  }

  @Get()
  list(@Req() request: { user: AuthUser }) {
    return this.reviews.list(request.user);
  }

  @Get(':id')
  findOne(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reviews.findOne(request.user, id);
  }

  /** The requester's own explicit refreshed proposal (one lifecycle). */
  @Patch(':id')
  resubmit(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SubmitClientReviewDto,
  ) {
    return this.reviews.resubmit(request.user, id, body);
  }

  @Post(':id/approve')
  @Roles(Role.MANAGER)
  approve(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DecideClientReviewDto,
  ) {
    return this.reviews.decide(request.user, id, 'APPROVED', body.reviewNotes ?? null);
  }

  @Post(':id/reject')
  @Roles(Role.MANAGER)
  reject(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DecideClientReviewDto,
  ) {
    return this.reviews.decide(request.user, id, 'REJECTED', body.reviewNotes ?? null);
  }

  @Post(':id/request-changes')
  @Roles(Role.MANAGER)
  requestChanges(
    @Req() request: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DecideClientReviewDto,
  ) {
    return this.reviews.decide(
      request.user,
      id,
      'CHANGES_REQUESTED',
      body.reviewNotes ?? null,
    );
  }
}
