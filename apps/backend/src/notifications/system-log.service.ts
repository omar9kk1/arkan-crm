import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { AuthUser } from '@arkan/shared';
import { assertOwner } from '../common/access/access-policy';
import { resolveLimit } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import type { ListNotificationsQueryDto } from './dto/list-notifications.query';
import type {
  SystemLogEntityDto,
  SystemLogPageDto,
  SystemLogPartyDto,
} from './system-log.dto';

const SYSTEM_LOG_SELECT = {
  id: true,
  action: true,
  entityType: true,
  entityId: true,
  actorId: true,
  before: true,
  after: true,
  createdAt: true,
} satisfies Prisma.AuditLogSelect;

type AuditRow = Prisma.AuditLogGetPayload<{ select: typeof SYSTEM_LOG_SELECT }>;
type JsonObject = Record<string, Prisma.JsonValue>;

function jsonObject(value: Prisma.JsonValue | null): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonObject;
}

function textField(value: Prisma.JsonValue | null, key: string): string | null {
  const object = jsonObject(value);
  const field = object?.[key];
  return typeof field === 'string' && field.trim() ? field.trim() : null;
}

function stringArrayField(
  value: Prisma.JsonValue | null,
  key: string,
): string[] {
  const object = jsonObject(value);
  const field = object?.[key];
  if (!Array.isArray(field)) return [];
  return field.filter(
    (item): item is string => typeof item === 'string' && Boolean(item.trim()),
  );
}

function numberField(value: Prisma.JsonValue | null, key: string): number {
  const object = jsonObject(value);
  const field = object?.[key];
  return typeof field === 'number' && Number.isFinite(field) ? field : 0;
}

function roleLabel(role: Role): string {
  if (role === Role.OWNER) return 'مالك النظام';
  if (role === Role.MANAGER) return 'المدير';
  return 'الموظف';
}

function actorTitle(actor: SystemLogPartyDto): string {
  return actor.role === Role.EMPLOYEE
    ? actor.name
    : `${roleLabel(actor.role)} ${actor.name}`;
}

function entityCode(entity: SystemLogEntityDto | null): string {
  return entity?.code ?? entity?.name ?? 'العنصر المرتبط';
}

/**
 * Owner-only, read-only system activity log.
 *
 * It derives its rows from the existing `AuditLog` (the authoritative record of
 * real user actions) and resolves only the display labels the page needs:
 * actor, direct recipient, entity code/name and an Arabic title/description.
 * It never writes to the database, never rewrites audit history and never
 * exposes raw JSON payloads.
 */
@Injectable()
export class SystemLogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    viewer: AuthUser,
    query: ListNotificationsQueryDto,
  ): Promise<SystemLogPageDto> {
    assertOwner(viewer);
    const limit = resolveLimit(query.limit);
    const rows = await this.prisma.auditLog.findMany({
      // Authentication/token churn is not an operational system event.
      where: { NOT: { action: { startsWith: 'AUTH_' } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: SYSTEM_LOG_SELECT,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const propertyIds = this.idsOf(page, 'Property');
    const clientIds = this.idsOf(page, 'Client');
    const contactIds = this.idsOf(page, 'Contact');
    const followUpIds = this.idsOf(page, 'FollowUp');
    const reviewIds = this.idsOf(page, 'ClientReviewRequest');

    const [properties, clients, contacts, followUps, reviews] =
      await Promise.all([
        this.prisma.property.findMany({
          where: { id: { in: propertyIds } },
          select: {
            id: true,
            reference: true,
            approvedReference: true,
            title: true,
            createdByUserId: true,
            deletedAt: true,
          },
        }),
        this.prisma.client.findMany({
          where: { id: { in: clientIds } },
          select: { id: true, name: true },
        }),
        this.prisma.contact.findMany({
          where: { id: { in: contactIds } },
          select: { id: true, name: true, type: true },
        }),
        this.prisma.followUp.findMany({
          where: { id: { in: followUpIds } },
          select: {
            id: true,
            clientId: true,
            client: { select: { name: true } },
          },
        }),
        this.prisma.clientReviewRequest.findMany({
          where: { id: { in: reviewIds } },
          select: {
            id: true,
            kind: true,
            clientId: true,
            requestedById: true,
            payload: true,
            client: { select: { id: true, name: true } },
          },
        }),
      ]);

    const propertyById = new Map(properties.map((row) => [row.id, row]));
    const clientById = new Map(clients.map((row) => [row.id, row]));
    const contactById = new Map(contacts.map((row) => [row.id, row]));
    const followUpById = new Map(followUps.map((row) => [row.id, row]));
    const reviewById = new Map(reviews.map((row) => [row.id, row]));

    const userIds = new Set<string>();
    for (const row of page) {
      userIds.add(row.actorId);
      if (row.entityType === 'User') userIds.add(row.entityId);
      const property = propertyById.get(row.entityId);
      if (row.entityType === 'Property' && property?.createdByUserId)
        userIds.add(property.createdByUserId);
      const review = reviewById.get(row.entityId);
      if (row.entityType === 'ClientReviewRequest' && review)
        userIds.add(review.requestedById);
      for (const value of [
        textField(row.before, 'managerUserId'),
        textField(row.after, 'managerUserId'),
      ]) {
        if (value) userIds.add(value);
      }
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, name: true, role: true, isActive: true },
    });
    const userById = new Map(users.map((row) => [row.id, row]));

    const employeeActorIds = [
      ...new Set(
        page
          .filter((row) => userById.get(row.actorId)?.role === Role.EMPLOYEE)
          .map((row) => row.actorId),
      ),
    ];
    const [profiles, owners] = await Promise.all([
      this.prisma.employeeProfile.findMany({
        where: { userId: { in: employeeActorIds } },
        select: {
          userId: true,
          manager: {
            select: { id: true, name: true, role: true, isActive: true },
          },
        },
      }),
      this.prisma.user.findMany({
        where: { role: Role.OWNER, isActive: true },
        select: { id: true, name: true, role: true },
      }),
    ]);
    const profileByUserId = new Map(profiles.map((row) => [row.userId, row]));
    // Recipient labels are resolved from a single party map; Manager/OWNER
    // recipients are often not the audit actor, so merge them in here.
    for (const profile of profiles) {
      const manager = profile.manager;
      if (manager)
        userById.set(manager.id, {
          id: manager.id,
          name: manager.name,
          role: manager.role,
          isActive: manager.isActive,
        });
    }
    for (const owner of owners) {
      if (!userById.has(owner.id))
        userById.set(owner.id, { ...owner, isActive: true });
    }

    const items = page.map((row) => {
      const actorRow = userById.get(row.actorId);
      const actor: SystemLogPartyDto = actorRow
        ? { id: actorRow.id, name: actorRow.name, role: actorRow.role }
        : { id: row.actorId, name: 'مستخدم', role: Role.EMPLOYEE };
      const property = propertyById.get(row.entityId);
      const review = reviewById.get(row.entityId);
      const entity = this.entityOf(row, {
        property,
        client: clientById.get(row.entityId),
        contact: contactById.get(row.entityId),
        followUp: followUpById.get(row.entityId),
        review,
        user: userById.get(row.entityId),
      });
      const recipients = this.recipientsOf(row, actor, {
        property,
        review,
        profile: profileByUserId.get(actor.id),
        owners,
        userById,
      });
      const previousManagerUserId = textField(
        row.before,
        'managerUserId',
      );
      const nextManagerUserId = textField(row.after, 'managerUserId');
      const { title, description } = this.describe(row, {
        actor,
        entity,
        property,
        review,
        user: userById.get(row.entityId),
        recipients,
        previousManagerUserId,
        nextManagerUserId,
        previousSupervisorName: previousManagerUserId
          ? (userById.get(previousManagerUserId)?.name ?? null)
          : null,
        nextSupervisorName: nextManagerUserId
          ? (userById.get(nextManagerUserId)?.name ?? null)
          : null,
        affectedPendingReviewCount: numberField(
          row.after,
          'affectedPendingReviewCount',
        ),
        affectedPendingClientReviewCount: numberField(
          row.after,
          'affectedPendingClientReviewCount',
        ),
        affectedPendingPropertyReviewCount: numberField(
          row.after,
          'affectedPendingPropertyReviewCount',
        ),
      });
      return {
        id: row.id,
        action: row.action,
        title,
        description,
        actor,
        recipients,
        entity,
        details: this.detailsRef(row, property, review),
        createdAt: row.createdAt.toISOString(),
      };
    });

    return {
      items,
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /**
   * Map ONLY trusted audit metadata to an existing read drawer. A missing
   * record returns null (the UI offers an unavailable state); no name search,
   * no guessed association.
   */
  private detailsRef(
    row: AuditRow,
    property: { id: string; deletedAt: Date | null } | undefined,
    review: { id: string } | undefined,
  ): { type: 'CLIENT_REVIEW' | 'PROPERTY'; id: string } | null {
    if (row.entityType === 'ClientReviewRequest' && review)
      return { type: 'CLIENT_REVIEW', id: review.id };
    // GET /properties/:id deliberately hides trashed rows; do not offer a
    // broken "details" action for a trash event. Restore events have
    // deletedAt = null and remain openable.
    if (row.entityType === 'Property' && property && !property.deletedAt)
      return { type: 'PROPERTY', id: property.id };
    return null;
  }

  private idsOf(rows: AuditRow[], entityType: string): string[] {
    return [...new Set(rows.filter((row) => row.entityType === entityType).map((row) => row.entityId))];
  }

  private entityOf(
    row: AuditRow,
    related: {
      property?: {
        id: string;
        reference: string;
        approvedReference: string | null;
        title: string;
      };
      client?: { id: string; name: string };
      contact?: { id: string; name: string; type: string };
      followUp?: {
        id: string;
        clientId: string | null;
        client: { name: string } | null;
      };
      review?: {
        id: string;
        kind: string;
        clientId: string | null;
        payload: Prisma.JsonValue;
        client: { id: string; name: string } | null;
      };
      user?: { id: string; name: string; role: Role };
    },
  ): SystemLogEntityDto | null {
    if (!row.entityId) return null;
    if (row.entityType === 'Property') {
      return {
        type: 'PROPERTY',
        label: 'عقار',
        id: row.entityId,
        code:
          related.property?.approvedReference ??
          related.property?.reference ??
          textField(row.before, 'reference') ??
          null,
        name: related.property?.title ?? null,
      };
    }
    if (row.entityType === 'Client') {
      return {
        type: 'CLIENT',
        label: 'عميل',
        id: row.entityId,
        code: null,
        name: related.client?.name ?? textField(row.after, 'name') ?? null,
      };
    }
    if (row.entityType === 'Contact') {
      return {
        type: 'CONTACT',
        label: 'جهة اتصال',
        id: row.entityId,
        code: null,
        name: related.contact?.name ?? null,
      };
    }
    if (row.entityType === 'FollowUp') {
      return {
        type: 'FOLLOWUP',
        label: 'متابعة',
        id: row.entityId,
        code: null,
        name: related.followUp?.client?.name ?? null,
      };
    }
    if (row.entityType === 'ClientReviewRequest') {
      return {
        type: 'CLIENT_REVIEW',
        label: 'طلب عميل',
        id: row.entityId,
        code: null,
        name:
          related.review?.client?.name ??
          textField(related.review?.payload ?? null, 'name') ??
          null,
      };
    }
    if (row.entityType === 'User') {
      return {
        type: 'USER',
        label: related.user ? roleLabel(related.user.role) : 'مستخدم',
        id: row.entityId,
        code: null,
        name: related.user?.name ?? textField(row.after, 'name') ?? null,
      };
    }
    return {
      type: 'OTHER',
      label: row.entityType,
      id: row.entityId,
      code: null,
      name: null,
    };
  }

  private recipientsOf(
    row: AuditRow,
    actor: SystemLogPartyDto,
    context: {
      property?: { createdByUserId: string | null };
      review?: { requestedById: string };
      profile?: {
        manager: {
          id: string;
          name: string;
          role: Role;
          isActive: boolean;
        } | null;
      };
      owners: Array<{ id: string; name: string; role: Role }>;
      userById: Map<
        string,
        { id: string; name: string; role: Role; isActive: boolean }
      >;
    },
  ): SystemLogPartyDto[] {
    const asParties = (ids: (string | null | undefined)[]): SystemLogPartyDto[] => {
      const seen = new Set<string>();
      const result: SystemLogPartyDto[] = [];
      for (const id of ids) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const user = context.userById.get(id);
        if (user)
          result.push({ id: user.id, name: user.name, role: user.role });
      }
      return result;
    };

    const supervisor = (): string[] => {
      if (actor.role !== Role.EMPLOYEE) return [];
      const manager = context.profile?.manager;
      if (manager?.isActive) return [manager.id];
      return context.owners.map((owner) => owner.id);
    };

    if (row.action.startsWith('PROPERTY_')) {
      if (
        row.action === 'PROPERTY_CREATE' ||
        row.action === 'PROPERTY_UPDATE' ||
        row.action === 'PROPERTY_RESUBMIT' ||
        row.action === 'PROPERTY_DUPLICATE_BLOCKED'
      )
        return asParties(supervisor());
      if (
        row.action === 'PROPERTY_APPROVE' ||
        row.action === 'PROPERTY_REJECT' ||
        row.action === 'PROPERTY_REQUEST_CHANGES' ||
        row.action === 'PROPERTY_TRASH' ||
        row.action === 'PROPERTY_RESTORE'
      )
        return asParties([context.property?.createdByUserId]);
      return [];
    }

    if (row.action === 'CLIENT_REVIEW_SUBMIT' || row.action === 'CLIENT_REVIEW_RESUBMIT')
      return asParties(supervisor());
    if (row.action.startsWith('CLIENT_REVIEW_'))
      return asParties([context.review?.requestedById]);

    if (
      row.action === 'CLIENT_CREATE' ||
      row.action === 'CLIENT_UPDATE' ||
      row.action === 'CONTACT_CREATE' ||
      row.action === 'CONTACT_UPDATE' ||
      row.action === 'FOLLOWUP_CREATE'
    )
      return asParties(supervisor());

    if (row.entityType === 'User') {
      if (row.action === 'EMPLOYEE_ASSIGN_MANAGER')
        return asParties([
          row.entityId,
          textField(row.after, 'managerUserId'),
        ]);
      return asParties([row.entityId]);
    }

    return [];
  }

  private describe(
    row: AuditRow,
    context: {
      actor: SystemLogPartyDto;
      entity: SystemLogEntityDto | null;
      property?: {
        reference: string;
        approvedReference: string | null;
        title: string;
      };
      review?: { kind: string };
      user?: { id: string; name: string; role: Role };
      recipients: SystemLogPartyDto[];
      previousManagerUserId: string | null;
      nextManagerUserId: string | null;
      previousSupervisorName: string | null;
      nextSupervisorName: string | null;
      affectedPendingReviewCount: number;
      affectedPendingClientReviewCount: number;
      affectedPendingPropertyReviewCount: number;
    },
  ): { title: string; description: string } {
    const actor = actorTitle(context.actor);
    const code = entityCode(context.entity);
    const name = context.entity?.name ?? code;
    const reviewKind =
      context.review?.kind === 'EDIT' ? 'تعديل' : 'إضافة';

    switch (row.action) {
      case 'PROPERTY_CREATE':
        return context.actor.role === Role.EMPLOYEE
          ? {
              title: `${actor} أرسل عقاراً للمراجعة`,
              description: `تم إنشاء طلب مراجعة للعقار ${code}.`,
            }
          : {
              title: `${actor} أضاف عقاراً`,
              description: `تمت إضافة العقار ${code} مباشرة إلى البرنامج.`,
            };
      case 'PROPERTY_APPROVE':
        return {
          title: `${actor} وافق على طلب عقار`,
          description: `تم اعتماد العقار ${code} وأصبح متاحاً.`,
        };
      case 'PROPERTY_REJECT':
        return {
          title: `${actor} رفض طلب عقار`,
          description: `تم رفض طلب العقار ${code}.`,
        };
      case 'PROPERTY_REQUEST_CHANGES':
        return {
          title: `${actor} طلب تعديلات على عقار`,
          description: `أُعيد العقار ${code} لتنفيذ التعديلات المطلوبة.`,
        };
      case 'PROPERTY_RESUBMIT':
        return {
          title: `${actor} أعاد إرسال عقار للمراجعة`,
          description: `أُعيد العقار ${code} إلى قائمة المراجعة.`,
        };
      case 'PROPERTY_UPDATE': {
        const changed = stringArrayField(row.after, 'changedFields');
        return {
          title: `${actor} حدّث بيانات عقار`,
          description: `تم تحديث العقار ${code}${changed.length ? ` (${changed.join('، ')})` : ''}.`,
        };
      }
      case 'PROPERTY_DUPLICATE_BLOCKED':
        return {
          title: `${actor} حاول تسجيل عقار مشابه`,
          description: `تم منع تسجيل عقار مشابه للعقار ${code}.`,
        };
      case 'PROPERTY_TRASH':
        return {
          title: `${actor} نقل عقاراً إلى المحذوفات`,
          description: `تم نقل العقار ${code} إلى المحذوفات.`,
        };
      case 'PROPERTY_RESTORE':
        return {
          title: `${actor} استعاد عقاراً من المحذوفات`,
          description: `تمت استعادة العقار ${code}.`,
        };
      case 'PROPERTY_PERMANENT_DELETE':
        return {
          title: `${actor} حذف عقاراً نهائياً`,
          description: `تم حذف العقار ${code} نهائياً.`,
        };
      case 'CLIENT_CREATE':
        return {
          title: `${actor} أضاف عميلاً`,
          description: `تمت إضافة العميل ${name}.`,
        };
      case 'CLIENT_UPDATE':
        return {
          title: `${actor} حدّث بيانات عميل`,
          description: `تم تحديث بيانات العميل ${name}.`,
        };
      case 'CLIENT_REVIEW_SUBMIT':
        return {
          title: `${actor} أرسل عميلاً للمراجعة`,
          description: `تم إرسال طلب ${reviewKind} عميل للمراجعة.`,
        };
      case 'CLIENT_REVIEW_RESUBMIT':
        return {
          title: `${actor} أعاد إرسال عميل للمراجعة`,
          description: `أُعيد طلب ${reviewKind} العميل إلى قائمة المراجعة.`,
        };
      case 'CLIENT_REVIEW_APPLY':
        return {
          title: `${actor} وافق على طلب عميل`,
          description: `تم اعتماد طلب ${reviewKind} العميل${context.entity?.name ? `: ${context.entity.name}` : ''}.`,
        };
      case 'CLIENT_REVIEW_REJECTED':
        return {
          title: `${actor} رفض طلب عميل`,
          description: `تم رفض طلب ${reviewKind} العميل${context.entity?.name ? `: ${context.entity.name}` : ''}.`,
        };
      case 'CLIENT_REVIEW_CHANGES_REQUESTED':
        return {
          title: `${actor} طلب تعديلات على طلب عميل`,
          description: `أُعيد طلب ${reviewKind} العميل إلى الموظف لتنفيذ التعديلات.`,
        };
      case 'CONTACT_CREATE':
        return {
          title: `${actor} أضاف جهة اتصال`,
          description: `تمت إضافة جهة الاتصال${context.entity?.name ? `: ${context.entity.name}` : ''}.`,
        };
      case 'CONTACT_UPDATE':
        return {
          title: `${actor} حدّث جهة اتصال`,
          description: `تم تحديث جهة الاتصال${context.entity?.name ? `: ${context.entity.name}` : ''}.`,
        };
      case 'FOLLOWUP_CREATE':
        return {
          title: `${actor} أضاف متابعة`,
          description: `تمت إضافة متابعة للعميل ${context.entity?.name ?? 'غير محدد'}.`,
        };
      case 'EMPLOYEE_CREATE':
      case 'MANAGER_CREATE':
        return {
          title: `${actor} أضاف ${roleLabel(context.user?.role ?? Role.EMPLOYEE)}`,
          description: `تمت إضافة ${context.user?.name ?? name} إلى النظام.`,
        };
      case 'EMPLOYEE_RENAME':
      case 'MANAGER_RENAME':
        return {
          title: `${actor} حدّث اسم ${roleLabel(context.user?.role ?? Role.EMPLOYEE)}`,
          description: `تم تحديث الاسم إلى ${context.user?.name ?? name}.`,
        };
      case 'EMPLOYEE_ACTIVATE':
      case 'MANAGER_ACTIVATE':
        return {
          title: `${actor} فعّل حساب ${roleLabel(context.user?.role ?? Role.EMPLOYEE)}`,
          description: `تم تفعيل حساب ${context.user?.name ?? name}.`,
        };
      case 'EMPLOYEE_DEACTIVATE':
      case 'MANAGER_DEACTIVATE':
        return {
          title: `${actor} عطّل حساب ${roleLabel(context.user?.role ?? Role.EMPLOYEE)}`,
          description: `تم تعطيل حساب ${context.user?.name ?? name}.`,
        };
      case 'EMPLOYEE_ASSIGN_MANAGER': {
        const employeeName = context.user?.name ?? name;
        const previousLabel = context.previousManagerUserId
          ? `المدير ${context.previousSupervisorName ?? 'غير المعروف'}`
          : 'مالك النظام';
        const nextLabel = context.nextManagerUserId
          ? `المدير ${context.nextSupervisorName ?? 'غير المعروف'}`
          : 'مالك النظام';
        const moved = context.affectedPendingReviewCount;
        return {
          title:
            context.previousManagerUserId !== context.nextManagerUserId
              ? `${actor} نقل الموظف ${employeeName} من ${previousLabel} إلى ${nextLabel}`
              : `${actor} حدّث مشرف الموظف ${employeeName}`,
          description:
            moved > 0
              ? `تم نقل ${moved} طلب مراجعة معلّق (${context.affectedPendingClientReviewCount} عميل، ${context.affectedPendingPropertyReviewCount} عقار) إلى ${nextLabel}.`
              : `تم تحديث المشرف المباشر للموظف ${employeeName} إلى ${nextLabel} بدون طلبات مراجعة معلّقة.`,
        };
      }
      case 'MANAGER_PERMISSIONS_UPDATE':
        return {
          title: `${actor} حدّث صلاحيات مدير`,
          description: `تم تحديث صلاحيات المراجعة للمدير ${context.user?.name ?? name}.`,
        };
      case 'OWNER_PROMOTE':
        return {
          title: `${actor} رقّى مستخدماً إلى مالك نظام`,
          description: `تمت ترقية ${context.user?.name ?? name} إلى مالك نظام.`,
        };
      default:
        return {
          title: `${actor} نفّذ إجراءً إدارياً`,
          description: context.entity
            ? `تم تسجيل إجراء على ${context.entity.label} ${entityCode(context.entity)}.`
            : 'تم تسجيل إجراء إداري في النظام.',
        };
    }
  }
}
