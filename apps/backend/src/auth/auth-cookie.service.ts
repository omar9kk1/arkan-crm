import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import {
  resolveAuthCookieConfig,
  type AuthCookieConfig,
  type AuthCookieMode,
} from './auth-cookie.config';
import {
  appendSetCookie,
  readCookie,
  serializeCookie,
} from './cookie-utils';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Owns all cookie names/flags and writes them on the HTTP response.
 * Cookie reads are disabled entirely in legacy mode so existing Bearer
 * authentication remains byte-for-byte unchanged.
 */
@Injectable()
export class AuthCookieService {
  readonly config: AuthCookieConfig;

  constructor(config: ConfigService) {
    this.config = resolveAuthCookieConfig({
      mode: config.get<string>('AUTH_COOKIE_MODE'),
      nodeEnv: config.get<string>('NODE_ENV'),
      secure: config.get<boolean | string>('COOKIE_SECURE'),
      frontendOrigin: config.get<string>('FRONTEND_ORIGIN'),
      accessTtlSeconds: config.get<number>('JWT_ACCESS_TTL_SECONDS'),
    });
  }

  get mode(): AuthCookieMode {
    return this.config.mode;
  }

  get usesCookies(): boolean {
    return this.mode !== 'legacy';
  }

  accessToken(request: Request): string | null {
    if (!this.usesCookies) return null;
    return readCookie(request.headers.cookie, this.config.accessName);
  }

  refreshToken(request: Request): string | null {
    if (!this.usesCookies) return null;
    return readCookie(request.headers.cookie, this.config.refreshName);
  }

  csrfToken(request: Request): string | null {
    return readCookie(request.headers.cookie, this.config.csrfName);
  }

  hasAuthCookie(request: Request): boolean {
    return Boolean(this.accessToken(request) || this.refreshToken(request));
  }

  setSession(response: Response, tokens: AuthTokens): void {
    appendSetCookie(
      response,
      serializeCookie(this.config.accessName, tokens.accessToken, {
        maxAgeMs: this.config.accessMaxAgeMs,
        path: this.config.accessPath,
        httpOnly: true,
        secure: this.config.secure,
      }),
    );
    appendSetCookie(
      response,
      serializeCookie(this.config.refreshName, tokens.refreshToken, {
        maxAgeMs: this.config.refreshMaxAgeMs,
        path: this.config.refreshPath,
        httpOnly: true,
        secure: this.config.secure,
      }),
    );
  }

  setCsrf(response: Response, token: string): void {
    appendSetCookie(
      response,
      serializeCookie(this.config.csrfName, token, {
        maxAgeMs: this.config.csrfMaxAgeMs,
        path: this.config.csrfPath,
        httpOnly: false,
        secure: this.config.secure,
      }),
    );
  }

  issueCsrf(response: Response): string {
    const token = randomBytes(32).toString('base64url');
    this.setCsrf(response, token);
    return token;
  }

  clear(response: Response): void {
    if (!this.usesCookies) return;
    const httpOnlyClear = (name: string, path: string) =>
      appendSetCookie(
        response,
        serializeCookie(name, '', {
          maxAgeMs: 0,
          path,
          httpOnly: true,
          secure: this.config.secure,
        }),
      );
    httpOnlyClear(this.config.accessName, this.config.accessPath);
    httpOnlyClear(this.config.refreshName, this.config.refreshPath);
    appendSetCookie(
      response,
      serializeCookie(this.config.csrfName, '', {
        maxAgeMs: 0,
        path: this.config.csrfPath,
        httpOnly: false,
        secure: this.config.secure,
      }),
    );
  }
}
