import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthUser } from '@arkan/shared';
import type { Request } from 'express';

/**
 * Global limiter.
 *
 * - Authenticated requests are keyed by the verified `request.user.id`, so
 *   employees behind one NAT do not consume each other's allowance.
 * - Anonymous requests fall back to the normalized socket/proxy IP.
 * - Login and refresh keep their existing dedicated local guards (IP-keyed);
 *   the global guard skips those paths so limits are never stacked.
 * - CORS preflights are not counted.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const path = request.path.replace(/\/$/, '') || '/';
    return (
      request.method === 'OPTIONS' ||
      path === '/auth/login' ||
      path === '/auth/refresh'
    );
  }

  protected async getTracker(
    req: Record<string, unknown>,
  ): Promise<string> {
    const user = (
      req as unknown as Request & { user?: AuthUser }
    ).user;
    if (user && typeof user.id === 'string' && user.id)
      return `user:${user.id}`;
    return super.getTracker(req);
  }
}
