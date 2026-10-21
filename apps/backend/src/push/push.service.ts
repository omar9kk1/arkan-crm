import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, type AuthUser } from '@arkan/shared';
import type { NotificationType, PushSubscription } from '@prisma/client';
import webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { isRecordEvent, pushTargetUrl } from './push-target';
import { pushPreviewBody } from './push-preview';
import type {
  SubscribePushDto,
  UnsubscribePushDto,
} from './dto/push-subscription.dto';

/** The notification row a push is built from. */
export interface PushableNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  userId: string;
  propertyId: string | null;
  clientId: string | null;
  contactId: string | null;
  contactType: 'OWNER' | 'BROKER' | null;
  createdAt: Date;
}

/** The outcome of one delivery attempt, used by the dispatcher for retries. */
export interface PushAttempt {
  delivered: number;
  /** Rows that failed with a retryable error and must be attempted again. */
  retryable: number;
}

/**
 * Web Push delivery and subscription management.
 *
 * A subscription is bound to the AUTHENTICATED manager and to the session
 * lineage the server resolved from the live session row — the browser never
 * tells the server who it is. Before every single send the service re-checks
 * that the owning session lineage is still alive, that the account is still
 * active and that the account still holds the role the event requires, so a
 * signed-out, deactivated or demoted account can never receive a push.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private vapidReady = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Whether the deployment has VAPID keys configured. */
  get configured(): boolean {
    return Boolean(this.publicKey && this.privateKey);
  }

  get publicKey(): string | null {
    return this.config.get<string>('PUSH_VAPID_PUBLIC_KEY') || null;
  }

  get privateKey(): string | null {
    return this.config.get<string>('PUSH_VAPID_PRIVATE_KEY') || null;
  }

  /** Configures the VAPID details once, from the environment only. */
  ensureVapid(): boolean {
    if (this.vapidReady) return true;
    const publicKey = this.publicKey;
    const privateKey = this.privateKey;
    const subject = this.config.get<string>('PUSH_VAPID_SUBJECT');
    if (!publicKey || !privateKey || !subject) return false;
    webpush.setVapidDetails(subject, publicKey, privateKey);
    this.vapidReady = true;
    return true;
  }

  /** The public configuration the browser needs to subscribe. */
  configuration() {
    return {
      configured: this.configured,
      publicKey: this.publicKey,
      subject: this.config.get<string>('PUSH_VAPID_SUBJECT') || null,
    };
  }

  /** Whether THIS device (this browser) currently holds a subscription. */
  async status(viewer: AuthUser): Promise<{ subscribed: boolean }> {
    const rows = await this.ownSubscriptions(viewer);
    return { subscribed: rows.length > 0 };
  }

  /**
   * Binds a browser subscription to the authenticated manager and to the
   * verified session lineage.
   *
   * The endpoint is unique per browser: subscribing REPLACES whatever row the
   * endpoint had (even one owned by another account), so a shared browser can
   * never keep delivering another account's notifications.
   */
  async subscribe(
    viewer: AuthUser,
    dto: SubscribePushDto,
  ): Promise<{ subscribed: true }> {
    if (!this.configured)
      throw new ServiceUnavailableException(
        'الإشعارات الخارجية غير مُهيأة على هذا الخادم.',
      );
    if (!viewer.sessionLineageId)
      throw new ConflictException(
        'أعد تسجيل الدخول لتفعيل الإشعارات الخارجية على هذا الجهاز.',
      );
    await this.prisma.pushSubscription.deleteMany({
      where: { endpoint: dto.endpoint },
    });
    await this.prisma.pushSubscription.create({
      data: {
        userId: viewer.id,
        lineageId: viewer.sessionLineageId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userAgent: dto.userAgent?.slice(0, 400) || null,
      },
    });
    return { subscribed: true };
  }

  /**
   * Removes the subscription of THIS device. Only rows owned by the caller and
   * bound to the caller's own session lineage can be removed.
   */
  async unsubscribe(
    viewer: AuthUser,
    dto: UnsubscribePushDto,
  ): Promise<{ subscribed: false }> {
    const rows = await this.ownSubscriptions(viewer);
    const targets = dto.endpoint
      ? rows.filter((row) => row.endpoint === dto.endpoint)
      : rows;
    if (targets.length) {
      await this.prisma.pushSubscription.deleteMany({
        where: { id: { in: targets.map((row) => row.id) } },
      });
    }
    return { subscribed: false };
  }

  /** The caller's own subscriptions, restricted to their own lineage. */
  private async ownSubscriptions(viewer: AuthUser): Promise<PushSubscription[]> {
    return this.prisma.pushSubscription.findMany({
      where: {
        userId: viewer.id,
        ...(viewer.sessionLineageId
          ? { lineageId: viewer.sessionLineageId }
          : { id: '__none__' }),
      },
    });
  }

  /**
   * Sends one notification row to every subscription of its recipient that is
   * still allowed to receive it.
   */
  async deliver(
    row: PushableNotification,
  ): Promise<PushAttempt> {
    if (!this.configured || !this.ensureVapid()) {
      return { delivered: 0, retryable: 0 };
    }
    const recipient = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: { id: true, role: true, isActive: true },
    });
    if (!recipient || !recipient.isActive) return { delivered: 0, retryable: 0 };
    // Record-activity events are a manager feed: a demoted account must not
    // keep receiving them.
    if (isRecordEvent(row.type) && recipient.role !== Role.MANAGER) {
      return { delivered: 0, retryable: 0 };
    }

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId: row.userId },
    });
    const url = pushTargetUrl(
      {
        type: row.type,
        propertyId: row.propertyId,
        clientId: row.clientId,
        contactId: row.contactId,
        contactType: row.contactType,
      },
      recipient.role,
    );

    let delivered = 0;
    let retryable = 0;
    for (const subscription of subscriptions) {
      const alive = await this.lineageAlive(subscription.lineageId);
      if (!alive) {
        // The session that owned this device is gone: the subscription dies
        // with it, so a signed-out device can never be pushed to again.
        await this.prisma.pushSubscription.delete({
          where: { id: subscription.id },
        });
        continue;
      }
      if (!url) continue;
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          JSON.stringify({
            title: row.title,
            // The push carries a concise preview; the FULL verified list stays
            // in the in-app notification the push opens.
            body: pushPreviewBody(row.body),
            url,
            notificationId: row.id,
          }),
          { TTL: 3600, urgency: 'normal' },
        );
        delivered += 1;
      } catch (cause) {
        const status = (cause as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // The browser dropped the subscription: clean it up.
          await this.prisma.pushSubscription.delete({
            where: { id: subscription.id },
          });
          continue;
        }
        if (status === 401 || status === 403) {
          // The push service rejected our VAPID identity: nothing to retry,
          // but it must be visible — a silent skip looks like "no delivery".
          this.logger.warn(
            `Push service rejected the delivery (status ${status}) for ${subscription.id}`,
          );
          continue;
        }
        retryable += 1;
        this.logger.warn(
          `Push delivery failed for ${subscription.id}: ${(cause as Error).message}`,
        );
      }
    }
    return { delivered, retryable };
  }

  /**
   * Sends a benign test message to the CALLER's own live devices.
   *
   * It proves the whole path (browser → provider → service worker → toast)
   * without creating any business record and without writing an in-app
   * notification row, so it can never duplicate a real notification.
   */
  async sendTestToSelf(
    viewer: AuthUser,
  ): Promise<{ sent: number; devices: number }> {
    if (!this.configured || !this.ensureVapid()) {
      throw new ServiceUnavailableException(
        'الإشعارات الخارجية غير مُهيأة على هذا الخادم.',
      );
    }
    const subscriptions = await this.ownSubscriptions(viewer);
    let sent = 0;
    for (const subscription of subscriptions) {
      // The same safety rules as a real delivery: a live session lineage and
      // an active account.
      if (!(await this.lineageAlive(subscription.lineageId))) {
        await this.prisma.pushSubscription.delete({
          where: { id: subscription.id },
        });
        continue;
      }
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify({
            title: 'أركان الخليج العقارية',
            body: 'وصلتك رسالة تجريبية — الإشعارات الخارجية تعمل بشكل صحيح.',
            url: '/manager',
            notificationId: `test-${subscription.id}`,
          }),
          { TTL: 3600, urgency: 'normal' },
        );
        sent += 1;
      } catch (cause) {
        const status = (cause as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await this.prisma.pushSubscription.delete({
            where: { id: subscription.id },
          });
          continue;
        }
        throw cause;
      }
    }
    return { sent, devices: subscriptions.length };
  }

  /** Whether the session lineage of a subscription still has a live session. */
  private async lineageAlive(lineageId: string): Promise<boolean> {
    const row = await this.prisma.refreshToken.findFirst({
      where: {
        lineageId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    return row !== null;
  }
}
