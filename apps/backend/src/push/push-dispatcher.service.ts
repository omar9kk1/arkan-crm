import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PushService, type PushableNotification } from './push.service';

/** How many failed attempts a row gets before it is given up on. */
const MAX_ATTEMPTS = 3;
/** How many processed ids are remembered for de-duplication. */
const PROCESSED_MEMORY = 500;

/**
 * Delivers the EXISTING in-app notifications to the browsers that asked for
 * outside-the-app pushes.
 *
 * It reads the committed `Notification` rows — the same rows the bell shows —
 * so no event producer is duplicated and no second source of truth is created.
 * A row is only pushed AFTER it was committed (the row exists in the
 * database), and every send re-validates the recipient's session lineage.
 */
@Injectable()
export class PushDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PushDispatcherService.name);
  /** The newest notification row already considered for delivery. */
  private since: Date | null = null;
  private readonly processed = new Set<string>();
  private readonly attempts = new Map<string, number>();
  private readonly pending: PushableNotification[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  onModuleInit(): void {
    // Only rows created from now on are pushed: the backlog of older
    // notifications is not a "new event" for any device.
    this.since = new Date();
    // In the test environment the dispatcher is driven explicitly, so the
    // background timer never races the assertions.
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, 3000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One delivery pass. Public so the tests can drive it deterministically
   * instead of waiting for the timer.
   */
  async runOnce(): Promise<void> {
    if (!this.push.configured) return;
    const since = this.since ?? new Date();
    const rows = await this.prisma.notification.findMany({
      where: { createdAt: { gte: since }, type: { not: 'SYSTEM' } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
      include: { contact: { select: { type: true } } },
    });
    const fresh: PushableNotification[] = rows
      .filter((row) => !this.processed.has(row.id))
      .map((row) => ({
        id: row.id,
        type: row.type as NotificationType,
        title: row.title,
        body: row.body,
        userId: row.userId,
        propertyId: row.propertyId,
        clientId: row.clientId,
        contactId: row.contactId,
        contactType: row.contact?.type ?? null,
        createdAt: row.createdAt,
      }));

    const batch = [...this.pending, ...fresh];
    this.pending.length = 0;
    for (const row of batch) {
      const attempt = await this.push.deliver(row);
      this.remember(row.id);
      // One line per dispatched event: the delivery count is the only way to
      // tell "sent" from "skipped" without guessing.
      this.logger.log(
        `Push dispatch ${row.type}: delivered=${attempt.delivered} retryable=${attempt.retryable}`,
      );
      if (attempt.retryable > 0) {
        const tries = (this.attempts.get(row.id) ?? 0) + 1;
        this.attempts.set(row.id, tries);
        if (tries < MAX_ATTEMPTS) this.pending.push(row);
        else this.logger.warn(`Giving up on push for notification ${row.id}`);
      }
      if (row.createdAt > (this.since ?? since)) this.since = row.createdAt;
    }
  }

  private remember(id: string): void {
    this.processed.add(id);
    if (this.processed.size > PROCESSED_MEMORY) {
      const oldest = this.processed.values().next().value;
      if (oldest) this.processed.delete(oldest);
    }
  }
}
