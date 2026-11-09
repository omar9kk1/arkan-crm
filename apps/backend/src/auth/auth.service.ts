import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { hashPassword, verifyPassword } from './password';

const REFRESH_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const hashRefreshToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/**
 * The session-resolution projection: authentication reads EXACTLY these
 * columns. Never a full `User` row / bare `include: { user: true }` — the auth
 * path must not depend on unrelated (e.g. newly added, not yet migrated)
 * columns, or a single pending schema change turns login, refresh and the
 * JWT guard into 500/401 for every account.
 */
const SESSION_USER_SELECT = {
  id: true,
  role: true,
  isActive: true,
  authVersion: true,
} as const;

@Injectable()
export class AuthService {
  private readonly dummyHash = hashPassword(randomBytes(32).toString('hex'));
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(credentials: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: credentials.email.trim().toLowerCase() },
      select: { id: true, passwordHash: true, isActive: true },
    });
    const valid = await verifyPassword(
      credentials.password,
      user?.passwordHash ?? (await this.dummyHash),
    );
    if (!user?.isActive || !valid)
      throw new UnauthorizedException('Invalid email or password');
    return this.prisma.$transaction(async (tx) => {
      // Recheck account state inside the session-creation transaction.
      const current = await tx.user.findUnique({
        where: { id: user.id },
        select: { ...SESSION_USER_SELECT, passwordHash: true },
      });
      if (!current?.isActive || current.passwordHash !== user.passwordHash)
        throw new UnauthorizedException('Invalid email or password');
      // A login starts a NEW lineage: the stable identity of this device's
      // session family. It survives every refresh rotation and is revoked as a
      // whole on logout, so one device can be signed out without touching the
      // other devices of the same account.
      return this.issueTokens(tx, current, 'AUTH_LOGIN', randomUUID());
    });
  }

  async refresh(input: RefreshTokenDto) {
    if (!input.refreshToken)
      throw new UnauthorizedException('Invalid or expired refresh token');
    const tokenHash = hashRefreshToken(input.refreshToken);
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: { select: SESSION_USER_SELECT } },
      });
      const now = new Date();
      if (
        !session ||
        session.revokedAt ||
        session.expiresAt <= now ||
        !session.user.isActive
      )
        throw new UnauthorizedException('Invalid or expired refresh token');
      // Serialize refresh and logout of the SAME lineage. Without this, a
      // refresh in flight while a logout commits could insert a new session row
      // AFTER the logout revoked the family — resurrecting a session the user
      // already closed.
      await this.lockLineage(tx, session.lineageId);
      // Re-read under the lock: a concurrent logout may have revoked the row
      // while this request waited for the lineage lock.
      const current = await tx.refreshToken.findUnique({
        where: { id: session.id },
        include: { user: { select: SESSION_USER_SELECT } },
      });
      if (
        !current ||
        current.revokedAt ||
        current.expiresAt <= new Date() ||
        !current.user.isActive
      )
        throw new UnauthorizedException('Invalid or expired refresh token');
      // A role/permission change bumps User.authVersion. An old refresh token
      // must never be able to mint a token with the NEW role: revoke the whole
      // lineage and require a fresh login instead.
      if (current.authVersion !== current.user.authVersion) {
        await tx.refreshToken.updateMany({
          where: {
            userId: current.userId,
            ...(current.lineageId
              ? { lineageId: current.lineageId }
              : { id: current.id }),
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
        throw new UnauthorizedException(
          'Session expired after an account change; sign in again',
        );
      }
      // Conditional update makes refresh single-use even for concurrent requests.
      const consumed = await tx.refreshToken.updateMany({
        where: { id: session.id, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { revokedAt: new Date() },
      });
      if (consumed.count !== 1)
        throw new UnauthorizedException('Refresh token already used');
      // The rotation keeps the SAME lineage. A session created before the
      // lineage column existed stays without one: it keeps working normally and
      // is simply never eligible for Web Push.
      return this.issueTokens(tx, current.user, 'AUTH_REFRESH', current.lineageId);
    });
  }

  async logout(input: RefreshTokenDto) {
    const refreshToken = input.refreshToken;
    if (!refreshToken) return { loggedOut: true };
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.refreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(refreshToken) },
      });
      if (session) {
        // The same lineage lock as the refresh path: the two can never
        // interleave for one device.
        await this.lockLineage(tx, session.lineageId);
        // Revoke the WHOLE lineage (every row of this login family), not just
        // the presented row: the device's Web Push subscriptions die with it,
        // while other devices keep their own lineage alive.
        const result = await tx.refreshToken.updateMany({
          where: {
            userId: session.userId,
            ...(session.lineageId
              ? { lineageId: session.lineageId }
              : { id: session.id }),
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
        if (result.count)
          await tx.auditLog.create({
            data: {
              actorId: session.userId,
              action: 'AUTH_LOGOUT',
              entityType: 'RefreshToken',
              entityId: session.id,
            },
          });
      }
      return { loggedOut: true };
    });
  }

  /**
   * Serializes the refresh/logout of ONE session lineage inside the current
   * transaction. The advisory lock is released when the transaction ends, so
   * the loser of the race re-reads the (revoked) rows and fails closed.
   */
  private async lockLineage(
    tx: Prisma.TransactionClient,
    lineageId: string | null,
  ): Promise<void> {
    if (!lineageId) return;
    // The lock function returns `void`, so the statement selects a plain
    // integer column Prisma can deserialize.
    await tx.$queryRaw(
      Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(CAST(${lineageId} AS text)))`,
    );
  }

  private async issueTokens(
    tx: Prisma.TransactionClient,
    user: Pick<User, 'id' | 'role' | 'authVersion'>,
    action: string,
    lineageId: string | null,
  ) {
    const refreshToken = randomBytes(48).toString('base64url');
    const sessionId = randomUUID();
    const expiresIn = this.config.getOrThrow<number>('JWT_ACCESS_TTL_SECONDS');
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      role: user.role,
      sid: sessionId,
      av: user.authVersion,
    });
    await tx.refreshToken.create({
      data: {
        id: sessionId,
        userId: user.id,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_LIFETIME_MS),
        lineageId,
        authVersion: user.authVersion,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action,
        entityType: 'RefreshToken',
        entityId: sessionId,
      },
    });
    return {
      accessToken,
      refreshToken,
      expiresIn,
      user: { id: user.id, role: user.role },
    };
  }
}
