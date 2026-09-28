import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role, AuthUser } from '@arkan/shared';
import type { Request } from 'express';
import { IS_PUBLIC } from '../decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
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
    const match = /^Bearer ([^\s]+)$/i.exec(
      request.headers.authorization ?? '',
    );
    if (!match?.[1]) throw new UnauthorizedException('Bearer token required');
    try {
      const payload = await this.jwt.verifyAsync<Record<string, unknown>>(
        match[1],
      );
      if (
        typeof payload.sub !== 'string' ||
        !payload.sub ||
        typeof payload.exp !== 'number' ||
        typeof payload.sid !== 'string' ||
        (payload.role !== Role.MANAGER && payload.role !== Role.EMPLOYEE)
      )
        throw new Error('Invalid claims');
      const session = await this.prisma.refreshToken.findUnique({
        where: { id: payload.sid as string },
        include: { user: true },
      });
      if (
        !session ||
        session.userId !== payload.sub ||
        session.revokedAt ||
        session.expiresAt <= new Date() ||
        !session.user.isActive ||
        session.user.role !== payload.role
      )
        throw new Error('Inactive session');
      request.user = { id: session.userId, role: session.user.role };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
