import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { SYSTEM_QUEUE } from '../jobs/jobs.module';
@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(SYSTEM_QUEUE) private readonly queue: Queue,
  ) {}
  async readiness() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([
          this.prisma.$queryRaw`SELECT 1`,
          this.queue.getJobCounts('wait'),
        ]),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Health timeout')), 3000);
        }),
      ]);
      return { status: 'ok', database: 'up', redis: 'up' };
    } catch {
      throw new ServiceUnavailableException('Database or queue unavailable');
    } finally {
      clearTimeout(timer);
    }
  }
}
