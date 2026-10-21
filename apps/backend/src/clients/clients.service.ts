import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ContactType,
  FollowUpStatus,
  Prisma,
  PropertyStatus,
} from '@prisma/client';
import { Role, type AuthUser } from '@arkan/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { contactOwnershipWhere } from '../contacts/contact-policy';
import { propertyVisibilityWhere } from '../properties/property-visibility';
import { clientOwnershipWhere, ensureEmployeeProfile } from './client-policy';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ListClientsQueryDto } from './dto/list-clients.query';
import { CreateClientFollowUpDto } from './dto/create-follow-up.dto';
import { PropertyInterestInputDto } from './dto/property-interest.dto';
import type {
  ClientDto,
  ClientFollowUpDto,
  ClientListDto,
  ClientPropertyInterestDto,
  ClientStatsDto,
} from './client.dto';

/** Upper bound of one `GET /clients` answer; the stats endpoint stays exact. */
const MAX_CLIENTS_PER_PAGE = 1000;

/**
 * Follow-ups kept per client in list/DTO answers (newest first). The detail
 * endpoint returns the full history; the cap only protects the list payload
 * from an unbounded nested scan.
 */
const FOLLOW_UP_LIMIT = 100;
const LINKED_PROPERTY_LIMIT = 100;

/** Lifecycle values that take a client out of the "active" counter. */
const INACTIVE_CLIENT_STATUSES = ['CLOSED', 'INACTIVE'];

const CLIENT_BASE_INCLUDE = {
  createdBy: {
    select: { userId: true, user: { select: { name: true } } },
  },
  responsibleEmployee: {
    select: { userId: true, user: { select: { name: true } } },
  },
} satisfies Prisma.ClientInclude;

const FOLLOW_UP_INCLUDE = {
  employee: { select: { user: { select: { name: true } } } },
} satisfies Prisma.FollowUpInclude;

const PROPERTY_SELECT = {
  id: true,
  reference: true,
  title: true,
  area: true,
  askingPrice: true,
  currency: true,
} satisfies Prisma.PropertySelect;

const CLIENT_LIST_INCLUDE = {
  ...CLIENT_BASE_INCLUDE,
  followups: {
    orderBy: { createdAt: 'desc' as const },
    take: FOLLOW_UP_LIMIT,
    include: FOLLOW_UP_INCLUDE,
  },
  deals: {
    orderBy: { createdAt: 'desc' as const },
    take: LINKED_PROPERTY_LIMIT,
    select: { property: { select: PROPERTY_SELECT } },
  },
  // Recorded interests in EXISTING program properties share the list cap; the
  // nested projection stays the same public PROPERTY_SELECT (never contact).
  propertyInterests: {
    orderBy: { createdAt: 'desc' as const },
    take: LINKED_PROPERTY_LIMIT,
    include: { property: { select: PROPERTY_SELECT } },
  },
} satisfies Prisma.ClientInclude;

const CLIENT_DETAIL_INCLUDE = {
  ...CLIENT_BASE_INCLUDE,
  followups: {
    orderBy: { createdAt: 'desc' as const },
    include: FOLLOW_UP_INCLUDE,
  },
  deals: {
    orderBy: { createdAt: 'desc' as const },
    select: { property: { select: PROPERTY_SELECT } },
  },
  propertyInterests: {
    orderBy: { createdAt: 'desc' as const },
    include: { property: { select: PROPERTY_SELECT } },
  },
} satisfies Prisma.ClientInclude;

type ClientRow = Prisma.ClientGetPayload<{
  include: typeof CLIENT_DETAIL_INCLUDE;
}>;

// --- calendar helpers -------------------------------------------------------
// Follow-up dates are stored as UTC midnights of the business calendar date so
// `YYYY-MM-DD` round-trips unchanged; "today" and the week boundary use the
// server's local calendar, which is the business calendar (Kuwait).

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function localDateKey(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dateKeyToDate(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

function todayKey(): string {
  return localDateKey(new Date());
}

/** Saturday 00:00 of the current week (the Arabic Saturday–Friday week). */
function weekStartKey(): string {
  const now = new Date();
  const daysSinceSaturday = (now.getDay() + 1) % 7;
  now.setDate(now.getDate() - daysSinceSaturday);
  return localDateKey(now);
}

function addDaysKey(key: string, days: number): string {
  const date = dateKeyToDate(key);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateKey(date);
}

// --- follow-up note packing -------------------------------------------------
// `FollowUp` has no columns for method/outcome/note, and no migration may run
// without approval, so the three form values are packed into the existing
// `notes` column as one JSON object. This service owns BOTH the pack and the
// unpack, so callers always see parsed fields and a legacy/plain row degrades
// to a readable note instead of raw JSON.

interface FollowUpNoteDetail {
  method: string;
  outcome: string;
  note: string;
}

function packFollowUpNotes(detail: FollowUpNoteDetail): string {
  return JSON.stringify(detail);
}

function unpackFollowUpNotes(raw: string | null): FollowUpNoteDetail {
  if (!raw) return { method: '', outcome: '', note: '' };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      if (
        typeof record.method === 'string' &&
        typeof record.outcome === 'string' &&
        typeof record.note === 'string'
      )
        return {
          method: record.method,
          outcome: record.outcome,
          note: record.note,
        };
    }
  } catch {
    // Plain text predating the packing convention: keep it readable.
  }
  return { method: '', outcome: '', note: raw };
}

function serializeFollowUp(
  entry: ClientRow['followups'][number],
): ClientFollowUpDto {
  const detail = unpackFollowUpNotes(entry.notes);
  return {
    id: entry.id,
    dueAt: toDateKey(entry.dueAt),
    createdAt: entry.createdAt.toISOString(),
    method: detail.method,
    outcome: detail.outcome,
    note: detail.note,
    employeeName: entry.employee.user.name,
  };
}

function serializeClient(client: ClientRow): ClientDto {
  const pendingKeys = client.followups
    .filter((entry) => entry.status === FollowUpStatus.PENDING)
    .map((entry) => toDateKey(entry.dueAt))
    .sort();
  return {
    id: client.id,
    name: client.name,
    phone: client.phone,
    notes: client.notes ?? '',
    source: client.source ?? '',
    status: client.status ?? '',
    responsibleUserId: client.responsibleEmployee?.userId ?? null,
    responsibleEmployeeName: client.responsibleEmployee?.user.name ?? null,
    createdByUserId: client.createdBy?.userId ?? null,
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
    nextFollowUp: pendingKeys[0] ?? null,
    followUps: client.followups.map(serializeFollowUp),
    properties: client.deals.map(({ property }) => ({
      id: property.id,
      reference: property.reference,
      title: property.title,
      area: property.area,
      askingPrice:
        property.askingPrice === null ? null : String(property.askingPrice),
      currency: property.currency,
    })),
    propertyInterests: serializeInterests(client.propertyInterests),
  };
}

/**
 * Interest projections reuse the SAME public property fields as the deal links
 * (reference/title/area/price/currency) — the serializer can structurally
 * never emit a private owner/broker field because `PROPERTY_SELECT` doesn't
 * select one.
 */
function serializeInterests(
  rows: ClientRow['propertyInterests'],
): ClientPropertyInterestDto[] {
  return rows.map((interest) => ({
    propertyId: interest.property.id,
    reference: interest.property.reference,
    title: interest.property.title,
    area: interest.property.area,
    askingPrice:
      interest.property.askingPrice === null
        ? null
        : String(interest.property.askingPrice),
    currency: interest.property.currency,
    reason: interest.reason ?? '',
    notes: interest.notes ?? '',
    createdAt: interest.createdAt.toISOString(),
  }));
}

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** `GET /clients` — the whole authorised list, optionally searched. */
  async list(
    viewer: AuthUser,
    query: ListClientsQueryDto,
  ): Promise<ClientListDto> {
    const search = query.search?.trim();
    const scope = clientOwnershipWhere(viewer);
    const where: Prisma.ClientWhereInput = search
      ? {
          AND: [
            scope,
            {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
              ],
            },
          ],
        }
      : scope;
    const rows = await this.prisma.client.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? MAX_CLIENTS_PER_PAGE,
      include: CLIENT_LIST_INCLUDE,
    });
    return { items: rows.map(serializeClient) };
  }

  /**
   * `GET /clients/stats` — authorised counters for the summary cards and tab
   * badges. Every number is computed from whole authorised tables, never from
   * the page the client happens to have loaded.
   */
  async stats(viewer: AuthUser): Promise<ClientStatsDto> {
    const scope = clientOwnershipWhere(viewer);
    const today = todayKey();
    const weekStart = weekStartKey();
    const weekEndExclusive = addDaysKey(weekStart, 7);

    const clientRows = await this.prisma.client.findMany({
      where: scope,
      select: { id: true },
    });
    const clientIds = clientRows.map((row) => row.id);

    // Follow-up scope: the manager sees every company follow-up; an employee
    // sees follow-ups on their own clients plus rows assigned to them.
    let followUpScope: Prisma.FollowUpWhereInput = {};
    if (viewer.role === Role.EMPLOYEE) {
      const profile = await this.prisma.employeeProfile.findUnique({
        where: { userId: viewer.id },
        select: { id: true },
      });
      followUpScope = {
        OR: [
          { client: clientOwnershipWhere(viewer) },
          { employeeId: profile?.id ?? 'no-assigned-profile' },
        ],
      };
    }

    const [totalClients, activeClients, owners, brokers, followUpsThisWeek, pending, dealCounts] =
      await Promise.all([
        this.prisma.client.count({ where: scope }),
        this.prisma.client.count({
          where: {
            AND: [
              scope,
              {
                OR: [
                  { status: null },
                  { NOT: { status: { in: INACTIVE_CLIENT_STATUSES } } },
                ],
              },
            ],
          },
        }),
        this.prisma.contact.count({
          where: {
            AND: [
              { type: ContactType.OWNER },
              contactOwnershipWhere(viewer),
              // Matches the owners tab: employee-registered owner records.
              { responsibleUserId: { not: null } },
            ],
          },
        }),
        this.prisma.contact.count({
          where: {
            AND: [{ type: ContactType.BROKER }, contactOwnershipWhere(viewer)],
          },
        }),
        this.prisma.followUp.count({
          where: {
            AND: [
              followUpScope,
              {
                dueAt: {
                  gte: dateKeyToDate(weekStart),
                  lt: dateKeyToDate(weekEndExclusive),
                },
              },
            ],
          },
        }),
        this.prisma.followUp.groupBy({
          by: ['clientId'],
          where: {
            status: FollowUpStatus.PENDING,
            clientId: { in: clientIds },
          },
          _min: { dueAt: true },
        }),
        this.prisma.deal.groupBy({
          by: ['clientId'],
          where: { clientId: { in: clientIds } },
          _count: { _all: true },
        }),
      ]);

    const pendingByKey = new Map<string, string>();
    for (const row of pending) {
      if (row.clientId && row._min.dueAt)
        pendingByKey.set(row.clientId, toDateKey(row._min.dueAt));
    }
    const dealsByKey = new Map<string, number>();
    for (const row of dealCounts) {
      if (row.clientId) dealsByKey.set(row.clientId, row._count._all);
    }

    let clientsNeedingFollowUp = 0;
    let clientsLate = 0;
    let clientsWithoutProperty = 0;
    for (const { id } of clientRows) {
      const next = pendingByKey.get(id);
      if (!next || next <= today) clientsNeedingFollowUp += 1;
      if (next && next < today) clientsLate += 1;
      if (!dealsByKey.get(id)) clientsWithoutProperty += 1;
    }

    return {
      totalClients,
      activeClients,
      owners,
      brokers,
      followUpsThisWeek,
      clientsNeedingFollowUp,
      clientsLate,
      clientsWithoutProperty,
    };
  }

  /** `GET /clients/:id` — full detail including the complete follow-up log. */
  async findOne(viewer: AuthUser, id: string): Promise<ClientDto> {
    const client = await this.prisma.client.findFirst({
      where: { id, ...clientOwnershipWhere(viewer) },
      include: CLIENT_DETAIL_INCLUDE,
    });
    if (!client) throw new NotFoundException('Client not found');
    return serializeClient(client);
  }

  /** `POST /clients` — registers a real client (+ optional first follow-up). */
  async create(viewer: AuthUser, dto: CreateClientDto): Promise<ClientDto> {
    const created = await this.prisma.$transaction(async (tx) => {
      let createdById: string | null = null;
      let responsibleEmployeeId: string | null = null;

      if (viewer.role === Role.EMPLOYEE) {
        if (dto.responsibleUserId && dto.responsibleUserId !== viewer.id)
          throw new ForbiddenException(
            'لا يمكن تخصيص عميل لموظف آخر؛ التخصيص لحسابك فقط.',
          );
        // The creator and the responsible employee stay distinct columns; an
        // employee registering a client becomes its responsible owner. The
        // profile itself is provisioned on demand, so an account created
        // outside the employees flow can still OWN the client it registers —
        // otherwise the save would succeed and the client would then be
        // invisible to its own creator (the cross-account search/link bug).
        createdById = await ensureEmployeeProfile(tx, viewer.id);
        responsibleEmployeeId = createdById;
      } else if (dto.responsibleUserId) {
        // Managers link responsibility by stable User.id, never by name.
        const profile = await tx.employeeProfile.findUnique({
          where: { userId: dto.responsibleUserId },
          select: { id: true },
        });
        if (!profile)
          throw new BadRequestException('حساب الموظف المسؤول غير موجود.');
        responsibleEmployeeId = profile.id;
      }

      const client = await tx.client.create({
        data: {
          name: dto.name.trim(),
          phone: dto.phone.trim(),
          notes: dto.notes?.trim() || null,
          source: dto.source?.trim() || null,
          createdById,
          responsibleEmployeeId,
        },
        include: CLIENT_DETAIL_INCLUDE,
      });

      if (dto.nextFollowUp) {
        if (!responsibleEmployeeId)
          throw new BadRequestException(
            'حدّد الموظف المسؤول قبل جدولة أول متابعة.',
          );
        await tx.followUp.create({
          data: {
            employeeId: responsibleEmployeeId,
            clientId: client.id,
            dueAt: dateKeyToDate(dto.nextFollowUp),
            status: FollowUpStatus.PENDING,
            notes: null,
          },
        });
      }

      // Interests in EXISTING program properties are written in the SAME
      // transaction as the client row, so a save can never record one without
      // the other.
      if (dto.propertyInterests?.length) {
        await this.upsertInterests(tx, viewer, client.id, dto.propertyInterests);
      }

      await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action: 'CLIENT_CREATE',
          entityType: 'Client',
          entityId: client.id,
          after: { name: client.name },
        },
      });
      // Employee activity reporting: one CLIENT_CREATED occurrence per committed
      // save, written in the same transaction. The optional scheduled first
      // follow-up and the freshly linked interests are part of this very save,
      // so the manager is told about the save once — not once per row. The
      // intent wording derives ONLY from persisted data: interests in the same
      // save mean the client is inquiring about an existing program property;
      // nothing else in the payload is a validated intent, so a save without
      // interests keeps the generic wording.
      await this.notifications.notifyEmployeeRecordChange(
        tx,
        viewer,
        'CLIENT_CREATED',
        {
          clientId: client.id,
          ...(dto.propertyInterests?.length
            ? { clientIntent: 'INQUIRY' as const }
            : {}),
        },
      );
      // Return the client WITH the freshly saved interests visible.
      return dto.propertyInterests?.length
        ? await tx.client.findFirstOrThrow({
            where: { id: client.id },
            include: CLIENT_DETAIL_INCLUDE,
          })
        : client;
    });
    return serializeClient(created);
  }

  /**
   * Did the PATCH actually change anything? The employee update is reported to
   * the managers only on a real change — a repeated save with identical values
   * produces no notification (the DB write itself stays as before).
   */
  private static clientPatchChanged(
    existing: {
      name: string;
      phone: string;
      notes: string | null;
      source: string | null;
      responsibleEmployeeId: string | null;
    },
    dto: UpdateClientDto,
    responsibleEmployeeId: string | null | undefined,
  ): boolean {
    if (dto.name !== undefined && (dto.name.trim() || '') !== existing.name)
      return true;
    if (dto.phone !== undefined && (dto.phone.trim() || '') !== existing.phone)
      return true;
    if (
      dto.notes !== undefined &&
      (dto.notes?.trim() || null) !== existing.notes
    )
      return true;
    if (
      dto.source !== undefined &&
      (dto.source?.trim() || null) !== existing.source
    )
      return true;
    if (
      responsibleEmployeeId !== undefined &&
      responsibleEmployeeId !== existing.responsibleEmployeeId
    )
      return true;
    return false;
  }

  /**
   * `PATCH /clients/:id` — edits an authorised client. Visibility is re-checked
   * inside the write, and responsibility can only be moved by a manager.
   */
  async update(
    viewer: AuthUser,
    id: string,
    dto: UpdateClientDto,
  ): Promise<ClientDto> {
    const existing = await this.prisma.client.findFirst({
      where: { id, ...clientOwnershipWhere(viewer) },
      select: {
        id: true,
        name: true,
        phone: true,
        notes: true,
        source: true,
        responsibleEmployeeId: true,
      },
    });
    if (!existing) throw new NotFoundException('Client not found');
    if (dto.responsibleUserId !== undefined && viewer.role !== Role.MANAGER)
      throw new ForbiddenException(
        'إعادة تخصيص العميل إلى موظف آخر متاحة للمدير فقط.',
      );

    const updated = await this.prisma.$transaction(async (tx) => {
      const visible = await tx.client.findFirst({
        where: { id, ...clientOwnershipWhere(viewer) },
      });
      if (!visible) throw new NotFoundException('Client not found');

      let responsibleEmployeeId: string | null | undefined;
      if (dto.responsibleUserId !== undefined) {
        if (dto.responsibleUserId === null) {
          responsibleEmployeeId = null;
        } else {
          const profile = await tx.employeeProfile.findUnique({
            where: { userId: dto.responsibleUserId },
            select: { id: true },
          });
          if (!profile)
            throw new BadRequestException('حساب الموظف المسؤول غير موجود.');
          responsibleEmployeeId = profile.id;
        }
      }

      const client = await tx.client.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone.trim() } : {}),
          ...(dto.notes !== undefined
            ? { notes: dto.notes?.trim() || null }
            : {}),
          ...(dto.source !== undefined
            ? { source: dto.source?.trim() || null }
            : {}),
          ...(responsibleEmployeeId !== undefined
            ? { responsibleEmployeeId }
            : {}),
        },
        include: CLIENT_DETAIL_INCLUDE,
      });

      // Linking an EXISTING authorised client to another property: every
      // interest upserts on the (client, property) pair, so repeated
      // submissions never create duplicate rows and never re-create the
      // client itself.
      let interestChange: InterestUpsertResult | null = null;
      if (dto.propertyInterests?.length) {
        interestChange = await this.upsertInterests(
          tx,
          viewer,
          id,
          dto.propertyInterests,
        );
      }

      await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action: 'CLIENT_UPDATE',
          entityType: 'Client',
          entityId: client.id,
          after: { name: client.name },
        },
      });
      // Employee activity reporting — only for a real change, only for an
      // employee actor (a manager's own edit never notifies). A client-field
      // change and a new property interest are two distinct events when a single
      // PATCH performs both.
      if (ClientsService.clientPatchChanged(existing, dto, responsibleEmployeeId)) {
        await this.notifications.notifyEmployeeRecordChange(
          tx,
          viewer,
          'CLIENT_UPDATED',
          { clientId: client.id },
        );
      }
      if (interestChange && interestChange.changed) {
        await this.notifications.notifyEmployeeRecordChange(
          tx,
          viewer,
          'CLIENT_INTEREST_UPDATED',
          { clientId: client.id },
        );
      }
      // Return the client WITH the freshly upserted interests visible.
      return dto.propertyInterests?.length
        ? await tx.client.findFirstOrThrow({
            where: { id },
            include: CLIENT_DETAIL_INCLUDE,
          })
        : client;
    });
    return serializeClient(updated);
  }

  /**
   * `POST /clients/:id/follow-ups` — logs a contact against an authorised
   * client. The row is assigned to the client's responsible employee (falling
   * back to the caller's own profile), so the timeline always names a real
   * employee instead of free text.
   */
  async createFollowUp(
    viewer: AuthUser,
    clientId: string,
    dto: CreateClientFollowUpDto,
  ): Promise<ClientFollowUpDto> {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, ...clientOwnershipWhere(viewer) },
      select: { id: true, responsibleEmployeeId: true },
    });
    if (!client) throw new NotFoundException('Client not found');

    let employeeId = client.responsibleEmployeeId;
    if (!employeeId && viewer.role === Role.EMPLOYEE) {
      const profile = await this.prisma.employeeProfile.findUnique({
        where: { userId: viewer.id },
        select: { id: true },
      });
      employeeId = profile?.id ?? null;
    }
    if (!employeeId)
      throw new BadRequestException(
        'لا يوجد موظف مسؤول لهذا العميل؛ عيّن مسؤولًا قبل تسجيل المتابعة.',
      );

    const entry = await this.prisma.$transaction(async (tx) => {
      const created = await tx.followUp.create({
        data: {
          employeeId,
          clientId: client.id,
          dueAt: dateKeyToDate(dto.dueAt),
          status: FollowUpStatus.PENDING,
          notes: packFollowUpNotes({
            method: dto.method.trim(),
            outcome: dto.outcome.trim(),
            note: dto.note?.trim() || '',
          }),
        },
        include: FOLLOW_UP_INCLUDE,
      });
      await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action: 'FOLLOWUP_CREATE',
          entityType: 'FollowUp',
          entityId: created.id,
          after: { clientId: client.id, dueAt: dto.dueAt },
        },
      });
      // Employee activity reporting: the follow-up's birth keys on the immutable
      // follow-up row id, so a retried save never notifies twice.
      await this.notifications.notifyEmployeeRecordChange(
        tx,
        viewer,
        'FOLLOWUP_CREATED',
        { clientId: client.id, followUpId: created.id },
      );
      return created;
    });
    return serializeFollowUp(entry);
  }

  /**
   * Validates each wizard interest server-side, then upserts it on the
   * (client, property) pair — repeated submissions update the reason/notes
   * instead of creating duplicate links.
   *
   * Returns whether the upsert actually created new links or changed stored
   * values: a repeated wizard save with identical values reports `changed`
   * false, so it produces no manager notification.
   *
   * Rules enforced here, never trusted from the body:
   * - the `Property.id` must exist AND be visible through the SAME
   *   `propertyVisibilityWhere` rule as `GET /properties` (an id the viewer
   *   cannot see answers 404 without disclosing existence);
   * - only AVAILABLE properties accept a customer inquiry — a PENDING,
   *   REJECTED or otherwise unavailable row answers 400;
   * - the rows are written inside the caller's transaction, so the save of
   *   a client and its interests is atomic.
   */
  private async upsertInterests(
    tx: Prisma.TransactionClient,
    viewer: AuthUser,
    clientId: string,
    inputs: PropertyInterestInputDto[],
  ): Promise<InterestUpsertResult> {
    const normalized = inputs.map((input) => ({
      propertyId: input.propertyId,
      reason: input.reason?.trim() || null,
      notes: input.notes?.trim() || null,
    }));
    const stored = await tx.clientPropertyInterest.findMany({
      where: { clientId },
      select: { propertyId: true, reason: true, notes: true },
    });
    const storedKey = new Map(stored.map((row) => [row.propertyId, row]));

    let changed = false;
    for (const input of normalized) {
      const before = storedKey.get(input.propertyId) ?? null;

      const property = await tx.property.findFirst({
        where: { id: input.propertyId, ...propertyVisibilityWhere(viewer) },
        select: { id: true, status: true },
      });
      if (!property)
        throw new NotFoundException(
          'العقار المطلوب غير موجود أو غير مصرّح لك بالوصول إليه.',
        );
      if (property.status !== PropertyStatus.AVAILABLE)
        throw new BadRequestException(
          'لا يمكن ربط استفسار العميل إلا بعقار متاح بالبرنامج.',
        );
      await tx.clientPropertyInterest.upsert({
        where: {
          clientId_propertyId: {
            clientId,
            propertyId: input.propertyId,
          },
        },
        create: {
          clientId,
          propertyId: input.propertyId,
          reason: input.reason,
          notes: input.notes,
        },
        update: {
          reason: input.reason,
          notes: input.notes,
        },
      });

      // A missing row was created; an existing row counts as changed only when
      // one of the stored values actually moved.
      if (!before) {
        changed = true;
      } else if (
        before.reason !== input.reason ||
        before.notes !== input.notes
      ) {
        changed = true;
      }
    }
    return { changed };
  }
}

/** Whether an interest upsert touched anything (drives the interest event). */
interface InterestUpsertResult {
  changed: boolean;
}
