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
    });
    const valid = await verifyPassword(
      credentials.password,
      user?.passwordHash ?? (await this.dummyHash),
    );
    if (!user?.isActive || !valid)
      throw new UnauthorizedException('Invalid email or password');
    return this.prisma.$transaction(async (tx) => {
      // Recheck account state inside the session-creation transaction.
      const current = await tx.user.findUnique({ where: { id: user.id } });
      if (!current?.isActive || current.passwordHash !== user.passwordHash)
        throw new UnauthorizedException('Invalid email or password');
      return this.issueTokens(tx, current, 'AUTH_LOGIN');
    });
  }

  async refresh(input: RefreshTokenDto) {
    const tokenHash = hashRefreshToken(input.refreshToken);
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      });
      const now = new Date();
      if (
        !session ||
        session.revokedAt ||
        session.expiresAt <= now ||
        !session.user.isActive
      )
        throw new UnauthorizedException('Invalid or expired refresh token');
      // Conditional update makes refresh single-use even for concurrent requests.
      const consumed = await tx.refreshToken.updateMany({
        where: { id: session.id, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });
      if (consumed.count !== 1)
        throw new UnauthorizedException('Refresh token already used');
      return this.issueTokens(tx, session.user, 'AUTH_REFRESH');
    });
  }

  async logout(input: RefreshTokenDto) {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.refreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(input.refreshToken) },
      });
      if (session) {
        const result = await tx.refreshToken.updateMany({
          where: { id: session.id, revokedAt: null },
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

  private async issueTokens(
    tx: Prisma.TransactionClient,
    user: User,
    action: string,
  ) {
    const refreshToken = randomBytes(48).toString('base64url');
    const sessionId = randomUUID();
    const expiresIn = this.config.getOrThrow<number>('JWT_ACCESS_TTL_SECONDS');
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      role: user.role,
      sid: sessionId,
    });
    await tx.refreshToken.create({
      data: {
        id: sessionId,
        userId: user.id,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_LIFETIME_MS),
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
    return { accessToken, refreshToken, expiresIn };
  }
}
