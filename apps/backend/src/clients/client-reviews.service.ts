import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientReviewKind, ApprovalStatus, Prisma, PropertyStatus } from '@prisma/client';
import { Role, type AuthUser } from '@arkan/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { propertyVisibilityWhere } from '../properties/property-visibility';
import { clientOwnershipWhere, ensureEmployeeProfile } from './client-policy';
import { isManagement } from '../common/access/access-policy';

/** OWNER all reviews; MANAGER their team's submissions; EMPLOYEE own. */
function reviewScopeWhere(
  viewer: AuthUser,
): Prisma.ClientReviewRequestWhereInput {
  if (viewer.role === Role.OWNER) return {};
  if (viewer.role === Role.MANAGER)
    return {
      requestedBy: { employee: { managerUserId: viewer.id } },
    };
  return { requestedById: viewer.id };
}
import { clientRequestChangeSummary } from './client-request-data';
import type { UpdateClientDto } from './dto/update-client.dto';
import {
  asJson,
  buildClientReviewBase,
  decodeClientReviewPayload,
  normalizeClientReviewPayload,
  sameBase,
  sameJsonDocument,
  type ClientReviewBaseV1,
  type ClientReviewInterestV1,
  type ClientReviewPayloadV1,
} from './client-review-payload';
import { SubmitClientReviewDto } from './dto/create-client-review.dto';
import type {
  ClientReviewCountDto,
  ClientReviewDetailDto,
  ClientReviewInterestDto,
  ClientReviewListDto,
  ClientReviewSummaryDto,
} from './client-review.dto';

/** The review row with exactly the relations the DTO answers read. */
type ReviewRow = Prisma.ClientReviewRequestGetPayload<{
  include: { requestedBy: { select: { id: true; name: true } } };
}>;

/** How many list rows one answer carries (cards only — details are per-id). */
const REVIEW_LIST_LIMIT = 100;

type ReviewDecision = 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';

/**
 * The staged client-change workflow: employees submit proposed creations and
 * edits through `ClientReviewRequest` rows and ONLY a manager decision –
 * approved atomically inside one transaction – materializes anything into
 * the approved `Client`. Every payload column is stored opaquely and decoded
 * ONLY here, so a legacy/unexpected document degrades safely.
 */
@Injectable()
export class ClientReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Submission (employees only — managers keep writing directly, no review)
  // ---------------------------------------------------------------------------

  /**
   * `POST /client-reviews` — stage a proposed CREATION or EDIT for manager
   * approval. NOTHING here writes an approved client: a pending creation
   * never enters a client list/search/statistic, and a pending edit never
   * touches the approved row.
   */
  async submit(
    viewer: AuthUser,
    dto: SubmitClientReviewDto,
  ): Promise<ClientReviewSummaryDto> {
    if (viewer.role !== Role.EMPLOYEE)
      throw new ForbiddenException(
        'إضافات المدير تعتمد مباشرة — احفظ العميل من الأدوات الاعتيادية بدون مراجعة.',
      );
    const normalized = this.normalizeProposal(dto);

    // Idempotency is REQUESTER-scoped (the DB partial index carries the same
    // scope): a repeated accidental submission resolves to THE requester's own
    // review; another employee's equal key can never collide with it.
    if (dto.idempotencyKey) {
      const existing = await this.prisma.clientReviewRequest.findFirst({
        where: {
          requestedById: viewer.id,
          idempotencyKey: dto.idempotencyKey,
        },
        include: { requestedBy: { select: { id: true, name: true } } },
      });
      if (existing) {
        // The same key pointing at DIFFERENT content is a conflict, not a
        // duplicate: a genuinely new proposal needs a new session key.
        this.assertSameIntent(existing, dto, normalized);
        return this.toSummary(existing, await this.clientNameOf(existing));
      }
    }

    // At most ONE ACTIVE review per client (kind=EDIT, PENDING or
    // CHANGES_REQUESTED). An own active review continues only through the
    // explicit resubmit path; another requester's active review blocks the
    // new one without disclosing whose it is.
    if (
      dto.kind === 'EDIT' &&
      (await this.activeEditReviewExists(viewer, dto.clientId!))
    )
      throw new ConflictException(
        'هناك طلب مراجعة نشط لهذا العميل. أعد إرسال طلبك الموجود من تبويب «تحت المراجعة» بدل إنشاء طلب جديد.',
      );

    // The proposed interests are validated at submit AND again at approval,
    // so an approval can never write an unavailable/invisible link.
    for (const interest of normalized.addInterests)
      await this.assertInterestValid(viewer, interest.propertyId);

    const created = await this.prisma.$transaction(async (tx) => {
      let base: ClientReviewBaseV1 | null = null;
      if (normalized.kind === 'EDIT') {
        // The approved state this proposal was built on top of — compared
        // again at approval (stale → safe 409, never a silent rebase).
        base = await this.snapshotApprovedState(tx, viewer, dto.clientId!);
      }

      const review = await tx.clientReviewRequest.create({
        data: {
          kind: normalized.kind,
          clientId: normalized.kind === 'EDIT' ? dto.clientId! : null,
          status: ApprovalStatus.PENDING,
          payload: asJson(normalized),
          base: base ? asJson(base) : Prisma.DbNull,
          idempotencyKey: dto.idempotencyKey ?? null,
          requestedById: viewer.id,
        },
        include: { requestedBy: { select: { id: true, name: true } } },
      });

      await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action: 'CLIENT_REVIEW_SUBMIT',
          entityType: 'ClientReviewRequest',
          entityId: review.id,
          after: {
            kind: normalized.kind,
            ...(normalized.kind === 'EDIT' ? { clientId: dto.clientId! } : {}),
          },
        },
      });

      await this.notifications.notifyClientReviewSubmitted(
        tx,
        viewer,
        'CLIENT_REVIEW_SUBMITTED',
        review.id,
        normalized.kind,
      );
      return review;
    });

    return this.toSummary(created, await this.clientNameOf(created));
  }

  /**
   * `PATCH /client-reviews/:id` — an EXPLICIT refreshed proposal on the
   * requester's OWN review, in exactly two open states:
   *   - `CHANGES_REQUESTED`: the manager asked for corrections — the requester
   *     re-snapshots the proposal on the CURRENT approved state and it goes
   *     back to PENDING with ONE `resubmitted` notification to the managers.
   *   - `PENDING`: the review awaiting a decision that turned out STALE (the
   *     stale approval rolled back to PENDING) — the EXPLICIT refresh path
   *     that rebuilds the proposal/baseline on the current row WITHOUT
   *     notifying again (the review already awaits the same decision; a
   *     genuinely new awaiting-clean review is refused so «إعادة إرسال»
   *     clicks and network retries can never spam a Manager).
   * An `APPROVED`/`REJECTED` row is closed: a safe 409 with NO database
   * change, NO audit row and NO notification — a decided review can never be
   * revived.
   *
   * The transition is claimed with a conditional update INSIDE the
   * transaction (the same recipe as `decide`): exactly ONE concurrent request
   * wins; every duplicate/concurrent loser 409s here BEFORE any write, audit
   * event or notification. Nothing else (not approval, not a parallel change)
   * rebases a review silently.
   */
  async resubmit(
    viewer: AuthUser,
    id: string,
    dto: SubmitClientReviewDto,
  ): Promise<ClientReviewSummaryDto> {
    const review = await this.findOwnedOr404(viewer, id);
    const wasPending = review.status === ApprovalStatus.PENDING;
    if (!wasPending && review.status !== ApprovalStatus.CHANGES_REQUESTED)
      throw new ConflictException(
        'طلب مراجعة مغلق — لا يمكن إعادة إرساله. أنشئ طلبًا جديدًا إن لزم.',
      );
    const normalized = this.normalizeProposal(dto);
    if (normalized.kind !== review.kind)
      throw new BadRequestException('نوع الطلب المرسل لا يطابق نوع المراجعة.');
    if (
      normalized.kind === 'EDIT' &&
      review.clientId &&
      dto.clientId !== review.clientId
    )
      throw new BadRequestException('المراجعة مرتبطة بعميل آخر.');

    for (const interest of normalized.addInterests)
      await this.assertInterestValid(viewer, interest.propertyId);

    const updated = await this.prisma.$transaction(
      async (tx) => {
        // The current row inside the transaction, for the identical-refresh
        // short-circuit AND the atomic claim below.
        const current = await tx.clientReviewRequest.findUniqueOrThrow({
          where: { id },
          include: { requestedBy: { select: { id: true, name: true } } },
        });

        // The only place a review's `base` ever moves: the requester
        // consciously rebuilds the proposal on top of the CURRENT approved
        // state (reflected by the transaction's own snapshot).
        let base: ClientReviewBaseV1 | null = null;
        if (normalized.kind === 'EDIT') {
          base = await this.snapshotApprovedState(
            tx,
            viewer,
            review.clientId!,
          );
        }

        // A PENDING refresh that changes NOTHING (identical payload and
        // baseline) is a no-op success: no write, no audit row — so «إعادة
        // إرسال» double clicks and network retries stay side-effect free for
        // an already-awaiting review.
        if (wasPending) {
          const stored = decodeClientReviewPayload(current.payload);
          const samePayload = stored !== null && sameJsonDocument(stored, normalized);
          const baselineUnchanged = base === null || sameBase(current.base as unknown, base);
          if (samePayload && baselineUnchanged) return current;
        }

        // The atomic claim: exactly ONE concurrent correction wins; every
        // duplicate/concurrent loser 409s here BEFORE any write, audit row
        // or notification.
        const claimed = await tx.clientReviewRequest.updateMany({
          where: {
            id,
            status: { in: [ApprovalStatus.PENDING, ApprovalStatus.CHANGES_REQUESTED] },
          },
          data: {
            status: ApprovalStatus.PENDING,
            reviewedById: null,
            reviewNotes: null,
            reviewedAt: null,
          },
        });
        if (claimed.count === 0) {
          const row = await tx.clientReviewRequest.findUnique({
            where: { id },
            select: { status: true },
          });
          if (!row)
            throw new NotFoundException('طلب المراجعة غير موجود.');
          throw new ConflictException(
            'سُجّل قرار على هذا الطلب أثناء إعادة الإرسال — أعد فتح الطلب من القائمة.',
          );
        }

        const row = await tx.clientReviewRequest.update({
          where: { id },
          data: {
            payload: asJson(normalized),
            ...(base ? { base: asJson(base) } : {}),
          },
          include: { requestedBy: { select: { id: true, name: true } } },
        });

        await tx.auditLog.create({
          data: {
            actorId: viewer.id,
            action: 'CLIENT_REVIEW_RESUBMIT',
            entityType: 'ClientReviewRequest',
            entityId: review.id,
            after: { status: ApprovalStatus.PENDING },
          },
        });

        // A STILL-PENDING refresh never notifies again: the SAME review
        // already awaits the SAME manager decision — the «resubmitted» event
        // exists only for the corrections round (CHANGES_REQUESTED).
        if (!wasPending) {
          await this.notifications.notifyClientReviewSubmitted(
            tx,
            viewer,
            'CLIENT_REVIEW_RESUBMITTED',
            review.id,
            normalized.kind,
          );
        }
        return row;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.toSummary(updated, await this.clientNameOf(updated));
  }

  // ---------------------------------------------------------------------------
  // Reading (manager: everything — employee: own rows only, 404 otherwise)
  // ---------------------------------------------------------------------------

  /** `GET /client-reviews` — scoped cards, newest first. */
  async list(viewer: AuthUser): Promise<ClientReviewListDto> {
    const rows = await this.prisma.clientReviewRequest.findMany({
      where: reviewScopeWhere(viewer),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: REVIEW_LIST_LIMIT,
      include: { requestedBy: { select: { id: true, name: true } } },
    });
    const editIds = [
      ...new Set(
        rows
          .filter((row) => row.kind === ClientReviewKind.EDIT && row.clientId)
          .map((row) => row.clientId!),
      ),
    ];
    const names = new Map<string, string>();
    if (editIds.length) {
      const clients = await this.prisma.client.findMany({
        where: { id: { in: editIds } },
        select: { id: true, name: true },
      });
      for (const client of clients) names.set(client.id, client.name);
    }
    return {
      items: rows.map((row) =>
        this.toSummary(
          row,
          row.kind === ClientReviewKind.EDIT
            ? (names.get(row.clientId ?? '') ?? 'عميل محذوف')
            : null,
        ),
      ),
    };
  }

  /**
   * `GET /client-reviews/count` — the «تحت المراجعة» badge: ONLY the rows
   * awaiting a Manager decision (`PENDING`; CHANGES_REQUESTED awaits the
   * requester, decided rows are history). An exact `count` query, never the
   * length of any list window. Row-level scoping set INSIDE the query, the
   * same contract as `list`: a manager counts the whole company, an employee
   * ONLY their own submissions (another employee's rows are never counted)
   * — privacy is enforced here, not by any frontend filter.
   */
  async countPending(viewer: AuthUser): Promise<ClientReviewCountDto> {
    const pending = await this.prisma.clientReviewRequest.count({
      where: {
        status: ApprovalStatus.PENDING,
        ...reviewScopeWhere(viewer),
      },
    });
    return { pending };
  }

  /**
   * `GET /client-reviews/:id` — the full proposal, the EDIT's current approved
   * state, and the privacy-safe diff. Requester or manager; 404 otherwise.
   */
  async findOne(viewer: AuthUser, id: string): Promise<ClientReviewDetailDto> {
    const review = await this.findOwnedOr404(viewer, id);
    const payload = this.decode(review.payload, review.id);
    const addInterests = await this.resolveInterestRefs(payload.addInterests);
    const removeInterests = this.removalRefs(review, payload, addInterests);

    let current: ClientReviewDetailDto['current'] = null;
    if (review.kind === ClientReviewKind.EDIT && review.clientId) {
      const approved = await this.prisma.client.findFirst({
        where: { id: review.clientId, ...clientOwnershipWhere(viewer) },
        select: {
          name: true,
          phone: true,
          notes: true,
          requestData: true,
        },
      });
      if (approved) {
        current = {
          name: approved.name,
          phone: approved.phone,
          notes: approved.notes,
          requestData: approved.requestData,
          interests: await this.currentInterestRefs(review.clientId),
        };
      }
    }

    return {
      id: review.id,
      kind: review.kind,
      status: review.status,
      clientId: review.clientId,
      createdAt: review.createdAt.toISOString(),
      reviewedAt: review.reviewedAt?.toISOString() ?? null,
      reviewNotes: review.reviewNotes,
      requesterId: review.requestedBy.id,
      requesterName: review.requestedBy.name,
      submissionNote: payload.submissionNote ?? null,
      proposed: {
        name: payload.client.name,
        phone: payload.client.phone,
        notes: payload.client.notes,
        requestData: payload.requestData,
        addInterests,
        removeInterests,
      },
      current,
      diff: this.reviewDiff(review, payload, addInterests, removeInterests),
    };
  }

  // ---------------------------------------------------------------------------
  // Manager decisions
  // ---------------------------------------------------------------------------

  /**
   * `POST /client-reviews/:id/approve|reject|request-changes` — MANAGER only.
   *
   * The decision claims the row with a conditional update INSIDE the
   * transaction (a second concurrent/stale decision answers 409), and an
   * EDIT approval re-compares the stored submission baseline against a fresh
   * read in the SAME transaction: a moved client throws BEFORE any write, so
   * even the status claim rolls back — the review stays open and the
   * requester must explicitly refresh the proposal.
   */
  async decide(
    viewer: AuthUser,
    id: string,
    action: ReviewDecision,
    reviewNotes: string | null,
  ): Promise<ClientReviewSummaryDto> {
    if (!isManagement(viewer))
      throw new ForbiddenException(
        'This decision is reserved for the OWNER or a Manager',
      );
    // Team scope: a Manager can only decide a review submitted by one of their
    // currently assigned employees. OWNER can decide every review.
    await this.findOwnedOr404(viewer, id);
    const decided = await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.clientReviewRequest.updateMany({
          where: { id, status: ApprovalStatus.PENDING },
          data: {
            status: action,
            reviewedById: viewer.id,
            reviewNotes: reviewNotes?.trim() || null,
            reviewedAt: new Date(),
          },
        });
        if (claimed.count === 0) {
          const row = await tx.clientReviewRequest.findUnique({
            where: { id },
            select: { status: true },
          });
          if (!row)
            throw new NotFoundException('طلب المراجعة غير موجود.');
          throw new ConflictException(
            'سُجّل قرار على هذا الطلب (أو أُعيد إرساله أثناء قرارك) — أعد فتح الطلب من القائمة.',
          );
        }

        const review = await tx.clientReviewRequest.findUniqueOrThrow({
          where: { id },
          include: { requestedBy: { select: { id: true, name: true } } },
        });
        const payload = this.decode(review.payload, review.id);

        let clientId: string | null = review.clientId;
        if (action === 'APPROVED') {
          if (review.kind === ClientReviewKind.CREATION) {
            const created = await this.applyCreation(
              tx,
              review.requestedById,
              payload,
              viewer,
            );
            clientId = created.id;
            await tx.clientReviewRequest.update({
              where: { id: review.id },
              data: { clientId: created.id },
            });
          } else if (review.clientId) {
            // THE stale gate: throws before ANY write on a mismatch, so even
            // the claim above rolls back and the review stays open.
            await this.assertFreshBase(tx, review);
            await this.applyEdit(tx, payload, review.clientId, viewer);
            clientId = review.clientId;
          }
          await tx.auditLog.create({
            data: {
              actorId: viewer.id,
              action: 'CLIENT_REVIEW_APPLY',
              entityType: 'ClientReviewRequest',
              entityId: review.id,
              after: { decision: action, clientId },
            },
          });
        } else {
          await tx.auditLog.create({
            data: {
              actorId: viewer.id,
              action: `CLIENT_REVIEW_${action}`,
              entityType: 'ClientReviewRequest',
              entityId: review.id,
              after: { reviewNotes: reviewNotes?.trim() || null },
            },
          });
        }

        await this.notifications.notifyClientReviewDecision(
          tx,
          review.requestedById,
          review.id,
          action,
          review.kind,
          clientId,
        );

        const row = await tx.clientReviewRequest.findUniqueOrThrow({
          where: { id: review.id },
          include: { requestedBy: { select: { id: true, name: true } } },
        });
        return row;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.toSummary(decided, await this.clientNameOf(decided));
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Validates the wire shape and packs the stored proposal document. */
  private normalizeProposal(
    dto: SubmitClientReviewDto,
  ): ClientReviewPayloadV1 {
    if (dto.kind === 'EDIT' && !dto.clientId)
      throw new BadRequestException('حدّد العميل المطلوب تعديله.');
    if (dto.kind === 'CREATION' && dto.clientId)
      throw new BadRequestException('طلب إضافة العميل لا يرتبط بعميل حالي.');
    const interests: ClientReviewInterestV1[] = (dto.addInterests ?? []).map(
      (row) => ({
        propertyId: row.propertyId,
        reason: row.reason ?? null,
        notes: row.notes ?? null,
      }),
    );
    return this.buildNormalizedPayload({
      kind: dto.kind,
      name: dto.name,
      phone: dto.phone,
      notes: dto.notes ?? null,
      requestData: dto.requestData ?? null,
      addInterests: interests,
      removeInterests: dto.kind === 'EDIT' ? (dto.removeInterests ?? []) : [],
      submissionNote: dto.submissionNote ?? null,
    });
  }

  /** Normalizes and validates the wire proposal into the stored document. */
  private buildNormalizedPayload(
    input: {
      kind: 'CREATION' | 'EDIT';
      name: string;
      phone: string;
      notes: string | null;
      requestData: string | null;
      addInterests: ClientReviewInterestV1[];
      removeInterests: string[];
      submissionNote: string | null;
    },
  ): ClientReviewPayloadV1 {
    const normalized = normalizeClientReviewPayload(input);
    if ('error' in normalized)
      throw new BadRequestException(normalized.error);
    return normalized;
  }

  /**
   * The repeated idempotency key must refer to the SAME intent: same kind,
   * same target client, same proposal content. Anything else is a genuinely
   * different request and answers 409 (never silently adopted).
   */
  private assertSameIntent(
    existing: ReviewRow,
    dto: SubmitClientReviewDto,
    normalized: ClientReviewPayloadV1,
  ): void {
    const stored = decodeClientReviewPayload(existing.payload);
    const sameTarget =
      existing.kind === dto.kind &&
      (dto.kind === 'CREATION' || existing.clientId === dto.clientId);
    if (!sameTarget || !stored)
      throw new ConflictException(
        'مفتاح الإرسال مستخدم لطلب مراجعة مختلف؛ أنشئ طلبًا جديدًا.',
      );
    const cleaned = (row: ClientReviewPayloadV1) => {
      const copy = { ...row };
      delete copy.submissionNote;
      return copy;
    };
    if (!sameJsonDocument(cleaned(stored), cleaned(normalized)))
      throw new ConflictException(
        'مفتاح الإرسال مستخدم لبيانات مختلفة؛ أرسل طلبًا جديدًا بمفتاح جديد.',
      );
  }

  /** Whether an ACTIVE EDIT review exists for this client (any requester). */
  private async activeEditReviewExists(
    _viewer: AuthUser,
    clientId: string,
  ): Promise<boolean> {
    const row = await this.prisma.clientReviewRequest.findFirst({
      where: {
        kind: ClientReviewKind.EDIT,
        clientId,
        status: {
          in: [ApprovalStatus.PENDING, ApprovalStatus.CHANGES_REQUESTED],
        },
      },
      select: { id: true },
    });
    return row !== null;
  }

  private async assertInterestValid(
    viewer: AuthUser,
    propertyId: string,
  ): Promise<void> {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, ...propertyVisibilityWhere(viewer) },
      select: { id: true, status: true },
    });
    if (!property)
      throw new NotFoundException(
        'العقار المطلوب غير موجود أو غير مصرح لك بالوصول إليه.',
      );
    if (property.status !== PropertyStatus.AVAILABLE)
      throw new BadRequestException(
        'لا يمكن ربط استفسار العميل إلا بعقار متاح بالبرنامج.',
      );
  }

  private async readAuthorizedClient(
    tx: Prisma.TransactionClient,
    viewer: AuthUser,
    id: string,
  ) {
    const client = await tx.client.findFirst({
      where: { id, ...clientOwnershipWhere(viewer) },
      select: {
        id: true,
        name: true,
        phone: true,
        notes: true,
        requestData: true,
        updatedAt: true,
      },
    });
    if (!client) throw new NotFoundException('Client not found');
    return client;
  }

  /** The comparable approved-state snapshot for an EDIT submission. */
  private async snapshotApprovedState(
    tx: Prisma.TransactionClient,
    viewer: AuthUser,
    clientId: string,
  ): Promise<ClientReviewBaseV1> {
    const client = await this.readAuthorizedClient(tx, viewer, clientId);
    return buildClientReviewBase({
      name: client.name,
      phone: client.phone,
      notes: client.notes,
      requestData: client.requestData,
      updatedAt: client.updatedAt,
      interests: await tx.clientPropertyInterest.findMany({
        where: { clientId: client.id },
        select: { propertyId: true, reason: true, notes: true },
      }),
    });
  }

  private async findOwnedOr404(
    viewer: AuthUser,
    id: string,
  ): Promise<ReviewRow> {
    const row = await this.prisma.clientReviewRequest.findFirst({
      where: { id, ...reviewScopeWhere(viewer) },
      include: { requestedBy: { select: { id: true, name: true } } },
    });
    if (!row) throw new NotFoundException('طلب المراجعة غير موجود.');
    return row;
  }

  /**
   * THE stale gate for EDIT approvals: compares the stored snapshot with a
   * fresh read INSIDE the same transaction. A mismatch throws → the whole
   * transaction (claim included) rolls back. Never a silent rebase.
   */
  private async assertFreshBase(
    tx: Prisma.TransactionClient,
    review: ReviewRow,
  ): Promise<void> {
    if (!review.clientId) return;
    const rawBase = review.base as unknown;
    if (!rawBase)
      throw new ConflictException(
        'طلب المراجعة بلا خط أساس محفوظ؛ اطلب من الموظف إعادة الإرسال.',
      );
    const fresh = await tx.client.findUniqueOrThrow({
      where: { id: review.clientId },
      select: {
        name: true,
        phone: true,
        notes: true,
        requestData: true,
        updatedAt: true,
      },
    });
    const freshBase = buildClientReviewBase({
      name: fresh.name,
      phone: fresh.phone,
      notes: fresh.notes,
      requestData: fresh.requestData,
      updatedAt: fresh.updatedAt,
      interests: await tx.clientPropertyInterest.findMany({
        where: { clientId: review.clientId },
        select: { propertyId: true, reason: true, notes: true },
      }),
    });
    if (!sameBase(rawBase, freshBase))
      throw new ConflictException(
        'تغيّرت بيانات العميل الموثوق أثناء المراجعة. اطلب من الموظف تحديث الطلب وإعادة إرساله.',
      );
  }

  /**
   * APPROVED CREATION: materializes the client with the REQUESTING employee
   * as its creator AND responsible employee — the exact ownership rules the
   * previously-direct employee path used (stable `EmployeeProfile`, created
   * on demand), so the approved client is immediately visible to its requester.
   */
  private async applyCreation(
    tx: Prisma.TransactionClient,
    requesterId: string,
    payload: ClientReviewPayloadV1,
    viewer: AuthUser,
  ) {
    const profileId = await ensureEmployeeProfile(tx, requesterId);
    const created = await tx.client.create({
      data: {
        name: payload.client.name,
        phone: payload.client.phone,
        notes: payload.client.notes,
        requestData: payload.requestData,
        createdById: profileId,
        responsibleEmployeeId: profileId,
      },
    });
    await this.writeInterests(tx, created.id, payload, viewer);
    return created;
  }

  /** APPROVED EDIT: writes the proposed columns and link changes ONLY. */
  private async applyEdit(
    tx: Prisma.TransactionClient,
    payload: ClientReviewPayloadV1,
    clientId: string,
    viewer: AuthUser,
  ) {
    await tx.client.update({
      where: { id: clientId },
      data: {
        name: payload.client.name,
        phone: payload.client.phone,
        notes: payload.client.notes,
        requestData: payload.requestData,
      },
    });
    await this.writeInterests(tx, clientId, payload, viewer);
  }

  /**
   * The interest write of both approval kinds: EVERY property is re-read at
   * approval time (existence and availability re-checked, visibility
   * resolved through the acting manager whose scope covers every program
   * property), so a link that broke after submission answers 400 with the
   * decision rolled back — never a half-approved client.
   */
  private async writeInterests(
    tx: Prisma.TransactionClient,
    clientId: string,
    payload: ClientReviewPayloadV1,
    viewer: AuthUser,
  ): Promise<void> {
    for (const interest of payload.addInterests) {
      const property = await tx.property.findFirst({
        where: { id: interest.propertyId, ...propertyVisibilityWhere(viewer) },
        select: { id: true, status: true },
      });
      if (!property || property.status !== PropertyStatus.AVAILABLE)
        throw new BadRequestException(
          'العقار المطلوب لم يعد متاحًا لإقرار الطلب.',
        );
      await tx.clientPropertyInterest.upsert({
        where: {
          clientId_propertyId: { clientId, propertyId: interest.propertyId },
        },
        create: {
          clientId,
          propertyId: interest.propertyId,
          reason: interest.reason,
          notes: interest.notes,
        },
        update: { reason: interest.reason, notes: interest.notes },
      });
    }
    if (payload.removeInterests.length) {
      await tx.clientPropertyInterest.deleteMany({
        where: { clientId, propertyId: { in: payload.removeInterests } },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // DTO helpers
  // ---------------------------------------------------------------------------

  private decode(payload: unknown, reviewId: string): ClientReviewPayloadV1 {
    const decoded = decodeClientReviewPayload(payload);
    if (!decoded)
      throw new BadRequestException(
        `بيانات طلب المراجعة غير قابلة للقراءة (الطلب ${reviewId}).`,
      );
    return decoded;
  }

  private async clientNameOf(row: ReviewRow): Promise<string | null> {
    if (row.kind !== ClientReviewKind.EDIT || !row.clientId) return null;
    const client = await this.prisma.client.findUnique({
      where: { id: row.clientId },
      select: { name: true },
    });
    return client?.name ?? 'عميل محذوف';
  }

  private async currentInterestRefs(clientId: string): Promise<ClientReviewInterestDto[]> {
    const rows = await this.prisma.clientPropertyInterest.findMany({
      where: { clientId },
      include: {
        property: {
          select: {
            id: true,
            reference: true,
            approvedReference: true,
            title: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      propertyId: row.propertyId,
      reference: row.property.approvedReference ?? row.property.reference,
      title: row.property.title,
      reason: row.reason,
      notes: row.notes,
    }));
  }

  private async resolveInterestRefs(
    interests: ClientReviewInterestV1[],
  ): Promise<ClientReviewInterestDto[]> {
    if (!interests.length) return [];
    const rows = await this.prisma.property.findMany({
      where: { id: { in: interests.map((row) => row.propertyId) } },
      select: {
        id: true,
        reference: true,
        approvedReference: true,
        title: true,
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return interests.map((interest) => ({
      propertyId: interest.propertyId,
      reference:
        byId.get(interest.propertyId)?.approvedReference ??
        byId.get(interest.propertyId)?.reference ??
        null,
      title: byId.get(interest.propertyId)?.title ?? null,
      reason: interest.reason,
      notes: interest.notes,
    }));
  }

  /** The removed links rendered with the CURRENT reference/title when kept. */
  private removalRefs(
    review: ReviewRow,
    payload: ClientReviewPayloadV1,
    addInterests: ClientReviewInterestDto[],
  ): ClientReviewInterestDto[] {
    if (payload.removeInterests.length === 0) return [];
    const byId = new Map(
      addInterests.map((ref) => [ref.propertyId, ref] as const),
    );
    return payload.removeInterests.map((propertyId) => ({
      propertyId,
      reference: byId.get(propertyId)?.reference ?? null,
      title: byId.get(propertyId)?.title ?? null,
      reason: null,
      notes: null,
    }));
  }

  /**
   * Privacy-consistent Arabic diff: typed old → new for the safe identity
   * fields; fact-only wording for the phone/notes; the STRUCTURED request
   * diff reused verbatim from the client service (`clientRequestChangeSummary`);
   * interest changes named ONLY by the property code (a public listing fact).
   */
  private reviewDiff(
    review: ReviewRow,
    payload: ClientReviewPayloadV1,
    addInterests: ClientReviewInterestDto[],
    removeInterests: ClientReviewInterestDto[],
  ): string[] {
    const interestItems: string[] = [];
    for (const interest of addInterests)
      interestItems.push(
        `أُضيف استفسار لعقار ${interest.reference ?? '(بلا ترميز)'}`,
      );
    for (const interest of removeInterests)
      interestItems.push(
        `أُزيل استفسار العقار ${interest.reference ?? '(بلا ترميز)'}`,
      );

    if (review.kind === ClientReviewKind.CREATION)
      return ['طلب إضافة عميل جديد', ...interestItems];
    return this.editDiff(review, payload, interestItems);
  }

  /** The EDIT diff — the manager's exact differences from the approved row. */
  private editDiff(
    review: ReviewRow,
    payload: ClientReviewPayloadV1,
    interestItems: string[],
  ): string[] {
    const base = review.base as unknown;
    const items: string[] = [];
    if (
      base &&
      typeof base === 'object' &&
      !Array.isArray(base) &&
      (base as ClientReviewBaseV1).version === 1
    ) {
      const snapshot = base as ClientReviewBaseV1;
      if (snapshot.name !== payload.client.name)
        items.push(`الاسم: من ${snapshot.name} إلى ${payload.client.name}`);
      if (snapshot.phone !== payload.client.phone)
        items.push('تم تغيير رقم الهاتف');
      if ((snapshot.notes ?? null) !== (payload.client.notes ?? null))
        items.push('تم تعديل الملاحظات');
      items.push(
        ...clientRequestChangeSummary(snapshot.requestData ?? null, {
          requestData: payload.requestData,
        } as UpdateClientDto),
      );
    }
    return [...items, ...interestItems];
  }

  private toSummary(
    row: ReviewRow,
    clientName: string | null,
  ): ClientReviewSummaryDto {
    const payload = decodeClientReviewPayload(row.payload);
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      clientId: row.clientId,
      clientName:
        clientName ??
        payload?.client.name ??
        (row.kind === 'EDIT' ? 'عميل محذوف' : 'بلا اسم'),
      requesterId: row.requestedById,
      requesterName: row.requestedBy.name,
      submissionSummary: null,
      hasSubmissionNote: Boolean(payload?.submissionNote?.trim()),
      createdAt: row.createdAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewNotes: row.reviewNotes,
    };
  }
}
