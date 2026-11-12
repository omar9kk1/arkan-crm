import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, Role, type NotificationType } from '@prisma/client';
import type { AuthUser } from '@arkan/shared';
import { PrismaService } from '../prisma/prisma.service';
import { resolveLimit } from '../common/pagination';
import { propertyVisibilityWhere } from '../properties/property-visibility';
import {
  isManagement,
  reviewNotificationRecipientIds,
  reviewNotificationRecipientIdsForUser,
} from '../common/access/access-policy';
import type { ListNotificationsQueryDto } from './dto/list-notifications.query';
import {
  PROPERTY_EVENT_TITLES,
  notificationEventKeys,
  propertyEventBody,
  recordEventBody,
  recordEventKeys,
  recordEventTitle,
  clientReviewManagerBody,
  clientReviewDecisionBody,
  clientReviewEventKeys,
  CLIENT_REVIEW_TITLES,
  type ClientReviewDecision,
  type EmployeeRecordEvent,
  type NotificationDraft,
  type PropertyEventContext,
  type RecordEventContext,
} from './notification-events';
import {
  toNotificationDto,
  type NotificationDuplicateContextDto,
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
  clientId: true,
  contactId: true,
  followUpId: true,
  clientReviewId: true,
  // Employee follow-up escalation deep link (masked for managers at the DTO).
  followUpSubjectId: true,
  // The stored per-recipient dedup key — the FOLLOWUP_CREATED entry target.
  eventKey: true,
  // The CURRENT code of the linked property: historical notification bodies may
  // still carry a retired code, so the current one is resolved from the
  // property row (the stored text itself is never rewritten).
  property: { select: { reference: true, approvedReference: true } },
  // Only the contact's type is needed (for the bell's routing); the contact's
  // private fields (phone/notes) are never read for a notification row.
  contact: { select: { type: true } },
} satisfies Prisma.NotificationSelect;

function formatDecisionDate(date: Date): string {
  try {
    return new Intl.DateTimeFormat('ar-KW', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Kuwait',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

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

  /**
   * Deliver drafts that were prepared outside a single "property transition"
   * transaction (e.g. the follow-ups saveBatch). Idempotent like every other
   * delivery path.
   */
  async deliverDrafts(
    tx: Prisma.TransactionClient,
    drafts: NotificationDraft[],
  ): Promise<void> {
    await this.deliver(tx, drafts);
  }

  /**
   * Public delivery hook for the follow-ups scheduler: ONE call inserts every
   * prepared escalation draft with the same `(userId, eventKey)` idempotency
   * as every other event (the scheduler commits this together with its cycle
   * flags, so a crash can never notify without recording — or vice versa).
   */
  async deliverFollowUpDrafts(
    tx: Prisma.TransactionClient,
    drafts: NotificationDraft[],
  ): Promise<void> {
    await this.deliver(tx, drafts);
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
      body: propertyEventBody(context.reference, context.changeSummary),
      propertyId: context.propertyId,
      eventKey: event.eventKey,
    };
  }

  /** 1. Employee submitted a property → the direct supervisor only. */
  async notifyPropertySubmitted(
    tx: Prisma.TransactionClient,
    context: PropertyEventContext,
  ): Promise<void> {
    const recipients = context.creatorId
      ? await reviewNotificationRecipientIdsForUser(tx, context.creatorId)
      : [];
    await this.deliver(
      tx,
      recipients.map((userId) =>
        this.propertyDraft(userId, context, {
          type: 'PROPERTY_SUBMITTED',
          title: PROPERTY_EVENT_TITLES.SUBMITTED,
          eventKey: notificationEventKeys.submitted(context.propertyId),
        }),
      ),
    );
  }

  /** 4. Employee resubmitted a corrected property → the direct supervisor only. */
  async notifyPropertyResubmitted(
    tx: Prisma.TransactionClient,
    context: PropertyEventContext,
  ): Promise<void> {
    const recipients = context.creatorId
      ? await reviewNotificationRecipientIdsForUser(tx, context.creatorId)
      : [];
    // An EDITED property that was already in the program is announced with the
    // fields that really changed, so the manager can decide with the facts. A
    // property that enters the program for the first time keeps the plain
    // "awaiting review" wording.
    const isUpdate = context.submissionKind === 'UPDATED';
    await this.deliver(
      tx,
      recipients.map((userId) =>
        this.propertyDraft(userId, context, {
          type: 'PROPERTY_RESUBMITTED',
          title: isUpdate
            ? PROPERTY_EVENT_TITLES.RESUBMITTED_UPDATED
            : PROPERTY_EVENT_TITLES.RESUBMITTED,
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

  /**
   * 3. Manager rejected a property → the property's creator.
   *
   * Includes the code, the Manager's actual reason and the decision date. The
   * reason is shown ONLY to the creator (never to another employee) and is
   * never part of a broadcast/manager notification.
   */
  async notifyPropertyRejected(
    tx: Prisma.TransactionClient,
    context: PropertyEventContext,
    details: { reason: string; decidedAt: Date; isDuplicate: boolean },
  ): Promise<void> {
    if (!context.creatorId) return;
    await this.deliver(tx, [
      {
        userId: context.creatorId,
        type: 'PROPERTY_REJECTED',
        title: PROPERTY_EVENT_TITLES.REJECTED,
        body: this.decisionBody({
          message:
            'تم رفض طلب تسجيل عقارك. يمكنك الاطلاع على سبب الرفض وتفاصيل العقار.',
          reference: context.reference,
          reasonLabel: 'سبب الرفض',
          reason: details.reason,
          date: details.decidedAt,
          isDuplicate: details.isDuplicate,
        }),
        propertyId: context.propertyId,
        eventKey: notificationEventKeys.rejected(
          context.approvalRequestId,
          context.propertyId,
        ),
      },
    ]);
  }

  /**
   * Manager soft-deleted a property → its creator. The property still exists
   * (Trash), so the notification remains clickable/readable; permanent deletion
   * later nulls the link but keeps the decision row for history.
   */
  async notifyPropertyTrashed(
    tx: Prisma.TransactionClient,
    context: PropertyEventContext,
    details: { reason: string | null; deletedAt: Date; isDuplicate: boolean },
  ): Promise<void> {
    if (!context.creatorId) return;
    await this.deliver(tx, [
      {
        userId: context.creatorId,
        type: 'SYSTEM',
        title: PROPERTY_EVENT_TITLES.TRASHED,
        body: this.decisionBody({
          message:
            'تم نقل عقارك إلى المحذوفات. يمكنك الاطلاع على تفاصيله وسبب الحذف.',
          reference: context.reference,
          reasonLabel: 'سبب الحذف',
          reason: details.reason,
          date: details.deletedAt,
          isDuplicate: details.isDuplicate,
        }),
        propertyId: context.propertyId,
        eventKey: notificationEventKeys.trashed(context.propertyId),
      },
    ]);
  }

  /**
   * Manager restored a property → its creator. The property keeps its original
   * status and P/A code; only the Trash marker is cleared.
   */
  async notifyPropertyRestored(
    tx: Prisma.TransactionClient,
    context: PropertyEventContext,
    details: { restoredAt: Date; trashedAt: Date },
  ): Promise<void> {
    if (!context.creatorId) return;
    await this.deliver(tx, [
      {
        userId: context.creatorId,
        type: 'SYSTEM',
        title: PROPERTY_EVENT_TITLES.RESTORED,
        body: [
          'قام مالك النظام باستعادة عقارك من المحذوفات، وأصبح متاحًا مرة أخرى في قائمة عقاراتك.',
          `رقم العقار: ${context.reference}`,
          `التاريخ: ${formatDecisionDate(details.restoredAt)}`,
        ].join('\n'),
        propertyId: context.propertyId,
        eventKey: notificationEventKeys.restored(
          context.propertyId,
          details.trashedAt,
        ),
      },
    ]);
  }

  /**
   * An employee saved a genuine change to their own PENDING property → every
   * active manager. The row stays PENDING; only the reviewer is told to look at
   * the latest values before deciding.
   *
   * The body is built from server-authoritative data: the current property code,
   * the employee's database name and the already-formatted public field labels.
   * It never carries a contact, phone number, review note or a raw payload.
   */
  async notifyPropertyEdited(
    tx: Prisma.TransactionClient,
    context: PropertyEventContext,
    details: {
      employeeName: string;
      changeSummary: string;
      editedAt: Date;
    },
  ): Promise<void> {
    const recipients = context.creatorId
      ? await reviewNotificationRecipientIdsForUser(tx, context.creatorId)
      : [];
    const lines = [
      'قام الموظف بتحديث بيانات عقار بانتظار المراجعة. يُرجى الاطلاع على التعديلات.',
      `رقم العقار: ${context.reference}`,
      `الموظف: ${details.employeeName}`,
      `التعديلات: ${details.changeSummary}`,
      `التاريخ: ${formatDecisionDate(details.editedAt)}`,
    ];
    await this.deliver(
      tx,
      recipients.map((userId) => ({
        userId,
        type: 'SYSTEM',
        title: PROPERTY_EVENT_TITLES.EDITED,
        body: lines.join('\n'),
        propertyId: context.propertyId,
        eventKey: notificationEventKeys.edited(
          context.propertyId,
          context.version,
        ),
      })),
    );
  }

  /**
   * An employee tried to register a property that is already in the system.
   * The property itself is not created; only active Managers receive this
   * durable alert. `context.propertyId` is the EXISTING property, so clicking
   * the notification can open it through the normal Manager property drawer.
   *
   * The writer runs INSIDE the create transaction, which is committed before
   * the caller turns the result into an HTTP 409. A rolled-back property
   * creation therefore cannot take the alert with it.
   */
  async notifyDuplicateAttempt(
    tx: Prisma.TransactionClient,
    context: PropertyEventContext,
    details: { fingerprint: string; attemptedAt: Date },
  ): Promise<void> {
    const [recipients, actor] = await Promise.all([
      context.creatorId
        ? reviewNotificationRecipientIdsForUser(tx, context.creatorId)
        : Promise.resolve([]),
      context.creatorId
        ? tx.user.findUnique({
            where: { id: context.creatorId },
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);
    const employeeName = actor?.name ?? 'موظف';
    const body = [
      `حاول الموظف ${employeeName} تسجيل عقار موجود بالفعل في النظام، وتم منع التسجيل تلقائيًا.`,
      `رقم العقار المسجّل: ${context.reference}`,
      `التاريخ: ${formatDecisionDate(details.attemptedAt)}`,
      'الحالة: تم منع التسجيل',
    ].join('\n');
    await this.deliver(
      tx,
      recipients.map((userId) => ({
        userId,
        type: 'SYSTEM',
        title: PROPERTY_EVENT_TITLES.DUPLICATE_ATTEMPT,
        body,
        propertyId: context.propertyId,
        eventKey: notificationEventKeys.duplicateAttempt(
          context.propertyId,
          context.creatorId ?? 'unknown',
          details.fingerprint,
        ),
      })),
    );
  }

  private decisionBody(input: {
    message: string;
    reference: string;
    reasonLabel: string;
    reason: string | null;
    date: Date;
    isDuplicate: boolean;
  }): string {
    const lines = [input.message, `رقم العقار: ${input.reference}`];
    const reason = input.reason?.trim();
    if (reason) lines.push(`${input.reasonLabel}: ${reason}`);
    lines.push(`التاريخ: ${formatDecisionDate(input.date)}`);
    if (input.isDuplicate) lines.push('عقار مشابه');
    return lines.join('\n');
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
    // A property that is approved AGAIN after an edit is not new stock: the
    // alert says so and lists the public fields that really changed.
    const isUpdate = context.availabilityKind === 'UPDATED';
    await this.deliver(
      tx,
      employees.map((userId) =>
        this.propertyDraft(userId, context, {
          type: 'PROPERTY_AVAILABLE',
          title: isUpdate
            ? PROPERTY_EVENT_TITLES.AVAILABLE_UPDATED
            : PROPERTY_EVENT_TITLES.AVAILABLE,
          eventKey: notificationEventKeys.available(
            context.approvalRequestId,
            context.propertyId,
            context.version,
          ),
        }),
      ),
    );
  }

  /**
   * 7. An employee saved or changed a company record (client, follow-up,
   * payment-free contact card, property interest) → the direct supervisor,
   * exactly once per committed save.
   *
   * The writer runs INSIDE the caller's transaction, so a notification row can
   * never commit for a change that rolled back — and vice versa. Only employee
   * actions are ever reported: a manager's own write skips this silently, so
   * there are no manager self-notifications and no employee is ever a
   * recipient of record events.
   *
   * The actor's display name is read from the database inside the same
   * transaction — never from a request body.
   */
  async notifyEmployeeRecordChange(
    tx: Prisma.TransactionClient,
    actor: AuthUser,
    event: EmployeeRecordEvent,
    record: RecordEventContext,
  ): Promise<void> {
    if (actor.role !== Role.EMPLOYEE) return;
    const actorRow = await tx.user.findUnique({
      where: { id: actor.id },
      select: { name: true },
    });
    if (!actorRow) return;

    const recipients = await reviewNotificationRecipientIds(tx, {
      id: actor.id,
      role: actor.role,
    });
    // At most one reference column is set by construction; the row id for the
    // event key follows the same choice (see `recordEventKeys`).
    const entityId = record.clientId ?? record.contactId ?? record.followUpId;
    if (!entityId) return;

    const eventKey = recordEventKeys[
      event.endsWith('_CREATED') ? 'birth' : 'occurrence'
    ](event, entityId, randomUUID());

    await this.deliver(
      tx,
      recipients.map((userId) => ({
        userId,
        type: event,
        title: recordEventTitle(event, record.clientIntent),
        body: recordEventBody(
          actorRow.name,
          event,
          record.contactType,
          record.clientIntent,
          record.clientChangeSummary,
        ),
        propertyId: null,
        clientId: record.clientId ?? null,
        contactId: record.contactId ?? null,
        followUpId: record.followUpId ?? null,
        eventKey,
      })),
    );
  }

  // ---------------------------------------------------------------------------
  // Client review workflow events
  // ---------------------------------------------------------------------------

  /**
   * An employee submitted (or explicitly re-submitted) a client review forward
   * to the direct supervisor — exactly once per real submission.
   *
   * `changeSummary`, when present, is the privacy-consistent review diff built
   * by the caller (safe identity values only, never a phone/note/message).
   */
  async notifyClientReviewSubmitted(
    tx: Prisma.TransactionClient,
    actor: AuthUser,
    event: 'CLIENT_REVIEW_SUBMITTED' | 'CLIENT_REVIEW_RESUBMITTED',
    reviewId: string,
    kind: 'CREATION' | 'EDIT',
    changeSummary?: string,
  ): Promise<void> {
    const actorRow = await tx.user.findUnique({
      where: { id: actor.id },
      select: { name: true },
    });
    const recipients = await reviewNotificationRecipientIds(
      tx,
      { id: actor.id, role: actor.role },
      actor.id,
    );
    // ONE nonce for the whole business event: every recipient receives the
    // same deduplication key (the unique index is scoped by userId).
    const nonce = randomUUID();
    await this.deliver(
      tx,
      recipients.map((userId) => ({
        userId,
        type: event,
        title:
          event === 'CLIENT_REVIEW_SUBMITTED'
            ? CLIENT_REVIEW_TITLES.SUBMITTED
            : CLIENT_REVIEW_TITLES.RESUBMITTED,
        body: clientReviewManagerBody(
          actorRow?.name ?? '',
          event,
          kind,
          changeSummary,
        ),
        propertyId: null,
        clientId: null,
        clientReviewId: reviewId,
        eventKey: clientReviewEventKeys.submission(event, reviewId, nonce),
      })),
    );
  }

  /**
   * A manager decided a review → the requesting employee, keyed on
   * (review, decision) so every retry of the SAME decision deduplicates
   * while a genuinely new decision (changes → resubmit → approve) is new.
   */
  async notifyClientReviewDecision(
    tx: Prisma.TransactionClient,
    requesterId: string,
    reviewId: string,
    decision: ClientReviewDecision,
    kind: 'CREATION' | 'EDIT',
    clientId: string | null,
  ): Promise<void> {
    await this.deliver(tx, [
      {
        userId: requesterId,
        type:
          decision === 'APPROVED'
            ? 'CLIENT_REVIEW_APPROVED'
            : decision === 'REJECTED'
              ? 'CLIENT_REVIEW_REJECTED'
              : 'CLIENT_REVIEW_CHANGES_REQUESTED',
        title:
          decision === 'APPROVED'
            ? kind === 'CREATION'
              ? CLIENT_REVIEW_TITLES.APPROVED_CREATION
              : CLIENT_REVIEW_TITLES.APPROVED_EDIT
            : decision === 'REJECTED'
              ? CLIENT_REVIEW_TITLES.REJECTED
              : CLIENT_REVIEW_TITLES.CHANGES_REQUESTED,
        body: clientReviewDecisionBody(decision, kind),
        propertyId: null,
        clientId,
        clientReviewId: reviewId,
        eventKey: clientReviewEventKeys.decision(decision, reviewId),
      },
    ]);
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
    // Follow-up subject deep links are exposed to the recipient that is
    // authorized to open them: the responsible EMPLOYEE (late-warning and
    // reminder rows are addressed to them) and the MANAGER monitors —
    // creations/escalations addressed to managers open exactly that subject's
    // read-only supervision history on /manager/followups.
    const followUpSubjectVisibleFor = (type: (typeof items)[number]['type']) =>
      viewer.role === Role.EMPLOYEE ||
      (isManagement(viewer) &&
        (type === 'FOLLOWUP_CREATED' ||
          type === 'FOLLOWUP_MANAGER_ESCALATION'));
    const duplicateContexts = await this.potentialDuplicateContexts(
      viewer,
      items,
    );
    return {
      items: items.map((row) =>
        toNotificationDto(
          // Flatten the contact's type and the property's CURRENT code only —
          // never its private fields, never a rewritten history.
          {
            ...row,
            contactType: row.contact?.type ?? null,
            propertyReference:
              row.property?.approvedReference ?? row.property?.reference ?? null,
          },
          row.propertyId && visible.has(row.propertyId) ? row.propertyId : null,
          followUpSubjectVisibleFor(row.type) ? row.followUpSubjectId : null,
          duplicateContexts.get(row.id) ?? null,
        ),
      ),
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    };
  }

  /** How many of the caller's notifications are still unread. */
  /**
   * Read-time, Manager-only enrichment for POTENTIAL_DUPLICATE rows.
   *
   * Resolves the new property code, the similar existing property code (from
   * the latest approval request's candidate ids), the submitting employee's
   * display name and the property status. It never rewrites history and never
   * exposes these identities to employees.
   */
  private async potentialDuplicateContexts(
    viewer: AuthUser,
    rows: { id: string; eventKey: string | null; propertyId: string | null }[],
  ): Promise<Map<string, NotificationDuplicateContextDto>> {
    const result = new Map<string, NotificationDuplicateContextDto>();
    if (!isManagement(viewer)) return result;
    const duplicateRows = rows.filter(
      (row) =>
        row.eventKey?.startsWith('POTENTIAL_DUPLICATE:') && row.propertyId,
    );
    if (!duplicateRows.length) return result;

    const propertyIds = [
      ...new Set(duplicateRows.map((row) => row.propertyId as string)),
    ];
    const properties = await this.prisma.property.findMany({
      where: { id: { in: propertyIds } },
      select: {
        id: true,
        reference: true,
        approvedReference: true,
        status: true,
        createdByUser: { select: { name: true } },
        approvals: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { duplicateCandidateIds: true },
        },
      },
    });
    const propertyById = new Map(properties.map((p) => [p.id, p]));

    const candidateIds = new Set<string>();
    for (const property of properties) {
      const ids = property.approvals[0]?.duplicateCandidateIds;
      if (!Array.isArray(ids)) continue;
      for (const id of ids) {
        if (typeof id === 'string') candidateIds.add(id);
      }
    }
    const candidates = candidateIds.size
      ? await this.prisma.property.findMany({
          where: { id: { in: [...candidateIds] } },
          select: { id: true, reference: true, approvedReference: true },
        })
      : [];
    const candidateById = new Map(
      candidates.map((c) => [c.id, c.approvedReference ?? c.reference]),
    );

    for (const row of duplicateRows) {
      const property = propertyById.get(row.propertyId as string);
      const ids = property?.approvals[0]?.duplicateCandidateIds;
      const firstCandidateId =
        Array.isArray(ids) && typeof ids[0] === 'string' ? ids[0] : null;
      result.set(row.id, {
        newPropertyReference:
          property?.approvedReference ?? property?.reference ?? null,
        existingPropertyReference: firstCandidateId
          ? (candidateById.get(firstCandidateId) ?? null)
          : null,
        employeeName: property?.createdByUser?.name ?? null,
        status: property?.status ?? null,
      });
    }
    return result;
  }

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
      where: {
        id: { in: propertyIds },
        // The creator may always open the decision notification for his OWN
        // rejected/soft-deleted property (the read-only history endpoint still
        // re-authorizes); every other viewer keeps the normal visibility rule.
        OR: [propertyVisibilityWhere(viewer), { createdByUserId: viewer.id }],
      },
      select: { id: true },
    });
    return new Set(visible.map((property) => property.id));
  }
}
