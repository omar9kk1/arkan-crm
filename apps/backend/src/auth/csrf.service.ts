import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AuthCookieService } from './auth-cookie.service';

/**
 * Double-submit CSRF token plus Origin/Referer and Fetch Metadata checks.
 * SameSite is an additional layer, never the only one.
 */
@Injectable()
export class CsrfService {
  constructor(private readonly cookies: AuthCookieService) {}

  issue(response: Response): string {
    return this.cookies.issueCsrf(response);
  }

  /** Whether the client attempted the cookie/CSRF flow. */
  hasAttempt(request: Request): boolean {
    return Boolean(
      request.headers['x-csrf-token'] || this.cookies.csrfToken(request),
    );
  }

  assert(request: Request): void {
    const header = request.headers['x-csrf-token'];
    const cookie = this.cookies.csrfToken(request);
    if (
      typeof header !== 'string' ||
      !cookie ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(header)
    )
      throw new ForbiddenException('CSRF validation failed');

    const supplied = Buffer.from(header);
    const expected = Buffer.from(cookie);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new ForbiddenException('CSRF validation failed');

    this.assertOrigin(request);
  }

  private assertOrigin(request: Request): void {
    const allowed = this.cookies.config.allowedOrigins;
    const originHeader = request.headers.origin;
    const refererHeader = request.headers.referer;

    let origin: string | null = null;
    if (typeof originHeader === 'string' && originHeader !== 'null')
      origin = originHeader;
    else if (typeof refererHeader === 'string') {
      try {
        origin = new URL(refererHeader).origin;
      } catch {
        origin = null;
      }
    }
    if (!origin || !allowed.includes(origin))
      throw new ForbiddenException('Request origin is not allowed');

    const site = request.headers['sec-fetch-site'];
    if (
      typeof site === 'string' &&
      site !== 'same-origin' &&
      site !== 'same-site'
    )
      throw new ForbiddenException('Cross-site request is not allowed');
  }
}
