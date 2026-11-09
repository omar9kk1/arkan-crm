import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';

interface RateLimitRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Optional Redis-backed throttler storage.
 *
 * Enabled only with RATE_LIMIT_STORAGE=redis. Keys are already SHA-256 hashed
 * by Nest's ThrottlerGuard; this class adds a namespace only. Counters and
 * blocks expire, so storage is bounded by the number of active trackers.
 *
 * The Lua script makes increment+expire+block atomic across instances. If
 * Redis is unavailable while selected, requests fail rather than silently
 * disabling protection.
 */
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local blockPttl = redis.call('PTTL', KEYS[2])
if blockPttl and blockPttl > 0 then
  return {hits, redis.call('PTTL', KEYS[1]), 1, blockPttl}
end
if hits > tonumber(ARGV[3]) then
  local blockDuration = tonumber(ARGV[2])
  if blockDuration > 0 then
    redis.call('SET', KEYS[2], '1', 'PX', blockDuration)
  end
  return {hits, redis.call('PTTL', KEYS[1]), 1, blockDuration}
end
return {hits, redis.call('PTTL', KEYS[1]), 0, 0}
`;

function secondsFromPttl(pttl: number, fallbackMs: number): number {
  const value = pttl > 0 ? pttl : fallbackMs;
  return Math.max(1, Math.ceil(value / 1000));
}

@Injectable()
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnApplicationShutdown
{
  private readonly client: Redis | null;
  private readonly keyPrefix: string;

  constructor(config: ConfigService) {
    const enabled = config.get<string>('RATE_LIMIT_STORAGE') === 'redis';
    this.keyPrefix =
      config.get<string>('RATE_LIMIT_KEY_PREFIX') || 'arkan:rate-limit:';
    this.client = enabled
      ? new Redis({
          host: config.getOrThrow<string>('REDIS_HOST'),
          port: config.getOrThrow<number>('REDIS_PORT'),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: true,
          lazyConnect: false,
        })
      : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<RateLimitRecord> {
    if (!this.client)
      throw new Error('Redis rate-limit storage is not enabled');
    const counterKey = `${this.keyPrefix}${key}`;
    const blockKey = `${counterKey}:block:${throttlerName}`;
    const result = (await this.client.eval(
      INCREMENT_SCRIPT,
      2,
      counterKey,
      blockKey,
      ttl,
      blockDuration,
      limit,
    )) as [number, number, number, number];
    const [totalHits, counterPttl, blocked, blockPttl] = result;
    return {
      totalHits: Number(totalHits),
      timeToExpire: secondsFromPttl(Number(counterPttl), ttl),
      isBlocked: Number(blocked) === 1,
      timeToBlockExpire:
        Number(blocked) === 1
          ? secondsFromPttl(Number(blockPttl), blockDuration || ttl)
          : 0,
    };
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client) await this.client.quit().catch(() => undefined);
  }
}
