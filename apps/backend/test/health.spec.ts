import { HealthService } from '../src/health/health.service';
import { ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { Queue } from 'bullmq';
describe('Readiness', () => {
  function service(databaseAvailable: boolean, redisAvailable: boolean) {
    const prisma = {
      $queryRaw: () =>
        databaseAvailable
          ? Promise.resolve([1])
          : Promise.reject(new Error('database down')),
    };
    const queue = {
      getJobCounts: () =>
        redisAvailable
          ? Promise.resolve({ wait: 0 })
          : Promise.reject(new Error('redis down')),
    };
    return new HealthService(
      prisma as unknown as PrismaService,
      queue as unknown as Queue,
    );
  }
  it('requires both dependencies', async () => {
    await expect(service(true, true).readiness()).resolves.toEqual({
      status: 'ok',
      database: 'up',
      redis: 'up',
    });
    await expect(service(false, true).readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(service(true, false).readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
