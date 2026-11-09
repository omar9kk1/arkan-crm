import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthUser } from '@arkan/shared';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AuthCookieService } from './auth-cookie.service';
import { CsrfService } from './csrf.service';
import { PrismaService } from '../prisma/prisma.service';
import { managerCapabilities } from '../common/access/access-policy';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import {
  RATE_LIMIT_DEFAULTS,
  rateLimit,
  rateLimitWindowMs,
} from '../config/rate-limit';

interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; role: string };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookieService,
    private readonly csrf: CsrfService,
    private readonly prisma: PrismaService,
  ) {}

  private legacyTokens(result: IssuedSession) {
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
    };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({
    default: {
      limit: rateLimit('LOGIN', RATE_LIMIT_DEFAULTS.login),
      ttl: rateLimitWindowMs,
    },
  })
  @Post('login')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  async login(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const mode = this.cookies.mode;
    const cookieFlow =
      mode === 'cookie' || (mode === 'dual' && this.csrf.hasAttempt(request));
    // Validate before creating any refresh-token row, so a CSRF failure never
    // leaves an orphaned session in the database.
    if (cookieFlow) this.csrf.assert(request);

    const result = await this.auth.login(body);
    if (mode === 'legacy') return this.legacyTokens(result);

    // In dual mode a client that does not attempt the cookie/CSRF flow keeps
    // the legacy token response. Cookie issuance is NEVER available without a
    // valid CSRF token.
    if (!cookieFlow) return this.legacyTokens(result);

    this.cookies.setSession(response, result);
    const csrfToken = this.csrf.issue(response);
    if (this.cookies.mode === 'cookie')
      return { user: result.user, csrfToken };
    return { ...this.legacyTokens(result), user: result.user, csrfToken };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({
    default: {
      limit: rateLimit('REFRESH', RATE_LIMIT_DEFAULTS.refresh),
      ttl: rateLimitWindowMs,
    },
  })
  @Post('refresh')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  async refresh(
    @Body() body: RefreshTokenDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const mode = this.cookies.mode;
    const cookieToken = this.cookies.refreshToken(request);

    if (mode === 'legacy') {
      if (!body.refreshToken)
        throw new BadRequestException('refreshToken is required');
      return this.legacyTokens(
        await this.auth.refresh({ refreshToken: body.refreshToken }),
      );
    }

    if (cookieToken) {
      // A stored cookie always takes precedence over a body token. This
      // prevents a caller from bypassing CSRF by supplying a body token.
      this.csrf.assert(request);
      let result: IssuedSession;
      try {
        result = await this.auth.refresh({ refreshToken: cookieToken });
      } catch (error) {
        this.cookies.clear(response);
        throw error;
      }
      this.cookies.setSession(response, result);
      const csrfToken = this.csrf.issue(response);
      if (mode === 'cookie') return { user: result.user, csrfToken };
      return { ...this.legacyTokens(result), user: result.user, csrfToken };
    }

    // No cookie and no body token means this client simply has no session.
    // Dual mode must stay compatible with cookie-mode clients, which never
    // send a body token and rely on this 401 instead of a 400 validation error.
    if (mode === 'cookie' || !body.refreshToken)
      throw new UnauthorizedException('No refresh session');

    // Dual-only migration path: an existing legacy session can exchange its
    // opaque refresh token for HttpOnly cookies, but only with a valid CSRF
    // pair. Without CSRF it keeps the old token-only response (no cookies).
    if (this.csrf.hasAttempt(request)) {
      this.csrf.assert(request);
      const result = await this.auth.refresh({
        refreshToken: body.refreshToken,
      });
      this.cookies.setSession(response, result);
      const csrfToken = this.csrf.issue(response);
      return { ...this.legacyTokens(result), user: result.user, csrfToken };
    }

    return this.legacyTokens(
      await this.auth.refresh({ refreshToken: body.refreshToken }),
    );
  }

  @Public()
  @Post('logout')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  async logout(
    @Body() body: RefreshTokenDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const mode = this.cookies.mode;
    const cookieToken = this.cookies.refreshToken(request);

    if (mode === 'legacy') {
      if (!body.refreshToken)
        throw new BadRequestException('refreshToken is required');
      await this.auth.logout({ refreshToken: body.refreshToken });
      return { loggedOut: true };
    }

    if (cookieToken) {
      // A cookie session can never be logged out cross-site: CSRF is required.
      this.csrf.assert(request);
      await this.auth.logout({ refreshToken: cookieToken });
      this.cookies.clear(response);
      return { loggedOut: true };
    }

    if (mode === 'dual' && body.refreshToken) {
      // Temporary migration path for a legacy client that never received
      // cookies. It can still revoke its own opaque refresh token.
      await this.auth.logout({ refreshToken: body.refreshToken });
      this.cookies.clear(response);
      return { loggedOut: true };
    }

    if (mode === 'cookie') {
      // Idempotent: clear any stale cookies even when no session exists.
      this.cookies.clear(response);
      return { loggedOut: true };
    }

    throw new BadRequestException('refreshToken is required');
  }

  /** Bootstraps the double-submit CSRF cookie before login. */
  @Public()
  @Throttle({
    default: {
      limit: rateLimit('CSRF', RATE_LIMIT_DEFAULTS.csrf),
      ttl: rateLimitWindowMs,
    },
  })
  @Get('csrf')
  @Header('Cache-Control', 'no-store')
  csrfToken(@Res({ passthrough: true }) response: Response) {
    return { csrfToken: this.csrf.issue(response) };
  }

  @Get('me')
  async me(@Req() request: { user: AuthUser }) {
    // The session lineage is an internal server detail (it identifies the
    // device's login family); it never leaves the API. Capabilities are a live
    // database read and remain display hints only.
    const { id, role } = request.user;
    const capabilities = await managerCapabilities(this.prisma, request.user);
    return { id, role, capabilities };
  }
}
