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
import { isManagement, isManager } from '../common/access/access-policy';
import { clientRequestChangeSummary } from './client-request-data';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ListClientsQueryDto } from './dto/list-clients.query';
import { CreateClientFollowUpDto } from './dto/create-follow-up.dto';
import { PropertyInterestInputDto } from './dto/property-interest.dto';
import type {
  ClientDto,
  ClientFollowUpDto,
  ClientListItemDto,
  ClientListDto,
  ClientPropertyInterestDto,
  ClientRecommendationCandidateDto,
  ClientRecommendationCandidateListDto,
  ClientStatsDto,
} from './client.dto';

/** One page of the lightweight client list. There is no total-record cap. */
const DEFAULT_CLIENTS_PAGE_SIZE = 50;
const MAX_CLIENTS_PAGE_SIZE = 100;

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
  approvedReference: true,
  title: true,
  area: true,
  askingPrice: true,
  currency: true,
} satisfies Prisma.PropertySelect;

/**
 * List projection: only scalar card fields plus two bounded summaries.
 * It never loads the follow-up log, deals or property interests themselves.
 */
const CLIENT_LIST_SELECT = {
  id: true,
  name: true,
  phone: true,
  notes: true,
  source: true,
  status: true,
  requestData: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { userId: true } },
  responsibleEmployee: {
    select: { userId: true, user: { select: { name: true } } },
  },
  // Newest few follow-ups: enough to find the newest LOGGED one after
  // unpacking the packed notes column, without loading the full history.
  followups: {
    orderBy: { createdAt: 'desc' as const },
    take: 5,
    select: {
      createdAt: true,
      notes: true,
      employee: { select: { user: { select: { name: true } } } },
    },
  },
  // Counts only: the detail endpoint returns the full collections.
  _count: {
    select: { deals: true, propertyInterests: true },
  },
} satisfies Prisma.ClientSelect;

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

type ClientListRow = Prisma.ClientGetPayload<{
  select: typeof CLIENT_LIST_SELECT;
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

function serializeClientListItem(
  client: ClientListRow,
  nextFollowUp: string | null,
): ClientListItemDto {
  const last = client.followups
    .map((entry) => ({ entry, detail: unpackFollowUpNotes(entry.notes) }))
    .find(({ detail }) => detail.outcome || detail.note);
  return {
    id: client.id,
    name: client.name,
    phone: client.phone,
    notes: client.notes ?? '',
    source: client.source ?? '',
    status: client.status ?? '',
    requestData: client.requestData ?? null,
    responsibleUserId: client.responsibleEmployee?.userId ?? null,
    responsibleEmployeeName: client.responsibleEmployee?.user.name ?? null,
    createdByUserId: client.createdBy?.userId ?? null,
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
    nextFollowUp,
    lastFollowUpAt: last?.entry.createdAt.toISOString() ?? null,
    lastFollowUpOutcome: last?.detail.outcome ?? '',
    lastFollowUpNote: last?.detail.note ?? '',
    lastFollowUpEmployeeName: last?.entry.employee.user.name ?? null,
    propertiesCount: client._count.deals,
    propertyInterestsCount: client._count.propertyInterests,
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
    requestData: client.requestData ?? null,
    responsibleUserId: client.responsibleEmployee?.userId ?? null,
    responsibleEmployeeName: client.responsibleEmployee?.user.name ?? null,
    createdByUserId: client.createdBy?.userId ?? null,
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
    nextFollowUp: pendingKeys[0] ?? null,
    followUps: client.followups.map(serializeFollowUp),
    properties: client.deals.map(({ property }) => ({
      id: property.id,
      reference: property.approvedReference ?? property.reference,
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
    reference: interest.property.approvedReference ?? interest.property.reference,
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

/**
 * Guards against the "?" corruption class at the ONLY entry to the store:
 * a name whose every letter is a literal question mark (U+003F) was once
 * accepted and permanently destroyed the real Arabic name. Such a value is
 * never a human name — it indicates a broken input path at the sender side.
 */
export function isUnreadableName(name: string | undefined): boolean {
  if (name === undefined) return false;
  const letters = name.replace(/[?\s\u061c\u200b-\u200f\u202a-\u202e]/g, '');
  return letters.length === 0;
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
    const filters: Prisma.ClientWhereInput[] = [
      clientOwnershipWhere(viewer),
    ];

    if (search) {
      filters.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    if (query.filter) {
      const todayStart = dateKeyToDate(todayKey());
      const tomorrow = new Date(todayStart);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      if (query.filter === 'today') {
        // "Today" means the EARLIEST pending follow-up is today, not just any
        // pending row today (an older overdue row would make it late).
        filters.push({
          followups: {
            none: { status: FollowUpStatus.PENDING, dueAt: { lt: todayStart } },
          },
        });
        filters.push({
          followups: {
            some: {
              status: FollowUpStatus.PENDING,
              dueAt: { gte: todayStart, lt: tomorrow },
            },
          },
        });
      } else if (query.filter === 'late') {
        filters.push({
          followups: {
            some: { status: FollowUpStatus.PENDING, dueAt: { lt: todayStart } },
          },
        });
      } else {
        // "Unmatched" keeps the existing contract: no deal-linked property.
        filters.push({ deals: { none: {} } });
      }
    }

    if (query.classification) {
      if (query.classification === 'owner') {
        filters.push({ deals: { some: {} } });
      } else if (query.classification === 'interested') {
        filters.push({ propertyInterests: { some: {} } });
      } else {
        const type =
          query.classification === 'buyer'
            ? 'BUYER'
            : query.classification === 'renter'
              ? 'RENTER'
              : 'EXCHANGER';
        filters.push({ requestData: { contains: `"${type}"` } });
      }
    }

    const where: Prisma.ClientWhereInput =
      filters.length === 1 ? (filters[0] ?? {}) : { AND: filters };
    const limit = Math.min(
      query.limit ?? DEFAULT_CLIENTS_PAGE_SIZE,
      MAX_CLIENTS_PAGE_SIZE,
    );
    const rows = await this.prisma.client.findMany({
      where,
      select: CLIENT_LIST_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    // One bounded aggregate for the page gives every card its next due date
    // without loading the follow-up history.
    const nextByClient = new Map<string, string>();
    if (page.length) {
      const pending = await this.prisma.followUp.groupBy({
        by: ['clientId'],
        where: {
          clientId: { in: page.map((row) => row.id) },
          status: FollowUpStatus.PENDING,
        },
        _min: { dueAt: true },
      });
      for (const row of pending) {
        if (row.clientId && row._min.dueAt) {
          nextByClient.set(row.clientId, toDateKey(row._min.dueAt));
        }
      }
    }

    return {
      items: page.map((row) =>
        serializeClientListItem(row, nextByClient.get(row.id) ?? null),
      ),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
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

    // Follow-up scope: the manager sees every company follow-up; an employee
    // sees follow-ups on their own clients plus rows assigned to them.
    let followUpScope: Prisma.FollowUpWhereInput = {};
    if (viewer.role === Role.EMPLOYEE) {
      const profile = await this.prisma.employeeProfile.findUnique({
        where: { userId: viewer.id },
        select: { id: true },
      });
      const orConditions: Prisma.FollowUpWhereInput[] = [
        { client: clientOwnershipWhere(viewer) },
      ];
      if (profile?.id) orConditions.push({ employeeId: profile.id });
      followUpScope = { OR: orConditions };
    }

    // Database-side counters: no client-id list is materialized in memory.
    // "Needs follow-up" = no pending row dated after today (none/today/overdue);
    // "late" = at least one pending row before today.
    const todayStart = dateKeyToDate(today);
    const tomorrowStart = dateKeyToDate(addDaysKey(today, 1));
    const [
      totalClients,
      activeClients,
      owners,
      brokers,
      followUpsThisWeek,
      clientsNeedingFollowUp,
      clientsLate,
      clientsWithoutProperty,
    ] = await Promise.all([
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
      this.prisma.client.count({
        where: {
          AND: [
            scope,
            {
              followups: {
                none: {
                  status: FollowUpStatus.PENDING,
                  dueAt: { gte: tomorrowStart },
                },
              },
            },
          ],
        },
      }),
      this.prisma.client.count({
        where: {
          AND: [
            scope,
            {
              followups: {
                some: {
                  status: FollowUpStatus.PENDING,
                  dueAt: { lt: todayStart },
                },
              },
            },
          ],
        },
      }),
      this.prisma.client.count({
        where: { AND: [scope, { deals: { none: {} } }] },
      }),
    ]);

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

  /**
   * `GET /clients/recommendation-candidates` — every eligible client in the
   * viewer's scope with a structured request document. This is deliberately
   * NOT the paginated list: recommendation matching/ranking must see the whole
   * authorised dataset (then the UI takes its top-N afterwards). Only the
   * three fields the matcher needs are selected.
   */
  async recommendationCandidates(
    viewer: AuthUser,
  ): Promise<ClientRecommendationCandidateListDto> {
    const rows = await this.prisma.client.findMany({
      where: {
        AND: [
          clientOwnershipWhere(viewer),
          { requestData: { not: null } },
        ],
      },
      select: { id: true, name: true, requestData: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const items: ClientRecommendationCandidateDto[] = rows
      .filter((row) => Boolean(row.requestData?.trim()))
      .map((row) => ({
        id: row.id,
        name: row.name,
        requestData: row.requestData,
      }));
    return { items };
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
    // BYPASS GUARD: an employee's additions ALWAYS go through the staged
    // review workflow (`POST /client-reviews`) — a pending creation can never
    // skip a manager approval and appear in the approved lists. Employees
    // have no direct write path to `Client` rows at all.
    if (viewer.role === Role.EMPLOYEE)
      throw new ForbiddenException(
        'إضافة العملاء من حساب الموظف تتم عبر طلب المراجعة الآن (تبويب «تحت المراجعة»).',
      );
    // Store-front integrity: reject the unreadable-name corruption before it
    // can ever be persisted (the only recoverable state is a non-entry).
    if (isUnreadableName(dto.name))
      throw new BadRequestException(
        'الاسم غير قابل للقراءة — علامات استفهام بدل الحروف. أدخل اسم العميل بلون سليم.',
      );
    const created = await this.prisma.$transaction(async (tx) => {
      let createdById: string | null = null;
      let responsibleEmployeeId: string | null = null;
      // The stable USER-level attribution of a MANAGER-registered client with
      // no responsible employee: the manager becomes the follow-up's
      // responsible user (FollowUpSubject.responsibleUserId) — never invented
      // ownership, always this real relationship (§7).
      let createdByUserId: string | null = null;
      // Managers/OWNER keep user-level attribution even when they assign a
      // responsible employee, so an unassigned client never disappears from
      // its creator's team scope later.
      if (isManagement(viewer)) createdByUserId = viewer.id;

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
        // Managers link responsibility by stable User.id, never by name, and
        // only within their current team. OWNER may assign any employee.
        responsibleEmployeeId = await this.resolveResponsibleEmployee(
          tx,
          viewer,
          dto.responsibleUserId,
        );
      } else if (isManagement(viewer)) {
        // Management-registered, unassigned client: the actor is the
        // responsible user (FollowUpSubject.responsibleUserId).
        createdByUserId = viewer.id;
      }

      const client = await tx.client.create({
        data: {
          name: dto.name.trim(),
          phone: dto.phone.trim(),
          notes: dto.notes?.trim() || null,
          source: dto.source?.trim() || null,
          createdById,
          createdByUserId,
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
   * The privacy-safe Arabic summary of a client PATCH, one item per REALLY
   * changed field (drives the CLIENT_UPDATED notification to the managers).
   *
   * Only plain identity values travel with old → new; the phone, the notes and
   * the responsible employee appear as a FACT ONLY («تم تغيير رقم الهاتف») —
   * their contents never go into the bell or Web Push.
   */
  private static clientChangeSummary(
    existing: {
      name: string;
      phone: string;
      notes: string | null;
      source: string | null;
      responsibleEmployeeId: string | null;
      requestData?: string | null;
    },
    dto: UpdateClientDto,
    responsibleEmployeeId: string | null | undefined,
    existingRequestData: string | null = null,
  ): string {
    const items: string[] = [];
    if (dto.name !== undefined && (dto.name.trim() || '') !== existing.name)
      items.push(`الاسم: من ${existing.name} إلى ${dto.name.trim()}`);
    if (
      dto.source !== undefined &&
      (dto.source?.trim() || null) !== existing.source
    )
      items.push(
        existing.source
          ? `المصدر: من ${existing.source} إلى ${dto.source?.trim() || '(فارغ)'}`
          : `المصدر: ${dto.source?.trim() || '(فارغ)'}`,
      );
    if (dto.phone !== undefined && (dto.phone.trim() || '') !== existing.phone)
      items.push('تم تغيير رقم الهاتف');
    if (
      dto.notes !== undefined &&
      (dto.notes?.trim() || null) !== existing.notes
    )
      items.push('تم تعديل الملاحظات');
    if (
      responsibleEmployeeId !== undefined &&
      responsibleEmployeeId !== existing.responsibleEmployeeId
    )
      items.push('تم تغيير الموظف المسؤول');
    // The structured wizard request diffs (typed old → new values, fact-only
    // free-form changes) — appended only when the save carried a document.
    items.push(...clientRequestChangeSummary(existingRequestData, dto));
    return items.filter(Boolean).join('، ');
  }

  /**
   * Did the PATCH actually change anything? The employee update is reported to
   * the managers only on a real change — a repeated save with identical values
   * produces no notification (the DB write itself stays as before).
   */
  /**
   * Resolves a responsible employee by stable User.id. A MANAGER may only
   * assign a currently assigned team member; OWNER may assign any employee.
   * Cross-team ids answer 404 so existence never leaks.
   */
  private async resolveResponsibleEmployee(
    tx: Prisma.TransactionClient,
    viewer: AuthUser,
    userId: string,
  ): Promise<string> {
    const profile = await tx.employeeProfile.findUnique({
      where: { userId },
      select: { id: true, managerUserId: true },
    });
    if (!profile)
      throw new BadRequestException('حساب الموظف المسؤول غير موجود.');
    if (isManager(viewer) && profile.managerUserId !== viewer.id)
      throw new NotFoundException('employee not found');
    return profile.id;
  }

  private static clientPatchChanged(
    existing: {
      name: string;
      phone: string;
      notes: string | null;
      source: string | null;
      responsibleEmployeeId: string | null;
      requestData?: string | null;
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
    if (
      dto.requestData !== undefined &&
      (dto.requestData?.trim() || null) !== (existing.requestData ?? null)
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
    // BYPASS GUARD: employee edits ALWAYS go through the staged review
    // workflow (`POST`/`PATCH /client-reviews`). An approved client row —
    // including its request document and property interests — can only be
    // changed by a manager decision on a review.
    if (viewer.role === Role.EMPLOYEE)
      throw new ForbiddenException(
        'تعديل بيانات العملاء من حساب الموظف يتم عبر طلب مراجعة الآن (تبويب «تحت المراجعة»).',
      );
    const existing = await this.prisma.client.findFirst({
      where: { id, ...clientOwnershipWhere(viewer) },
      select: {
        id: true,
        name: true,
        phone: true,
        notes: true,
        source: true,
        responsibleEmployeeId: true,
        requestData: true,
      },
    });
    if (!existing) throw new NotFoundException('Client not found');
    if (isUnreadableName(dto.name))
      throw new BadRequestException(
        'الاسم غير قابل للقراءة — علامات استفهام بدل الحروف. أدخل اسم العميل بلون سليم.',
      );
    // The wizard request document must be valid JSON — a corrupted pack never
    // enters the history (the store itself stays opaque).
    if (dto.requestData !== null && dto.requestData !== undefined) {
      try {
        JSON.parse(dto.requestData);
      } catch {
        throw new BadRequestException('شكل بيانات الطلب غير صالح.');
      }
    }
    if (dto.responsibleUserId !== undefined && !isManagement(viewer))
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
        responsibleEmployeeId =
          dto.responsibleUserId === null
            ? null
            : await this.resolveResponsibleEmployee(
                tx,
                viewer,
                dto.responsibleUserId,
              );
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
          ...(dto.requestData !== undefined
            ? {
                // The packed wizard document travels exactly as written (the
                // frontend owns the pack); validity is enforced just below.
                requestData: dto.requestData?.trim() || null,
              }
            : {}),
        },
        include: CLIENT_DETAIL_INCLUDE,
      });

      // Linking an EXISTING authorised client to another property: every
      // interest upserts on the (client, property) pair, so repeated
      // submissions never create duplicate rows and never re-create the
      // client itself.
      let upsertChange: InterestUpsertResult | null = null;
      if (dto.propertyInterests?.length) {
        upsertChange = await this.upsertInterests(
          tx,
          viewer,
          id,
          dto.propertyInterests,
        );
      }
      // Explicit wizard edit choices: what the user REMOVED is deleted from
      // this client's recorded interests (and never touches another client's
      // — the deleteMany is scoped to `id`). A removal is an interest change
      // exactly like an upsert.
      let removedInterests = 0;
      if (dto.removePropertyInterestIds?.length)
        removedInterests = (
          await tx.clientPropertyInterest.deleteMany({
            where: { clientId: id, propertyId: { in: dto.removePropertyInterestIds } },
          })
        ).count;
      const interestChanged =
        Boolean(upsertChange?.changed) || removedInterests > 0;

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
          {
            clientId: client.id,
            clientChangeSummary: ClientsService.clientChangeSummary(
              existing,
              dto,
              responsibleEmployeeId,
              existing.requestData ?? null,
            ),
          },
        );
      }
      if (interestChanged) {
        await this.notifications.notifyEmployeeRecordChange(
          tx,
          viewer,
          'CLIENT_INTEREST_UPDATED',
          { clientId: client.id },
        );
      }
      // Return the client WITH the freshly upserted/removed interests visible.
      return dto.propertyInterests?.length || removedInterests > 0
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
