import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthCookieService } from '../auth-cookie.service';
import { CsrfService } from '../csrf.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const AUTH_ENDPOINTS = new Set([
  '/auth/login',
  '/auth/refresh',
  '/auth/logout',
]);

/**
 * Global guard for every unsafe request authenticated by cookies.
 *
 * - Legacy Bearer requests are untouched (no auth cookie present).
 * - Auth endpoints are handled in AuthController because login and legacy
 *   body-token refresh/logout need mode-specific fallback rules.
 * - Cookie-authenticated mutations always require a valid CSRF token,
 *   regardless of SameSite.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly cookies: AuthCookieService,
    private readonly csrf: CsrfService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
    if (AUTH_ENDPOINTS.has(request.path)) return true;
    if (!this.cookies.hasAuthCookie(request)) return true;
    this.csrf.assert(request);
    return true;
  }
}
