import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthCookieService } from './auth-cookie.service';
import { CsrfService } from './csrf.service';
import { CsrfGuard } from './guards/csrf.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { AppThrottlerGuard } from '../common/guards/app-throttler.guard';
import { RateLimitModule } from '../common/rate-limit/rate-limit.module';
import { RedisThrottlerStorage } from '../common/rate-limit/redis-throttler.storage';
import {
  RATE_LIMIT_DEFAULTS,
  rateLimit,
  rateLimitWindowMs,
} from '../config/rate-limit';
import { PrismaModule } from '../prisma/prisma.module';
@Module({
  imports: [
    PrismaModule,
    RateLimitModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule, RateLimitModule],
      inject: [RedisThrottlerStorage],
      useFactory: (redisStorage: RedisThrottlerStorage) => ({
        throttlers: [
          {
            name: 'default',
            limit: rateLimit('GLOBAL', RATE_LIMIT_DEFAULTS.global),
            ttl: rateLimitWindowMs,
          },
        ],
        ...(redisStorage.enabled ? { storage: redisStorage } : {}),
      }),
    }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: config.getOrThrow<number>('JWT_ACCESS_TTL_SECONDS'),
          issuer: config.getOrThrow<string>('JWT_ISSUER'),
          audience: config.getOrThrow<string>('JWT_AUDIENCE'),
        },
        verifyOptions: {
          algorithms: ['HS256'],
          issuer: config.getOrThrow<string>('JWT_ISSUER'),
          audience: config.getOrThrow<string>('JWT_AUDIENCE'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthCookieService,
    CsrfService,
    ThrottlerGuard,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
  exports: [AuthCookieService, CsrfService],
})
export class AuthModule {}
