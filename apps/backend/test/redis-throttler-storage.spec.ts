import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisThrottlerStorage } from '../src/common/rate-limit/redis-throttler.storage';

const HOST = process.env.REDIS_HOST || '127.0.0.1';
const PORT = Number(process.env.REDIS_PORT || 6379);
const PREFIX = `test:rate-limit:${Date.now()}:${Math.random().toString(16).slice(2)}:`;

function config(mode = 'redis', prefix = PREFIX): ConfigService {
  const values: Record<string, unknown> = {
    RATE_LIMIT_STORAGE: mode,
    RATE_LIMIT_KEY_PREFIX: prefix,
    REDIS_HOST: HOST,
    REDIS_PORT: PORT,
  };
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (values[key] === undefined) throw new Error(`missing ${key}`);
      return values[key];
    },
  } as unknown as ConfigService;
}

describe('Redis throttler storage', () => {
  let available = true;
  let storage: RedisThrottlerStorage;
  let cleanup: Redis;

  beforeAll(async () => {
    cleanup = new Redis({
      host: HOST,
      port: PORT,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: true,
      connectTimeout: 1500,
      retryStrategy: () => null,
    });
    try {
      await cleanup.ping();
    } catch {
      available = false;
      console.warn('Redis is unavailable; Redis throttler tests were skipped');
      return;
    }
    storage = new RedisThrottlerStorage(config());
  });

  afterAll(async () => {
    if (storage) await storage.onApplicationShutdown();
    if (cleanup) {
      try {
        const keys = await cleanup.keys(`${PREFIX}*`);
        if (keys.length) await cleanup.del(...keys);
        await cleanup.quit();
      } catch {
        /* best effort */
      }
    }
  });

  it('enforces the limit and reports Retry-After timing', async () => {
    if (!available) return;
    const key = 'limit';
    const first = await storage.increment(key, 5000, 2, 1000, 'default');
    const second = await storage.increment(key, 5000, 2, 1000, 'default');
    const blocked = await storage.increment(key, 5000, 2, 1000, 'default');
    expect(first.isBlocked).toBe(false);
    expect(second.isBlocked).toBe(false);
    expect(blocked.isBlocked).toBe(true);
    expect(blocked.timeToBlockExpire).toBeGreaterThanOrEqual(1);
  });

  it('increments atomically under concurrency', async () => {
    if (!available) return;
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        storage.increment('concurrent', 5000, 3, 5000, 'default'),
      ),
    );
    expect(results.filter((result) => !result.isBlocked)).toHaveLength(3);
    expect(results.filter((result) => result.isBlocked)).toHaveLength(7);
  });

  it('expires counters and blocks after the configured window', async () => {
    if (!available) return;
    const key = 'expiry';
    await storage.increment(key, 300, 1, 300, 'default');
    expect((await storage.increment(key, 300, 1, 300, 'default')).isBlocked).toBe(
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 450));
    const after = await storage.increment(key, 300, 1, 300, 'default');
    expect(after.isBlocked).toBe(false);
    expect(after.totalHits).toBe(1);
  });

  it('stays disabled when memory storage is configured', async () => {
    const memory = new RedisThrottlerStorage(config('memory'));
    expect(memory.enabled).toBe(false);
    await expect(
      memory.increment('disabled', 1000, 1, 1000, 'default'),
    ).rejects.toThrow(/not enabled/);
    await memory.onApplicationShutdown();
  });
});
