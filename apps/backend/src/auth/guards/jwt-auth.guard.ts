import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { Role, AuthUser } from '@arkan/shared';
import type { Request } from 'express';
import { IS_PUBLIC } from '../decorators/public.decorator';
import { AuthCookieService } from '../auth-cookie.service';
import { PrismaService } from '../../prisma/prisma.service';
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly cookies: AuthCookieService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    // Cookie auth is authoritative when present. A stale/invalid cookie must
    // NOT silently fall back to a valid Bearer token: that would make the
    // authentication source ambiguous. Bearer remains available only when no
    // cookie token is supplied (legacy/dual migration).
    const cookieToken = this.cookies.accessToken(request);
    const match = /^Bearer ([^\s]+)$/i.exec(
      request.headers.authorization ?? '',
    );
    const token = cookieToken ?? match?.[1];
    if (!token) throw new UnauthorizedException('Authentication required');
    try {
      const payload = await this.jwt.verifyAsync<Record<string, unknown>>(
        token,
      );
      if (
        typeof payload.sub !== 'string' ||
        !payload.sub ||
        typeof payload.exp !== 'number' ||
        typeof payload.sid !== 'string' ||
        (payload.role !== Role.OWNER &&
          payload.role !== Role.MANAGER &&
          payload.role !== Role.EMPLOYEE)
      )
        throw new Error('Invalid claims');
      // ONE read-only statement returns exactly the validity columns the guard
      // checks. The session row and the live user row are read in the same
      // database snapshot, so revocation/role/activation/authVersion checks
      // stay database-backed and current (no caching).
      const [session] = await this.prisma.$queryRaw<
        Array<{
          userId: string;
          revokedAt: Date | null;
          expiresAt: Date;
          lineageId: string | null;
          role: Role;
          isActive: boolean;
          authVersion: number;
        }>
      >(Prisma.sql`
        SELECT rt."userId" AS "userId",
               rt."revokedAt" AS "revokedAt",
               rt."expiresAt" AS "expiresAt",
               rt."lineageId" AS "lineageId",
               u.role AS role,
               u."isActive" AS "isActive",
               u."authVersion" AS "authVersion"
        FROM "RefreshToken" rt
        JOIN "User" u ON u.id = rt."userId"
        WHERE rt.id = ${payload.sid}::uuid
      `);
      // Old tokens carry no `av`; they are version 0, matching every account
      // that has never had a role/security change. A bumped user version
      // invalidates them permanently.
      const tokenAuthVersion =
        typeof payload.av === 'number' ? payload.av : 0;
      if (
        !session ||
        session.userId !== payload.sub ||
        session.revokedAt ||
        session.expiresAt <= new Date() ||
        !session.isActive ||
        session.role !== payload.role ||
        tokenAuthVersion !== session.authVersion
      )
        throw new Error('Inactive session');
      request.user = {
        id: session.userId,
        role: session.role,
        // The lineage of the LIVE session row: the server-side identity of this
        // device's login family. It is never taken from the request body.
        sessionLineageId: session.lineageId,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
