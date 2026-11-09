import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, PropertyStatus, AssignmentPurpose } from '@prisma/client';
import type { AuthUser } from '@arkan/shared';
import { Role } from '@arkan/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { clientOwnershipWhere, ensureEmployeeProfile } from '../clients/client-policy';
import { isManagement, isManager } from '../common/access/access-policy';

import {
  addHours,
  dueBucket,
  formatLateDuration,
  kuwaitDayKey,
  policyFor,
  resolveReminderCooldownHours,
  resolveSchedule,
  type DueBucket,
  type FollowUpSchedule,
} from './followup-schedule';
import {
  parseTargetKey,
  requestTypesOf,
  subjectLabel,
  subjectTargetKey,
  tabsOf,
  type FollowUpTabId,
  type RequestType,
} from './followup-subjects';
import {
  FOLLOWUP_REMINDER_TITLE,
  followUpReminderBody,
  followUpReminderEventKey,
  recordEventKeys,
  recordEventTitle,
  followUpCreatedBody,
  type FollowUpEventSubject,
  type NotificationDraft,
} from '../notifications/notification-events';
import type { SaveFollowUpBatchDto } from './dto/save-follow-up-batch.dto';
import type {
  FollowUpStatusQuery,
  FollowUpTabQuery,
  ListFollowUpsQueryDto,
  ListSupervisionFollowUpsQueryDto,
} from './dto/list-follow-ups.query';

/** How many subjects one list response may carry (the scope is one employee). */
/** One feed page. There is no total-record cap. */
const DEFAULT_FOLLOWUP_PAGE_SIZE = 50;
const MAX_FOLLOWUP_PAGE_SIZE = 100;
/** Milliseconds per hour (the keep-simple duration math of reminder spacing). */
const HOUR_MS = 3_600_000;
/** Kuwait is UTC+3 with no DST. */
const KUWAIT_OFFSET_MS = 3 * HOUR_MS;

/**
 * The shared subject selection for every read path: identity + person +
 * responsibility (BOTH sides — employee profile and manager user) + the last
 * entry. `toSubjectDto` resolves whichever responsible side is set.
 */
const SUBJECT_SELECT = {
  id: true,
  kind: true,
  targetKey: true,
  nextDueAt: true,
  lastSavedAt: true,
  property: {
    select: {
      id: true,
      reference: true,
      title: true,
      area: true,
      listingType: true,
      owner: { select: { id: true, name: true, phone: true } },
      contact: { select: { id: true, name: true, phone: true } },
    },
  },
  client: { select: { id: true, name: true, phone: true } },
  responsibleUserId: true,
  entries: {
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
    select: {
      note: true,
      createdAt: true,
      author: { select: { user: { select: { name: true } } } },
      authorUser: { select: { name: true } },
    },
  },
  _count: { select: { entries: true } },
  responsible: { select: { user: { select: { id: true, name: true } } } },
  responsibleUser: { select: { id: true, name: true } },
} satisfies Prisma.FollowUpSubjectSelect;

/** The typed row shape of `SUBJECT_SELECT`. */
type SubjectRow = Prisma.FollowUpSubjectGetPayload<{
  select: typeof SUBJECT_SELECT;
}>;

/** Terminal property states: no further owner/inquiry follow-up is owed. */
const TERMINAL_PROPERTY_STATES: readonly PropertyStatus[] = [
  PropertyStatus.SOLD,
  PropertyStatus.RENTED,
  PropertyStatus.ARCHIVED,
];

type SubjectKindName = 'PROPERTY_OWNER' | 'CLIENT_REQUEST' | 'INQUIRY' | 'CLIENT';

/** One expected (targetKey → desired state) row produced by a sync pass. */
interface ExpectedSubject {
  kind: SubjectKindName;
  /** Employee responsibility: the `EmployeeProfile` id (null on manager rows). */
  responsibleId: string | null;
  /** Manager responsibility: the `User` id (null on employee rows). Never both. */
  responsibleUserId: string | null;
  propertyId?: string | null;
  clientId?: string | null;
  interestId?: string | null;
}

export interface FollowUpPersonDto {
  /** Record table the identity comes from — the grouping key ingredient. */
  type: 'CONTACT' | 'OWNER' | 'CLIENT';
  id: string;
  name: string;
  phone: string;
}

/** The ACTUAL responsible user of a subject (employee or manager). */
export interface FollowUpResponsibleDto {
  userId: string;
  name: string;
}

export interface FollowUpSubjectDto {
  id: string;
  kind: SubjectKindName;
  /** Structured request type (CLIENT_REQUEST subjects only). */
  requestType: RequestType | null;
  label: string;
  /** The tabs this subject appears in (without the implicit «الكل»). */
  tabs: FollowUpTabId[];
  person: FollowUpPersonDto | null;
  propertyId: string | null;
  propertyReference: string | null;
  propertyTitle: string | null;
  area: string | null;
  clientId: string | null;
  /** Next due instant (UTC ISO). */
  dueAt: string;
  bucket: DueBucket;
  /** The actual responsible user for this subject (invariant: always resolvable). */
  responsible: FollowUpResponsibleDto | null;
  /** Last saved note instant (UTC ISO) — null = «لم تتم متابعتها». */
  lastSavedAt: string | null;
  entryCount: number;
  latest: { note: string; createdAt: string; authorName: string | null } | null;
}

export interface FollowUpEntryDto {
  id: string;
  note: string;
  authorName: string | null;
  createdAt: string;
  /** Shared conversation id — correlates a batch WITHOUT merging histories. */
  batchId: string | null;
  prevDueAt: string | null;
  nextDueAt: string | null;
}

export interface FollowUpBatchResultDto {
  /** True when this exact batch was already committed and simply replayed. */
  replayed: boolean;
  savedCount: number;
  saved: Array<{ subjectId: string; entryId: string; nextDueAt: string }>;
}

/** ONE subject in the MANAGER supervision overview (§2 «متابعات الموظفين»). */
/** Full-scope counters for the current authorized feed (not the loaded page). */
export interface FollowUpSummaryDto {
  total: number;
  overdue: number;
  today: number;
  upcoming: number;
  never: number;
  tabs: Record<FollowUpTabId, number>;
}

export interface FollowUpPageDto {
  items: FollowUpSubjectDto[];
  nextCursor: string | null;
  /** Backward-compatible alias for `nextCursor !== null`. */
  truncated: boolean;
  generatedAt: string;
  /** Only present on the first page. */
  summary?: FollowUpSummaryDto;
}

export interface FollowUpSupervisionPageDto extends FollowUpPageDto {
  items: FollowUpSupervisionSubjectDto[];
  /** All responsible employees in the full scope (for the filter), first page only. */
  employees?: FollowUpResponsibleDto[];
}

export interface FollowUpSupervisionSubjectDto extends FollowUpSubjectDto {
  /** The responsible EMPLOYEE (supervision rows are always employee-owned). */
  responsible: FollowUpResponsibleDto;
  /** The latest manual manager reminder sent for this subject, if any (§6). */
  lastReminderAt: string | null;
}

export interface FollowUpReminderResultDto {
  subjectId: string;
  recipientUserId: string;
  recipientName: string;
  sentAt: string;
  /** The instant the NEXT reminder becomes allowed (the cooldown window end). */
  cooldownUntil: string;
  /** True when a concurrent click in the same window already sent it. */
  replayed: boolean;
}

/**
 * The employee follow-ups feature (tasks §1–§8).
 *
 * Responsibilities:
 *  - `sync`: materialize ONE durable subject per approved property/request/
 *    interest (idempotent upsert on the unique `targetKey`; deactivates
 *    terminal targets without ever touching history) — approvals, reloads and
 *    concurrent jobs all converge on the same rows (§3). Responsibility is
 *    re-resolved EVERY pass from the canonical assignment/enterer/ownership
 *    facts: an EMPLOYEE subject carries `responsibleId`, a MANAGER-owned
 *    subject (the manager's own unassigned property/registered client)
 *    carries `responsibleUserId` — a transfer rewrites exactly these two
 *    columns and never the schedule or history (§7);
 *  - `list`/`history`: the scoped read paths (§1, §6) — an employee only ever
 *    sees `responsible.userId = viewer`; a manager's personal list is HIS OWN
 *    `responsibleUserId` subjects («متابعاتي»), while employee histories stay
 *    readable for supervision through the read-only endpoints;
 *  - `saveBatch`: the atomic multi-subject save (§5) — per-subject due-date
 *    reset only, idempotent per `(author, batchId, subjectId)`; a manager
 *    saves ONLY his own subjects and is recorded as `authorUser`;
 *  - `listSupervision`/`sendReminder`: the manager-only overview and the
 *    manual reminders (§2–§4, §6) — read-only + notify-only, never a write to
 *    an employee's due date, cycle, ownership or history.
 *
 * The schedule itself is server-UTC (`followup-schedule.ts`); nothing here
 * accepts a due date or an author from the client.
 */
@Injectable()
export class FollowUpsService {
  private readonly logger = new Logger(FollowUpsService.name);
  private readonly schedule: FollowUpSchedule = resolveSchedule();
  private schemaReady = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // -------------------------------------------------------------------------
  // Schema probe — the migration is prepared but requires explicit approval.
  // -------------------------------------------------------------------------

  /**
   * Throws a HONEST 503 until migration `20261024120000_follow_up_subjects`
   * has been applied: the feature must never pretend to be operational
   * against a database that lacks its tables.
   */
  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;
    try {
      await this.prisma.$queryRaw`SELECT 1 FROM "FollowUpSubject" LIMIT 1`;
      this.schemaReady = true;
    } catch {
      throw new ServiceUnavailableException(
        'ميزة المتابعات غير مفعّلة بعد: ترقية قاعدة البيانات الخاصة بالمتابعات (20261024120000_follow_up_subjects) بانتظار موافقة الإدارة ولم تُطبَّق بعد.',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Subject materialization (§3, §4) — pure derivation from approved rows.
  // -------------------------------------------------------------------------

  /**
   * Reconciles subjects from canonical data. `viewer = null` means the
   * company-wide pass (background scheduler); an employee pass only touches
   * THEIR properties/clients (responsibility itself is always re-resolved
   * from the canonical assignment/enterer/ownership facts, so a scoped pass
   * can never reassign anything incorrectly — it computes the same row the
   * company pass would).
   */
  async sync(viewer: AuthUser | null): Promise<void> {
    const now = new Date();
    const propertyScope: Prisma.PropertyWhereInput | null =
      !viewer || viewer.role === Role.MANAGER
        ? null
        : {
            OR: [
              { createdByUserId: viewer.id },
              { createdBy: { userId: viewer.id } },
              { assignments: { some: { employee: { userId: viewer.id } } } },
            ],
          };
    const clientScope: Prisma.ClientWhereInput | null =
      !viewer || viewer.role === Role.MANAGER
        ? null
        : clientOwnershipWhere(viewer);

    await this.syncProperties(now, propertyScope);
    await this.syncClients(now, clientScope);
  }

  /**
   * OWNER_FOLLOWUP assignment → the enterer → the earliest assignment of any
   * purpose → none (no subject: nobody is responsible).
   * The enterer counts by the REAL `createdByUserId` link: an EMPLOYEE gets
   * (or gets provisioned) the owner `EmployeeProfile`, and a MANAGER becomes
   * the follow-up's responsible USER himself — his own obligation («متابعاتي»
   * §2), so manager-created properties stop being invisible follow-up gaps.
   * An OWNER_FOLLOWUP assignment to an employee always wins over the enterer,
   * manager or not.
   */
  private async syncProperties(
    now: Date,
    scope: Prisma.PropertyWhereInput | null,
  ): Promise<void> {
    const properties = await this.prisma.property.findMany({
      where: scope ?? {},
      select: {
        id: true,
        status: true,
        createdByUserId: true,
        assignments: {
          select: { employeeId: true, purpose: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    const creatorIds = [
      ...new Set(
        properties
          .map((property) => property.createdByUserId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const [profiles, users] = await Promise.all([
      this.prisma.employeeProfile.findMany({
        where: { userId: { in: creatorIds } },
        select: { id: true, userId: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: creatorIds } },
        select: { id: true, role: true },
      }),
    ]);
    const profileByUser = new Map(profiles.map((row) => [row.userId, row.id]));
    const roleByUser = new Map(users.map((row) => [row.id, row.role]));

    const expected = new Map<string, ExpectedSubject>();
    for (const property of properties) {
      // PENDING/REJECTED: the approval clock has not started (§4 — pending
      // approval time never counts as employee delay). SOLD/RENTED/ARCHIVED:
      // terminal — any existing subject is deactivated below. NEVER derived
      // from free-text notes, only from the structured status.
      if (property.status !== PropertyStatus.AVAILABLE) continue;

      const ownerFollowUp = property.assignments.find(
        (assignment) => assignment.purpose === AssignmentPurpose.OWNER_FOLLOWUP,
      );
      let responsibleId: string | null = ownerFollowUp?.employeeId ?? null;
      let responsibleUserId: string | null = null;

      if (!responsibleId && property.createdByUserId) {
        const entererRole = roleByUser.get(property.createdByUserId);
        const existingProfile = profileByUser.get(property.createdByUserId);
        if (existingProfile) {
          responsibleId = existingProfile;
        } else if (entererRole === Role.MANAGER) {
          // A manager's own property: HE is the responsible user.
          responsibleUserId = property.createdByUserId;
        } else if (entererRole === Role.EMPLOYEE) {
          // On-demand provisioning (same precedent as client ownership).
          responsibleId = await ensureEmployeeProfile(
            this.prisma,
            property.createdByUserId,
          );
        }
      }
      if (!responsibleId && !responsibleUserId) {
        responsibleId = property.assignments[0]?.employeeId ?? null;
      }
      if (!responsibleId && !responsibleUserId) continue;

      expected.set(subjectTargetKey.property(property.id), {
        kind: 'PROPERTY_OWNER',
        responsibleId,
        responsibleUserId,
        propertyId: property.id,
      });
    }

    await this.reconcile({
      kinds: ['PROPERTY_OWNER'],
      now,
      expected,
      candidates: scope
        ? { propertyId: { in: properties.map((property) => property.id) } }
        : null,
    });
  }

  /** CLIENT_REQUEST / INQUIRY / CLIENT subjects of the scoped clients (§3). */
  private async syncClients(
    now: Date,
    scope: Prisma.ClientWhereInput | null,
  ): Promise<void> {
    const clients = await this.prisma.client.findMany({
      where: scope ?? {},
      select: {
        id: true,
        responsibleEmployeeId: true,
        createdById: true,
        createdByUserId: true,
        requestData: true,
        propertyInterests: {
          select: {
            id: true,
            property: { select: { status: true } },
          },
        },
      },
    });

    const expected = new Map<string, ExpectedSubject>();
    for (const client of clients) {
      // Employee responsibility → `responsibleId`; when NO employee is
      // responsible and a MANAGER registered the client himself, the
      // manager's `createdByUserId` makes HIS OWN follow-up obligation (§2).
      // A manager who assigned an employee keeps the employee responsible.
      const responsibleId = client.responsibleEmployeeId ?? client.createdById;
      const responsibleUserId = responsibleId ? null : client.createdByUserId ?? null;
      if (!responsibleId && !responsibleUserId) continue; // unowned client → no obligation yet.

      // ONLY the structured, approved document decides request subjects —
      // legacy notes are never parsed (§3: never fabricate structure).
      const types = requestTypesOf(client.requestData);
      const activeInterests = client.propertyInterests.filter(
        (interest) =>
          !TERMINAL_PROPERTY_STATES.includes(interest.property.status),
      );

      for (const type of types) {
        expected.set(subjectTargetKey.clientRequest(client.id, type), {
          kind: 'CLIENT_REQUEST',
          responsibleId,
          responsibleUserId,
          clientId: client.id,
        });
      }
      for (const interest of activeInterests) {
        expected.set(subjectTargetKey.inquiry(interest.id), {
          kind: 'INQUIRY',
          responsibleId,
          responsibleUserId,
          clientId: client.id,
          interestId: interest.id,
        });
      }
      // Fully legacy client (no requests, no inquiries) → ONE client-level
      // subject so old rows still get follow-up WITHOUT inventing requests.
      if (!types.length && !activeInterests.length) {
        expected.set(subjectTargetKey.client(client.id), {
          kind: 'CLIENT',
          responsibleId,
          responsibleUserId,
          clientId: client.id,
        });
      }
    }

    await this.reconcile({
      kinds: ['CLIENT_REQUEST', 'INQUIRY', 'CLIENT'],
      now,
      expected,
      candidates: scope
        ? { clientId: { in: clients.map((client) => client.id) } }
        : null,
    });
  }

  /**
   * Converges the stored subjects toward `expected`:
   *   1. creates missing rows (`skipDuplicates` absorbs concurrent syncs),
   *   2. re-activates expected-but-inactive rows with a FRESH anchor (no
   *      artificial overdue after a terminal period) and applies
   *      responsibility transfers,
   *   3. deactivates stale candidates — schedule/history untouched (§6: the
   *      permanent record is append-only and always kept).
   */
  private async reconcile(input: {
    kinds: SubjectKindName[];
    now: Date;
    expected: Map<string, ExpectedSubject>;
    /** Subjects considered for deactivation; null = company-wide sweep. */
    candidates: Prisma.FollowUpSubjectWhereInput | null;
  }): Promise<void> {
    const { kinds, now, expected, candidates } = input;
    const existing = await this.prisma.followUpSubject.findMany({
      where: { kind: { in: kinds }, ...(candidates ?? {}) },
      select: {
        id: true,
        targetKey: true,
        kind: true,
        active: true,
        cycle: true,
        responsibleId: true,
        responsibleUserId: true,
      },
    });
    const byKey = new Map(existing.map((row) => [row.targetKey, row]));

    const creates = [...expected.entries()]
      .filter(([targetKey]) => !byKey.has(targetKey))
      .map(([targetKey, want]) => ({
        targetKey,
        kind: want.kind,
        responsibleId: want.responsibleId,
        responsibleUserId: want.responsibleUserId,
        propertyId: want.propertyId ?? null,
        clientId: want.clientId ?? null,
        interestId: want.interestId ?? null,
        activatedAt: now,
        nextDueAt: addHours(
          now,
          policyFor(want.kind, this.schedule).intervalHours,
        ),
        cycle: 1,
      }));
    if (creates.length) {
      await this.prisma.followUpSubject.createMany({
        data: creates,
        skipDuplicates: true,
      });
    }

    for (const [targetKey, want] of expected) {
      const row = byKey.get(targetKey);
      if (!row) continue;
      // Responsibility TRANSFER (§7): exactly the two responsibility columns
      // change in ONE statement that writes both at once (the database CHECK
      // "exactly one responsible side" is validated per statement, so the
      // connect-then-disconnect two-step of a nested relation update is not
      // an option). Due date, cycle flags and the append-only history are
      // NEVER touched by a transfer, and no duplicate subject exists because
      // `targetKey` is the same unique row.
      if (
        row.responsibleId !== want.responsibleId ||
        row.responsibleUserId !== want.responsibleUserId
      ) {
        await this.prisma.$executeRaw`UPDATE "FollowUpSubject" SET "responsibleId" = ${want.responsibleId}::uuid, "responsibleUserId" = ${want.responsibleUserId}::uuid WHERE "id" = ${row.id}::uuid`;
      }
      // Re-activation (fresh anchor) is independent of responsibility and
      // touches none of the responsible columns, so the typed update applies.
      const reactivation: Prisma.FollowUpSubjectUpdateInput = {};
      if (!row.active) {
        // Documented safe re-activation: the clock restarts NOW (never
        // backdated), and `cycle + 1` re-arms escalation eligibility exactly
        // like a genuinely new follow-up cycle.
        reactivation.active = true;
        reactivation.deactivatedAt = null;
        reactivation.activatedAt = now;
        reactivation.nextDueAt = addHours(
          now,
          policyFor(row.kind, this.schedule).intervalHours,
        );
        reactivation.cycle = row.cycle + 1;
      }
      if (Object.keys(reactivation).length > 0) {
        await this.prisma.followUpSubject.update({
          where: { id: row.id },
          data: reactivation,
        });
      }
    }

    const staleIds = existing
      .filter((row) => row.active && !expected.has(row.targetKey))
      .map((row) => row.id);
    if (staleIds.length > 0) {
      await this.prisma.followUpSubject.updateMany({
        where: { id: { in: staleIds } },
        data: { active: false, deactivatedAt: now },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Read paths (§1, §6)
  // -------------------------------------------------------------------------

  /** The viewer's active subjects, synchronized from canonical data first. */
  async list(
    viewer: AuthUser,
    query: ListFollowUpsQueryDto = {},
  ): Promise<FollowUpPageDto> {
    await this.ensureSchema();
    // Synchronize once for the first page; cursor pages continue the already
    // synchronized feed without repeating the full canonical scan.
    if (!query.cursor) await this.sync(viewer);
    const now = new Date();
    // Employees: `responsible.userId` (their rows carry responsibleId only).
    // Managers: HIS OWN manager-owned subjects («متابعاتي» §2) — never a
    // company-wide dump and never an employee's subjects.
    const scope: Prisma.FollowUpSubjectWhereInput =
      viewer.role === Role.EMPLOYEE
        ? { responsible: { userId: viewer.id } }
        : { responsibleUserId: viewer.id };

    const page = await this.queryPage(scope, query, now, false);
    const summary = query.cursor
      ? undefined
      : await this.buildSummary(scope, now);
    return {
      items: page.rows.map((row) => this.toSubjectDto(row, now)),
      nextCursor: page.nextCursor,
      truncated: page.truncated,
      generatedAt: now.toISOString(),
      ...(summary ? { summary } : {}),
    };
  }

  private kuwaitBounds(now: Date): { start: Date; end: Date } {
    const key = kuwaitDayKey(now);
    const start = new Date(
      Date.parse(`${key}T00:00:00.000Z`) - KUWAIT_OFFSET_MS,
    );
    return { start, end: new Date(start.getTime() + 24 * HOUR_MS) };
  }

  private statusWhere(
    status: FollowUpStatusQuery | undefined,
    now: Date,
  ): Prisma.FollowUpSubjectWhereInput {
    if (!status || status === 'all') return {};
    if (status === 'NEVER') return { lastSavedAt: null };
    const { start, end } = this.kuwaitBounds(now);
    if (status === 'OVERDUE') return { nextDueAt: { lt: start } };
    if (status === 'TODAY') {
      return { nextDueAt: { gte: start, lt: end } };
    }
    return { nextDueAt: { gte: end } };
  }

  private tabWhere(
    tab: FollowUpTabQuery | undefined,
  ): Prisma.FollowUpSubjectWhereInput {
    if (!tab || tab === 'all') return {};
    if (tab === 'owners') return { kind: 'PROPERTY_OWNER' };
    if (tab === 'sellers') {
      return {
        kind: 'PROPERTY_OWNER',
        property: { is: { listingType: 'SALE' } },
      };
    }
    if (tab === 'lessors') {
      return {
        kind: 'PROPERTY_OWNER',
        property: { is: { listingType: 'RENT' } },
      };
    }
    if (tab === 'inquiries') return { kind: 'INQUIRY' };
    const type =
      tab === 'buyers'
        ? 'BUYER'
        : tab === 'renters'
          ? 'RENTER'
          : 'EXCHANGER';
    return {
      kind: 'CLIENT_REQUEST',
      targetKey: { endsWith: `:${type}` },
    };
  }

  private searchWhere(
    term: string,
    includeResponsible: boolean,
  ): Prisma.FollowUpSubjectWhereInput {
    const contains = { contains: term, mode: 'insensitive' as const };
    const OR: Prisma.FollowUpSubjectWhereInput[] = [
      { property: { is: { reference: contains } } },
      { property: { is: { title: contains } } },
      { property: { is: { area: contains } } },
      { property: { is: { contact: { is: { name: contains } } } } },
      { property: { is: { contact: { is: { phone: contains } } } } },
      { property: { is: { owner: { is: { name: contains } } } } },
      { property: { is: { owner: { is: { phone: contains } } } } },
      { client: { is: { name: contains } } },
      { client: { is: { phone: contains } } },
    ];
    if (includeResponsible) {
      OR.push({
        responsible: { is: { user: { is: { name: contains } } } },
      });
      OR.push({ responsibleUser: { is: { name: contains } } });
    }
    return { OR };
  }

  private composeWhere(
    scope: Prisma.FollowUpSubjectWhereInput,
    query: ListFollowUpsQueryDto,
    now: Date,
    includeResponsibleSearch: boolean,
  ): Prisma.FollowUpSubjectWhereInput {
    const and: Prisma.FollowUpSubjectWhereInput[] = [scope];
    const search = query.search?.trim();
    if (search) and.push(this.searchWhere(search, includeResponsibleSearch));
    if (query.tab && query.tab !== 'all') and.push(this.tabWhere(query.tab));
    if (query.status && query.status !== 'all') {
      and.push(this.statusWhere(query.status, now));
    }
    return and.length === 1 ? scope : { AND: and };
  }

  private async queryPage(
    scope: Prisma.FollowUpSubjectWhereInput,
    query: ListFollowUpsQueryDto,
    now: Date,
    includeResponsibleSearch: boolean,
  ): Promise<{
    rows: SubjectRow[];
    nextCursor: string | null;
    truncated: boolean;
  }> {
    const limit = Math.min(
      query.limit ?? DEFAULT_FOLLOWUP_PAGE_SIZE,
      MAX_FOLLOWUP_PAGE_SIZE,
    );
    const rows = await this.prisma.followUpSubject.findMany({
      where: this.composeWhere(scope, query, now, includeResponsibleSearch),
      orderBy: [{ nextDueAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: SUBJECT_SELECT,
    });
    const truncated = rows.length > limit;
    const page = truncated ? rows.slice(0, limit) : rows;
    return {
      rows: page,
      nextCursor: truncated ? (page[page.length - 1]?.id ?? null) : null,
      truncated,
    };
  }

  private async buildSummary(
    scope: Prisma.FollowUpSubjectWhereInput,
    now: Date,
  ): Promise<FollowUpSummaryDto> {
    const count = (extra?: Prisma.FollowUpSubjectWhereInput) =>
      this.prisma.followUpSubject.count({
        where: extra ? { AND: [scope, extra] } : scope,
      });
    const [
      total,
      overdue,
      today,
      upcoming,
      never,
      owners,
      buyers,
      sellers,
      renters,
      lessors,
      inquiries,
      exchanges,
    ] = await Promise.all([
      count(),
      count(this.statusWhere('OVERDUE', now)),
      count(this.statusWhere('TODAY', now)),
      count(this.statusWhere('UPCOMING', now)),
      count(this.statusWhere('NEVER', now)),
      count(this.tabWhere('owners')),
      count(this.tabWhere('buyers')),
      count(this.tabWhere('sellers')),
      count(this.tabWhere('renters')),
      count(this.tabWhere('lessors')),
      count(this.tabWhere('inquiries')),
      count(this.tabWhere('exchanges')),
    ]);
    return {
      total,
      overdue,
      today,
      upcoming,
      never,
      tabs: {
        all: total,
        owners,
        buyers,
        sellers,
        renters,
        lessors,
        inquiries,
        exchanges,
      },
    };
  }

  private toSubjectDto(row: SubjectRow, now: Date): FollowUpSubjectDto {
    const parsed = parseTargetKey(row.targetKey);
    const requestType = parsed?.requestType ?? null;
    const label = subjectLabel({
      kind: row.kind,
      requestType,
      reference: row.property?.reference,
      clientName: row.client?.name,
    });
    const person: FollowUpPersonDto | null = row.property
      ? row.property.contact
        ? {
            type: 'CONTACT',
            id: row.property.contact.id,
            name: row.property.contact.name,
            phone: row.property.contact.phone,
          }
        : row.property.owner
          ? {
              type: 'OWNER',
              id: row.property.owner.id,
              name: row.property.owner.name,
              phone: row.property.owner.phone,
            }
          : null
      : row.client
        ? {
            type: 'CLIENT',
            id: row.client.id,
            name: row.client.name,
            phone: row.client.phone,
          }
        : null;
    const latest = row.entries[0];
    const responsibleUser = row.responsibleUserId
      ? (row.responsibleUser ?? null)
      : (row.responsible?.user ?? null);
    return {
      id: row.id,
      kind: row.kind,
      requestType,
      label,
      tabs: tabsOf(
        row.kind,
        requestType,
        row.property?.listingType ?? null,
      ),
      person,
      propertyId: row.property?.id ?? null,
      propertyReference: row.property?.reference ?? null,
      propertyTitle: row.property?.title ?? null,
      area: row.property?.area ?? null,
      clientId: row.client?.id ?? null,
      dueAt: row.nextDueAt.toISOString(),
      bucket: dueBucket(row.nextDueAt, now),
      responsible: responsibleUser
        ? { userId: responsibleUser.id, name: responsibleUser.name }
        : null,
      lastSavedAt: row.lastSavedAt ? row.lastSavedAt.toISOString() : null,
      entryCount: row._count.entries,
      latest: latest
        ? {
            note: latest.note,
            createdAt: latest.createdAt.toISOString(),
            authorName:
              latest.author?.user?.name ?? latest.authorUser?.name ?? null,
          }
        : null,
    };
  }

  /**
   * ONE subject's permanent history, newest first (§6). Employees may only
   * open their OWN responsible subjects; a manager may open any subject in the
   * authorized company — the supervision drawer is strictly READ-ONLY (§5),
   * and the personal drawer only ever serves his own subjects anyway. A forged
   * id answers 404 (§8).
   */
  async achievementsToday(
    viewer: AuthUser,
  ): Promise<{
    count: number;
    distinctSubjects: number;
    entries: Array<{
      id: string;
      subjectId: string;
      subjectLabel: string;
      createdAt: string;
    }>;
  }> {
    await this.ensureSchema();
    if (viewer.role !== Role.EMPLOYEE) {
      // Managers use their own achievement path? Return empty for non-employees.
      return { count: 0, distinctSubjects: 0, entries: [] };
    }
    const authorId = await ensureEmployeeProfile(this.prisma, viewer.id);

    // Business "today" in Kuwait (UTC+3).
    const now = new Date();
    const offsetMin = 3 * 60;
    const kuwaitNow = new Date(now.getTime() + offsetMin * 60 * 1000);
    const y = kuwaitNow.getUTCFullYear();
    const m = kuwaitNow.getUTCMonth();
    const d = kuwaitNow.getUTCDate();
    const startUtcMs =
      Date.UTC(y, m, d, 0, 0, 0, 0) - offsetMin * 60 * 1000;
    const start = new Date(startUtcMs);

    const rows = await this.prisma.followUpEntry.findMany({
      where: { authorId, createdAt: { gte: start } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        subjectId: true,
        createdAt: true,
        subject: {
          select: {
            targetKey: true,
            kind: true,
            property: { select: { reference: true } },
            client: { select: { name: true } },
          },
        },
      },
    });

    const entries = rows.map((row) => {
      const parsed = parseTargetKey(row.subject.targetKey);
      const requestType = parsed?.requestType ?? null;
      const label = subjectLabel({
        kind: row.subject.kind,
        requestType,
        reference: row.subject.property?.reference,
        clientName: row.subject.client?.name,
      });
      return {
        id: row.id,
        subjectId: row.subjectId,
        subjectLabel: label,
        createdAt: row.createdAt.toISOString(),
      };
    });

    const distinct = new Set(entries.map((e) => e.subjectId)).size;
    return {
      count: entries.length,
      distinctSubjects: distinct,
      entries: entries.slice(0, 3),
    };
  }

  async history(
    viewer: AuthUser,
    subjectId: string,
  ): Promise<{
    subject: FollowUpSubjectDto;
    entries: FollowUpEntryDto[];
  }> {
    await this.ensureSchema();
    const now = new Date();
    const scope: Prisma.FollowUpSubjectWhereInput =
      viewer.role === Role.MANAGER
        ? {}
        : { responsible: { userId: viewer.id } };
    const row = await this.prisma.followUpSubject.findFirst({
      where: { id: subjectId, ...scope },
      select: {
        id: true,
        kind: true,
        targetKey: true,
        nextDueAt: true,
        lastSavedAt: true,
        property: {
          select: {
            id: true,
            reference: true,
            title: true,
            area: true,
            listingType: true,
            owner: { select: { id: true, name: true, phone: true } },
            contact: { select: { id: true, name: true, phone: true } },
          },
        },
        client: { select: { id: true, name: true, phone: true } },
        _count: { select: { entries: true } },
        responsible: { select: { user: { select: { id: true, name: true } } } },
        responsibleUser: { select: { id: true, name: true } },
      },
    });
    if (!row) throw new NotFoundException('موضوع المتابعة غير موجود');
    const entries = await this.prisma.followUpEntry.findMany({
      where: { subjectId: row.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
        id: true,
        note: true,
        batchId: true,
        prevDueAt: true,
        nextDueAt: true,
        createdAt: true,
        author: { select: { user: { select: { name: true } } } },
        authorUser: { select: { name: true } },
      },
    });
    return {
      subject: this.toSubjectDto(
        {
          ...row,
          entries: [],
        } as unknown as SubjectRow,
        now,
      ),
      entries: entries.map((entry) => ({
        id: entry.id,
        note: entry.note,
        authorName:
          entry.author?.user?.name ?? entry.authorUser?.name ?? null,
        createdAt: entry.createdAt.toISOString(),
        batchId: entry.batchId,
        prevDueAt: entry.prevDueAt ? entry.prevDueAt.toISOString() : null,
        nextDueAt: entry.nextDueAt ? entry.nextDueAt.toISOString() : null,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Multi-subject save (§5)
  // -------------------------------------------------------------------------

  /**
   * Saves ONE conversation: every submitted subject gets its own permanent
   * entry and ONLY its own due date reset (`server now + interval`); empty
   * notes are rejected by the DTO and never reach the store. The batch is
   * committed atomically, and the `(authorId, batchId, subjectId)` unique
   * turns a double submission into an idempotent replay of the committed
   * rows — zero duplicate history, zero schedule churn.
   */
  async saveBatch(
    viewer: AuthUser,
    dto: SaveFollowUpBatchDto,
  ): Promise<FollowUpBatchResultDto> {
    await this.ensureSchema();
    // The author is the VERIFIED session user, split by role: employees write
    // their owner `EmployeeProfile`, managers are recorded at the USER level
    // (they have no profile and must never be provisioned as employees).
    const isManager = viewer.role === Role.MANAGER;
    const authorId = isManager ? null : await ensureEmployeeProfile(this.prisma, viewer.id);
    const authorUserId = isManager ? viewer.id : null;

    const seen = new Set<string>();
    for (const item of dto.items) {
      if (seen.has(item.subjectId)) {
        throw new BadRequestException(
          'الموضوع نفسه مُقدَّم مرتين في الطلب الواحد.',
        );
      }
      seen.add(item.subjectId);
      if (!item.note.trim()) {
        throw new BadRequestException('ملاحظة المتابعة لا يمكن أن تكون فارغة.');
      }
    }

    // Idempotent replay: this author already committed this exact batch.
    const replayWhere: Prisma.FollowUpEntryWhereInput = isManager
      ? { authorUserId: viewer.id, batchId: dto.batchId }
      : { authorId: authorId ?? undefined, batchId: dto.batchId };
    const prior = await this.prisma.followUpEntry.findMany({
      where: replayWhere,
      select: { id: true, subjectId: true, nextDueAt: true },
    });
    if (prior.length > 0) {
      return {
        replayed: true,
        savedCount: prior.length,
        saved: prior.map((entry) => ({
          subjectId: entry.subjectId,
          entryId: entry.id,
          nextDueAt: entry.nextDueAt ? entry.nextDueAt.toISOString() : '',
        })),
      };
    }

    // Employees save ONLY their own responsible subjects; a manager saves
    // ONLY his OWN manager-owned subjects (§8 — never an employee's notes,
    // never on an employee's behalf).
    const scope: Prisma.FollowUpSubjectWhereInput = isManager
      ? { responsibleUserId: viewer.id }
      : { responsible: { userId: viewer.id } };

    try {
      const saved = await this.prisma.$transaction(async (tx) => {
        const ids = dto.items.map((item) => item.subjectId);
        const subjects = await tx.followUpSubject.findMany({
          where: { id: { in: ids }, active: true, ...scope },
          select: {
            id: true,
            kind: true,
            nextDueAt: true,
            propertyId: true,
            clientId: true,
            interestId: true,
            targetKey: true,
          },
        });
        // Forged/foreign ids and vanished subjects are indistinguishable (§8).
        if (subjects.length !== ids.length) {
          throw new NotFoundException(
            'أحد مواضيع المتابعة غير موجود أو خارج نطاق صلاحيتك.',
          );
        }
        const byId = new Map(subjects.map((subject) => [subject.id, subject]));
        const now = new Date();
        const out: FollowUpBatchResultDto['saved'] = [];
        for (const item of dto.items) {
          const subject = byId.get(item.subjectId);
          if (!subject) continue;
          const kind = subject.kind as SubjectKindName;
          const nextDueAt = addHours(
            now,
            policyFor(kind, this.schedule).intervalHours,
          );
          const entry = await tx.followUpEntry.create({
            data: {
              subjectId: subject.id,
              authorId,
              authorUserId,
              note: item.note.trim(),
              batchId: dto.batchId,
              prevDueAt: subject.nextDueAt,
              nextDueAt,
            },
          });
          // ONLY this subject's schedule moves; every sibling subject of the
          // same person keeps its own due date (§4/§5).
          await tx.followUpSubject.update({
            where: { id: subject.id },
            data: { lastSavedAt: now, nextDueAt, cycle: { increment: 1 } },
          });
          out.push({
            subjectId: subject.id,
            entryId: entry.id,
            nextDueAt: nextDueAt.toISOString(),
          });
        }
        return out;
      });
      // Notifications are generated AFTER the follow-up rows are committed:
      // a notification problem must never roll back a successful save or turn
      // it into a 500. Delivery is idempotent per (userId,eventKey) and only
      // for genuinely new employee entries (never for a manager's own save,
      // never on an idempotent replay).
      await this.notifyManagersOfFollowUps(viewer, saved);
      return { replayed: false, savedCount: saved.length, saved };
    } catch (error) {
      // A concurrent duplicate of the SAME batch hit the
      // `(author, batchId, subjectId)` unique → the first submission won;
      // roll back (already done by the tx) and return its committed result.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.followUpEntry.findMany({
          where: replayWhere,
          select: { id: true, subjectId: true, nextDueAt: true },
        });
        return {
          replayed: true,
          savedCount: winner.length,
          saved: winner.map((entry) => ({
            subjectId: entry.subjectId,
            entryId: entry.id,
            nextDueAt: entry.nextDueAt ? entry.nextDueAt.toISOString() : '',
          })),
        };
      }
      throw error;
    }
  }

  /**
   * Best-effort manager fan-out for COMMITTED employee saves.
   *
   * Runs OUTSIDE the save transaction on purpose: a notification problem (the
   * preference query, a manager lookup, a transient database error while
   * inserting the inbox rows) must never roll back the follow-up nor tell the
   * employee that their note failed. `(userId, eventKey)` is unique and the
   * key is derived from the committed entry id, so retries cannot duplicate a
   * notification for the same entry. The preference is evaluated here, after
   * the save, and defaults to OFF.
   */
  private async notifyManagersOfFollowUps(
    viewer: AuthUser,
    saved: FollowUpBatchResultDto['saved'],
  ): Promise<void> {
    if (isManagement(viewer) || saved.length === 0) return;
    try {
      const [actor, owners, profile, subjects] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: viewer.id },
          select: { name: true },
        }),
        this.prisma.user.findMany({
          where: {
            role: Role.OWNER,
            isActive: true,
            notifyEmployeeFollowUps: true,
          },
          select: { id: true },
        }),
        this.prisma.employeeProfile.findUnique({
          where: { userId: viewer.id },
          select: { managerUserId: true },
        }),
        this.prisma.followUpSubject.findMany({
          where: { id: { in: saved.map((entry) => entry.subjectId) } },
          select: {
            id: true,
            kind: true,
            targetKey: true,
            clientId: true,
            client: { select: { name: true } },
            property: {
              select: {
                reference: true,
                contact: { select: { type: true, name: true } },
              },
            },
          },
        }),
      ]);
      const recipients = new Set(owners.map((owner) => owner.id));
      if (profile?.managerUserId) {
        const manager = await this.prisma.user.findFirst({
          where: {
            id: profile.managerUserId,
            role: Role.MANAGER,
            isActive: true,
            notifyEmployeeFollowUps: true,
          },
          select: { id: true },
        });
        if (manager) recipients.add(manager.id);
      }
      if (!actor || recipients.size === 0) return;

      // The notification names the REAL person/record of each subject from
      // authoritative persisted data (structured target key + related rows).
      const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
      const clientBySubject = new Map(
        subjects.map((subject) => [subject.id, subject.clientId]),
      );
      const bodyOf = (subjectId: string): string => {
        const subject = subjectById.get(subjectId);
        if (!subject) return followUpCreatedBody(actor.name, { kind: 'CLIENT' });
        const parsed = parseTargetKey(subject.targetKey);
        const kind = parsed?.kind ?? subject.kind;
        const info: FollowUpEventSubject = {
          kind,
          requestType: parsed?.requestType ?? null,
          personType: subject.property?.contact?.type ?? null,
          personName:
            kind === 'PROPERTY_OWNER'
              ? (subject.property?.contact?.name ?? null)
              : (subject.client?.name ?? null),
          propertyReference: subject.property?.reference ?? null,
        };
        return followUpCreatedBody(actor.name, info);
      };

      const drafts: NotificationDraft[] = [];
      for (const entry of saved) {
        for (const userId of recipients) {
          drafts.push({
            userId,
            type: 'FOLLOWUP_CREATED',
            title: recordEventTitle('FOLLOWUP_CREATED'),
            body: bodyOf(entry.subjectId),
            propertyId: null,
            clientId: clientBySubject.get(entry.subjectId) ?? null,
            contactId: null,
            // The exact entry id already lives in the eventKey
            // (`FOLLOWUP_CREATED:<entryId>`), which the deep link reads —
            // `followUpId` is the legacy FollowUp table's FK, never entries.
            followUpId: null,
            followUpSubjectId: entry.subjectId,
            eventKey: recordEventKeys.birth('FOLLOWUP_CREATED', entry.entryId),
          });
        }
      }
      if (drafts.length === 0) return;
      await this.prisma.$transaction((tx) =>
        this.notifications.deliverDrafts(tx, drafts),
      );
    } catch (error) {
      this.logger.error(
        `Manager follow-up notifications failed after a committed save (the save itself succeeded): ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Manager supervision (§2–§4) + manual reminders (§6)
  // -------------------------------------------------------------------------

  /** True while the manager-extension migration has NOT been applied yet. */
  private supervisionSchemaReady = false;

  /**
   * The manager extra columns/table arrive with ONE migration that requires
   * explicit owner approval; until it is applied the supervision endpoints
   * answer an HONEST 503 (never a silent fallback, never a dev-database
   * shortcut) while every employee path keeps working unchanged.
   */
  private async ensureSupervisionSchema(): Promise<void> {
    await this.ensureSchema();
    if (this.supervisionSchemaReady) return;
    try {
      await this.prisma.$queryRaw`SELECT "responsibleUserId" FROM "FollowUpSubject" LIMIT 1`;
      await this.prisma.$queryRaw`SELECT 1 FROM "FollowUpReminder" LIMIT 1`;
      this.supervisionSchemaReady = true;
    } catch {
      throw new ServiceUnavailableException(
        'إشراف المدير على المتابعات غير مفعّل بعد: ترقية قاعدة البيانات الخاصة بالمتابعات (20261025090000_manager_followups) بانتظار موافقة الإدارة ولم تُطبَّق بعد.',
      );
    }
  }

  /**
   * The COMPANY-WIDE employee supervision feed (§2–§4): every ACTIVE
   * EMPLOYEE-owned subject (manager-owned subjects belong to «متابعاتي»
   * exclusively — the two sections never mix), ordered OVERDUE (most overdue
   * first) → TODAY → UPCOMING, which is exactly the server's `nextDueAt`
   * ascending order. Enriched with the responsible employee and the latest
   * manual reminder for the cooldown state.
   */
  async listSupervision(
    viewer: AuthUser,
    query: ListSupervisionFollowUpsQueryDto = {},
  ): Promise<FollowUpSupervisionPageDto> {
    await this.ensureSupervisionSchema();
    const now = new Date();
    // Employee-owned rows only: `responsibleId` is set exactly for them.
    // A Manager supervises ONLY their current team; OWNER supervises all.
    const baseWithoutEmployee: Prisma.FollowUpSubjectWhereInput = {
      active: true,
      responsibleId: { not: null },
      ...(isManager(viewer)
        ? { responsible: { managerUserId: viewer.id } }
        : {}),
    };
    const baseScope: Prisma.FollowUpSubjectWhereInput = query.employeeUserId
      ? {
          AND: [
            baseWithoutEmployee,
            { responsible: { userId: query.employeeUserId } },
          ],
        }
      : baseWithoutEmployee;

    const page = await this.queryPage(baseScope, query, now, true);
    const reminders = await this.lastReminderMap(
      page.rows.map((row) => row.id),
    );
    const items = page.rows.map<FollowUpSupervisionSubjectDto>((row) => {
      const subject = this.toSubjectDto(row, now);
      return {
        ...subject,
        // Supervision rows are employee-owned by the filter above, so the
        // responsible user is always resolvable from the owner profile.
        responsible: subject.responsible ?? { userId: '', name: '' },
        lastReminderAt: reminders.get(row.id) ?? null,
      };
    });
    const summary = query.cursor
      ? undefined
      : await this.buildSummary(baseScope, now);
    const employees = query.cursor
      ? undefined
      : await this.supervisionEmployees(baseWithoutEmployee);
    return {
      items,
      nextCursor: page.nextCursor,
      truncated: page.truncated,
      generatedAt: now.toISOString(),
      ...(summary ? { summary } : {}),
      ...(employees ? { employees } : {}),
    };
  }

  /** All responsible employees in the full supervision scope (filter options). */
  private async supervisionEmployees(
    scope: Prisma.FollowUpSubjectWhereInput,
  ): Promise<FollowUpResponsibleDto[]> {
    const rows = await this.prisma.followUpSubject.findMany({
      where: scope,
      select: {
        responsibleId: true,
        responsible: {
          select: {
            userId: true,
            user: { select: { name: true } },
          },
        },
      },
      distinct: ['responsibleId'],
    });
    const employees = new Map<string, string>();
    for (const row of rows) {
      if (row.responsible) {
        employees.set(row.responsible.userId, row.responsible.user.name);
      }
    }
    return [...employees.entries()]
      .map(([userId, name]) => ({ userId, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }

  /** The latest manual reminder instant per subject id. */
  private async lastReminderMap(
    subjectIds: string[],
  ): Promise<Map<string, string>> {
    if (subjectIds.length === 0) return new Map();
    const grouped = await this.prisma.followUpReminder.groupBy({
      by: ['subjectId'],
      where: { subjectId: { in: subjectIds } },
      _max: { sentAt: true },
    });
    const map = new Map<string, string>();
    for (const row of grouped) {
      if (row._max.sentAt)
        map.set(row.subjectId, row._max.sentAt.toISOString());
    }
    return map;
  }

  /**
   * ONE manual manager reminder (§6) to the ACTUAL responsible employee of
   * ONE overdue subject — delivered through the EXISTING notification
   * pipeline (in-app row + Web Push where subscribed).
   *
   * A reminder is NOT a completed follow-up: it never touches the subject's
   * due date, cycle, ownership or history, and it never lets anyone else's
   * voice into the employee's conversation record. Server-side throttling:
   * the reminder row's `eventKey` is ONE cooldown window per subject, unique
   * in the database, so double clicks, retries and concurrent requests can
   * physically never send the reminder twice per window.
   */
  async sendReminder(
    viewer: AuthUser,
    subjectId: string,
  ): Promise<FollowUpReminderResultDto> {
    await this.ensureSupervisionSchema();
    const now = new Date();
    const cooldownMs =
      resolveReminderCooldownHours() * HOUR_MS;

    // Only EMPLOYEE-owned subjects can carry a reminder recipient: a
    // manager-owned subject has no employee to remind and an employee-owned
    // subject never answers a manager save path (§8).
    const subject = await this.prisma.followUpSubject.findFirst({
      where: { id: subjectId, active: true, responsibleId: { not: null } },
      select: {
        id: true,
        targetKey: true,
        kind: true,
        nextDueAt: true,
        responsible: {
          select: {
            managerUserId: true,
            user: { select: { id: true, name: true, isActive: true } },
          },
        },
        property: {
          select: {
            id: true,
            reference: true,
            owner: { select: { name: true } },
            contact: { select: { name: true } },
          },
        },
        client: { select: { id: true, name: true } },
      },
    });
    if (
      !subject ||
      !subject.responsible?.user ||
      (isManager(viewer) &&
        subject.responsible.managerUserId !== viewer.id)
    ) {
      // Forged/foreign/cross-team ids and manager-owned subjects are
      // indistinguishable: always 404.
      throw new NotFoundException(
        'موضوع المتابعة غير موجود أو ليس متابعة موظف.',
      );
    }
    const recipient = subject.responsible.user;
    if (!recipient.isActive) {
      throw new BadRequestException(
        'حساب الموظف المسؤول غير مفعّل — لا يمكن إرسال تذكير إليه.',
      );
    }
    // A reminder is ONLY for an actually OVERDUE subject (Kuwait calendar
    // day, same bucket definition as every other path) — never for TODAY or
    // UPCOMING subjects (§6).
    if (dueBucket(subject.nextDueAt, now) !== 'OVERDUE') {
      throw new BadRequestException(
        'المتابعة ليست متأخرة بعد — لا يُرسل التذكير قبل استحقاقها بفعل.',
      );
    }

    // The notification copy: subject identity + the REAL overdue duration.
    // The recipient is the subject's responsible employee — the one person
    // authorized for this subject — so the wording is not a side channel.
    const parsed = parseTargetKey(subject.targetKey);
    const subjectIdentity =
      subject.kind === 'PROPERTY_OWNER' && subject.property?.reference
        ? subjectLabel({
            kind: 'PROPERTY_OWNER',
            requestType: null,
            reference: subject.property.reference,
            clientName: null,
          })
        : subjectLabel({
            kind: subject.kind as SubjectKindName,
            requestType: parsed?.requestType ?? null,
            reference: null,
            clientName: subject.client?.name,
          });
    const personName =
      subject.property?.contact?.name ?? subject.property?.owner?.name ?? null;
    const hint =
      subject.kind === 'PROPERTY_OWNER' && personName
        ? `${subjectIdentity} (${personName})`
        : subjectIdentity;
    const overdueHours = Math.max(
      0,
      Math.floor((now.getTime() - subject.nextDueAt.getTime()) / HOUR_MS),
    );
    const overdueDuration = formatLateDuration(overdueHours);
    // The reminding manager's DISPLAY name comes from the verified session's
    // user row — never from a client claim.
    const sender = await this.prisma.user.findUnique({
      where: { id: viewer.id },
      select: { name: true },
    });
    const eventKey = followUpReminderEventKey(
      subject.id,
      Math.floor(now.getTime() / cooldownMs),
    );
    const cooldownUntil = new Date(
      (Math.floor(now.getTime() / cooldownMs) + 1) * cooldownMs,
    );

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // The DB-guaranteed dedup gate: a second window-colliding insert
        // throws P2002 and nothing at all is written by the losing request.
        const reminder = await tx.followUpReminder.create({
          data: {
            subjectId: subject.id,
            senderUserId: viewer.id,
            recipientUserId: recipient.id,
            eventKey,
          },
        });
        await this.notifications.deliverFollowUpDrafts(tx, [
          {
            userId: recipient.id,
            type: 'FOLLOWUP_EMPLOYEE_REMINDER',
            title: FOLLOWUP_REMINDER_TITLE,
            body: followUpReminderBody({
              managerName: sender?.name ?? '',
              hint,
              overdueDuration,
            }),
            propertyId: subject.property?.id ?? null,
            clientId: subject.client?.id ?? null,
            followUpSubjectId: subject.id,
            eventKey,
          },
        ]);
        return reminder;
      });
      return {
        subjectId: subject.id,
        recipientUserId: recipient.id,
        recipientName: recipient.name,
        sentAt: created.sentAt.toISOString(),
        cooldownUntil: cooldownUntil.toISOString(),
        replayed: false,
      };
    } catch (error) {
      // A concurrent request inside the SAME window already sent the
      // reminder: return its committed row — one notification, zero spam.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.followUpReminder.findUnique({
          where: { eventKey },
        });
        if (winner) {
          return {
            subjectId: subject.id,
            recipientUserId: recipient.id,
            recipientName: recipient.name,
            sentAt: winner.sentAt.toISOString(),
            cooldownUntil: cooldownUntil.toISOString(),
            replayed: true,
          };
        }
      }
      throw error;
    }
  }
}
