import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, type NotificationType } from '@prisma/client';
import type { AuthUser } from '@arkan/shared';
import { PrismaService } from '../prisma/prisma.service';
import { resolveLimit } from '../common/pagination';
import { propertyVisibilityWhere } from '../properties/property-visibility';
import type { ListNotificationsQueryDto } from './dto/list-notifications.query';
import {
  PROPERTY_EVENT_TITLES,
  notificationEventKeys,
  propertyEventBody,
  type NotificationDraft,
  type PropertyEventContext,
} from './notification-events';
import {
  toNotificationDto,
  type NotificationPageDto,
  type UnreadCountDto,
} from './notification.dto';

/** Columns read for a notification row — never `include`, never a raw entity. */
const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  readAt: true,
  createdAt: true,
  propertyId: true,
} satisfies Prisma.NotificationSelect;

/**
 * In-app notifications: the per-recipient inbox API plus the event writers that
 * the property workflow calls INSIDE its own transaction.
 *
 * Recipients are always derived from the database (active managers / active
 * employees) or from the property's own creator — never from client input.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Event delivery (runs inside the property transaction)
  // ---------------------------------------------------------------------------

  /**
   * Inserts the drafts using the caller's transaction, so a notification row can
   * never commit when the property transition it describes rolls back — and vice
   * versa.
   *
   * `skipDuplicates` together with the database `(userId, eventKey)` unique index
   * makes delivery idempotent: a retried or concurrent duplicate of the same
   * event is silently skipped instead of creating a second notification.
   */
  private async deliver(
    tx: Prisma.TransactionClient,
    drafts: NotificationDraft[],
  ): Promise<void> {
    const seen = new Set<string>();
    const unique = drafts.filter((draft) => {
      const key = `${draft.userId}\u0000${draft.eventKey}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (unique.length === 0) return;
    await tx.notification.createMany({ data: unique, skipDuplicates: true });
  }

  /** Ids of active users with a role, optionally excluding one recipient. */
  private async activeUserIds(
    tx: Prisma.TransactionClient,
    role: Role,
    excludeUserId?: string | null,
  ): Promise<string[]> {
    const users = await tx.user.findMany({
      where: {
        role,
        isActive: true,
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
      select: { id: true },
    });
    return users.map((user) => user.id);
  }

  private propertyDraft(
    userId: string,
    context: PropertyEventContext,
    event: { type: NotificationType; title: string; eventKey: string },
  ): NotificationDraft {
    return {
      userId,
      type: event.type,
      title: event.title,
      body: propertyEventBody(context.reference),
      propertyId: context.propertyId,
      eventKey: event.eventKey,
    };
  }

  /** 1. Employee submitted a property → every active manager. */
  async notifyPropertySubmitted(
    tx: Prisma.TransactionClient,
    context: PropertyEventContext,
  ): Promise<void> {
    const managers = await this.activeUserIds(tx, Role.MANAGER);
    await this.deliver(
      tx,
      managers.map((userId) =>
        this.propertyDraft(userId, context, {
          type: 'PROPERTY_SUBMITTED',
          title: PROPERTY_EVENT_TITLES.SUBMITTED,
          eventKey: notificationEventKeys.submitted(context.propertyId),
        }),
      ),
    );
  }

  /** 4. Employee resubmitted a corrected property → every active manager. */
  async notifyPropertyResubmitted(
    tx: Prisma.TransactionClient,
    context: PropertyEventContext,
  ): Promise<void> {
    const managers = await this.activeUserIds(tx, Role.MANAGER);
    await this.deliver(
      tx,
      managers.map((userId) =>
        this.propertyDraft(userId, context, {
          type: 'PROPERTY_RESUBMITTED',
          title: PROPERTY_EVENT_TITLES.RESUBMITTED,
          eventKey: notificationEventKeys.resubmitted(
            context.approvalRequestId,
            context.propertyId,
          ),
        }),
      ),
    );
  }

  /** 2. Manager requested changes → the property's creator. */
  async notifyPropertyChangesRequested(
    tx: Prisma.TransactionClient,
    context: PropertyEventContext,
  ): Promise<void> {
    if (!context.creatorId) return;
    await this.deliver(tx, [
      this.propertyDraft(context.creatorId, context, {
        type: 'PROPERTY_CHANGES_REQUESTED',
        title: PROPERTY_EVENT_TITLES.CHANGES_REQUESTED,
        eventKey: notificationEventKeys.changesRequested(
          context.approvalRequestId,
          context.propertyId,
        ),
      }),
    ]);
  }

  /** 3. Manager rejected a property → the property's creator. */
  async notifyPropertyRejected(
    tx: Prisma.TransactionClient,
    context: PropertyEventContext,
  ): Promise<void> {
    if (!context.creatorId) return;
    await this.deliver(tx, [
      this.propertyDraft(context.creatorId, context, {
        type: 'PROPERTY_REJECTED',
        title: PROPERTY_EVENT_TITLES.REJECTED,
        eventKey: notificationEventKeys.rejected(
          context.approvalRequestId,
          context.propertyId,
        ),
      }),
    ]);
  }

  /** 5. Manager approved the creator's property → the property's creator. */
  async notifyPropertyApproved(
    tx: Prisma.TransactionClient,
    context: PropertyEventContext,
  ): Promise<void> {
    if (!context.creatorId) return;
    await this.deliver(tx, [
      this.propertyDraft(context.creatorId, context, {
        type: 'PROPERTY_APPROVED',
        title: PROPERTY_EVENT_TITLES.APPROVED,
        eventKey: notificationEventKeys.approved(
          context.approvalRequestId,
          context.propertyId,
          context.version,
        ),
      }),
    ]);
  }

  /**
   * 6. A property became AVAILABLE (approval or direct manager creation) →
   * every active employee authorized to view it, EXCEPT its own creator, who
   * already received the more specific approval notification.
   *
   * Under the current visibility policy every employee may read an AVAILABLE
   * property, so the recipient set is "all active employees"; the creator is
   * excluded to keep the notification non-redundant.
   */
  async notifyPropertyAvailable(
    tx: Prisma.TransactionClient,
    context: PropertyEventContext,
  ): Promise<void> {
    const employees = await this.activeUserIds(
      tx,
      Role.EMPLOYEE,
      context.creatorId,
    );
    await this.deliver(
      tx,
      employees.map((userId) =>
        this.propertyDraft(userId, context, {
          type: 'PROPERTY_AVAILABLE',
          title: PROPERTY_EVENT_TITLES.AVAILABLE,
          eventKey: notificationEventKeys.available(context.propertyId),
        }),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Recipient inbox API
  // ---------------------------------------------------------------------------

  /**
   * The caller's own notifications, newest first, cursor-paginated.
   *
   * `propertyId` is cleared for any linked property the caller may not read, so
   * the bell can never offer a deep link into a record the API would refuse.
   */
  async list(
    viewer: AuthUser,
    query: ListNotificationsQueryDto,
  ): Promise<NotificationPageDto> {
    const limit = resolveLimit(query.limit);
    const rows = await this.prisma.notification.findMany({
      // Ownership comes from the JWT identity, never from a query parameter.
      where: { userId: viewer.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: NOTIFICATION_SELECT,
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const visible = await this.visiblePropertyIds(
      viewer,
      items.map((row) => row.propertyId),
    );
    return {
      items: items.map((row) =>
        toNotificationDto(
          row,
          row.propertyId && visible.has(row.propertyId)
            ? row.propertyId
            : null,
        ),
      ),
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    };
  }

  /** How many of the caller's notifications are still unread. */
  async unreadCount(viewer: AuthUser): Promise<UnreadCountDto> {
    const count = await this.prisma.notification.count({
      where: { userId: viewer.id, readAt: null },
    });
    return { count };
  }

  /**
   * Marks one of the caller's notifications read. Idempotent (reading an
   * already-read row is a no-op success) and non-disclosing: an id that does not
   * belong to the caller resolves to 404, exactly like an id that does not exist.
   */
  async markRead(
    viewer: AuthUser,
    id: string,
  ): Promise<{ id: string; read: true }> {
    const owned = await this.prisma.notification.findFirst({
      where: { id, userId: viewer.id },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Notification not found');
    await this.prisma.notification.updateMany({
      where: { id: owned.id, userId: viewer.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { id: owned.id, read: true };
  }

  /** Marks every unread notification of the caller read; returns how many. */
  async markAllRead(viewer: AuthUser): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId: viewer.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  /** Subset of the given property ids the viewer is authorized to open. */
  private async visiblePropertyIds(
    viewer: AuthUser,
    ids: (string | null)[],
  ): Promise<Set<string>> {
    const propertyIds = [
      ...new Set(ids.filter((id): id is string => id !== null)),
    ];
    if (propertyIds.length === 0) return new Set();
    const visible = await this.prisma.property.findMany({
      where: { id: { in: propertyIds }, ...propertyVisibilityWhere(viewer) },
      select: { id: true },
    });
    return new Set(visible.map((property) => property.id));
  }
}
