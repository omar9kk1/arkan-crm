import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthUser } from '@arkan/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  ConfirmCommissionPayoutDto,
  CreateManualExpenseDto,
  ListFinanceQueryDto,
} from './dto/finance.dto';
import { FinanceService } from './finance.service';

/**
 * Finance is OWNER-only. MANAGER and EMPLOYEE are rejected by the same global
 * RolesGuard used everywhere else, including when they call the API directly.
 */
@Roles(Role.OWNER)
@Controller('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  /** Persistent ledger with the existing page filters and exact summaries. */
  @Get()
  list(
    @Req() request: { user: AuthUser },
    @Query() query: ListFinanceQueryDto,
  ) {
    return this.finance.list(request.user, query);
  }

  /** Property picker for the existing manual-expense form. */
  @Get('options')
  options(@Req() request: { user: AuthUser }) {
    return this.finance.options(request.user);
  }

  /** OWNER records one persistent manual expense + its ledger movement. */
  @Post('manual-expenses')
  createManualExpense(
    @Req() request: { user: AuthUser },
    @Body() body: CreateManualExpenseDto,
  ) {
    return this.finance.createManualExpense(request.user, body);
  }

  /** OWNER confirms an employee commission payout (idempotent). */
  @Post('commissions/:id/pay')
  confirmPayout(
    @Req() request: { user: AuthUser },
    @Param('id') id: string,
    @Body() body: ConfirmCommissionPayoutDto,
  ) {
    return this.finance.confirmCommissionPayout(request.user, id, body);
  }
}
