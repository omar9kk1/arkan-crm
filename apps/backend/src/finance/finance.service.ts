import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  FinanceDirection,
  FinanceSourceType,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import type { AuthUser } from '@arkan/shared';
import { randomUUID } from 'node:crypto';
import { assertOwner } from '../common/access/access-policy';
import { DEFAULT_PAGE_SIZE, resolveLimit } from '../common/pagination';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConfirmCommissionPayoutDto,
  CreateManualExpenseDto,
  ListFinanceQueryDto,
  type FinanceMovementType,
  type FinancePeriod,
} from './dto/finance.dto';
import { financeSchemaReady } from './finance-schema';

const FINANCE_SCHEMA_MESSAGE =
  'ترحيل المالية غير مطبّق على قاعدة البيانات هذه بعد. لم يتم تفعيل السجل المالي؛ يلزم تطبيق الترحيل المعتمد أولًا.';

const FINANCE_INCLUDE = {
  createdBy: { select: { name: true } },
  deal: {
    select: {
      id: true,
      reference: true,
      type: true,
      price: true,
      companyCommission: true,
      notes: true,
      property: {
        select: {
          id: true,
          reference: true,
          approvedReference: true,
          title: true,
        },
      },
      client: { select: { id: true, name: true } },
      propertyEmployee: {
        select: {
          userId: true,
          user: { select: { name: true } },
          manager: { select: { id: true, name: true } },
        },
      },
      clientEmployee: {
        select: {
          userId: true,
          user: { select: { name: true } },
          manager: { select: { id: true, name: true } },
        },
      },
    },
  },
  commission: {
    select: {
      id: true,
      amount: true,
      status: true,
      paidAt: true,
      paidBy: { select: { id: true, name: true } },
      notes: true,
      employee: {
        select: {
          userId: true,
          user: { select: { name: true } },
          manager: { select: { id: true, name: true } },
        },
      },
      deal: {
        select: {
          id: true,
          reference: true,
          type: true,
          price: true,
          companyCommission: true,
          notes: true,
          property: {
            select: {
              id: true,
              reference: true,
              approvedReference: true,
              title: true,
            },
          },
          client: { select: { id: true, name: true } },
        },
      },
    },
  },
  payrollEntry: {
    select: {
      id: true,
      status: true,
      paidAt: true,
      notes: true,
      employee: {
        select: {
          userId: true,
          user: { select: { name: true } },
          manager: { select: { id: true, name: true } },
        },
      },
    },
  },
  manualExpense: {
    select: {
      id: true,
      reference: true,
      type: true,
      description: true,
      property: {
        select: {
          id: true,
          reference: true,
          approvedReference: true,
          title: true,
        },
      },
    },
  },
} satisfies Prisma.FinanceMovementInclude;

const COMMISSION_INCLUDE = {
  employee: {
    select: {
      userId: true,
      user: { select: { name: true } },
      manager: { select: { id: true, name: true } },
    },
  },
  deal: {
    select: {
      id: true,
      reference: true,
      type: true,
      price: true,
      companyCommission: true,
      notes: true,
      closedAt: true,
      property: {
        select: {
          id: true,
          reference: true,
          approvedReference: true,
          title: true,
        },
      },
      client: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.CommissionInclude;

type MovementRow = Prisma.FinanceMovementGetPayload<{
  include: typeof FINANCE_INCLUDE;
}>;
type CommissionRow = Prisma.CommissionGetPayload<{
  include: typeof COMMISSION_INCLUDE;
}>;

type MovementStatus = 'EARNED' | 'PENDING' | 'PAID' | 'CANCELLED' | 'RECORDED';
type MovementKind = 'deal' | 'commission' | 'payroll' | 'manual';

export interface FinanceMovementDto {
  id: string;
  reference: string;
  kind: MovementKind;
  sourceType: FinanceSourceType;
  sourceId: string;
  direction: FinanceDirection;
  amount: string;
  currency: string;
  occurredAt: string;
  createdAt: string;
  title: string;
  counterparty: string;
  status: MovementStatus;
  property: { id: string; code: string; title: string } | null;
  client: { id: string; name: string } | null;
  employee: { id: string; name: string } | null;
  manager: { id: string; name: string } | null;
  calculation: string[];
  notes: string | null;
  dealId: string | null;
  commissionId: string | null;
  manualExpenseId: string | null;
}

export interface FinanceSummaryBucketDto {
  currency: string;
  count: number;
  income: string;
  commission: string;
  payroll: string;
  manual: string;
  pendingCommission: string;
  pendingPayroll: string;
  net: string;
}

export interface FinanceLedgerDto {
  items: FinanceMovementDto[];
  nextCursor: string | null;
  summaries: FinanceSummaryBucketDto[];
  parties: string[];
}

type CurrencyTotals = {
  currency: string;
  count: number;
  income: bigint;
  commission: bigint;
  payroll: bigint;
  manual: bigint;
  pendingCommission: bigint;
  pendingPayroll: bigint;
};

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Finance is an OWNER-only surface. The role guard already rejects MANAGER
   * and EMPLOYEE; this is a second explicit server-side assertion so a future
   * route wiring mistake cannot open the ledger by accident.
   */
  private assertOwner(viewer: AuthUser): void {
    assertOwner(viewer);
  }

  private async requireSchema(): Promise<void> {
    if (!(await financeSchemaReady(this.prisma)))
      throw new ServiceUnavailableException(FINANCE_SCHEMA_MESSAGE);
  }

  async list(viewer: AuthUser, query: ListFinanceQueryDto): Promise<FinanceLedgerDto> {
    this.assertOwner(viewer);
    await this.requireSchema();

    const where = this.where(query);
    const limit = resolveLimit(query.limit ?? DEFAULT_PAGE_SIZE);
    const [rows, summaryRows, partyRows] = await Promise.all([
      this.prisma.financeMovement.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        include: FINANCE_INCLUDE,
      }),
      this.prisma.financeMovement.findMany({
        where,
        select: {
          amount: true,
          currency: true,
          sourceType: true,
          direction: true,
          commission: { select: { status: true } },
          payrollEntry: { select: { status: true } },
        },
      }),
      this.prisma.financeMovement.groupBy({
        by: ['counterparty'],
        orderBy: { counterparty: 'asc' },
      }),
    ]);

    const truncated = rows.length > limit;
    const page = truncated ? rows.slice(0, limit) : rows;
    return {
      items: page.map((row) => this.serialize(row)),
      nextCursor: truncated ? (page[page.length - 1]?.id ?? null) : null,
      summaries: this.summaries(summaryRows),
      parties: partyRows.map((row) => row.counterparty),
    };
  }

  /** Picker data for the existing manual-expense form. */
  async options(viewer: AuthUser) {
    this.assertOwner(viewer);
    await this.requireSchema();
    const properties = await this.prisma.property.findMany({
      where: { deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        reference: true,
        approvedReference: true,
        title: true,
      },
    });
    return {
      properties: properties.map((property) => ({
        id: property.id,
        code: property.approvedReference ?? property.reference,
        title: property.title,
      })),
    };
  }

  async createManualExpense(
    viewer: AuthUser,
    dto: CreateManualExpenseDto,
  ): Promise<FinanceMovementDto> {
    this.assertOwner(viewer);
    await this.requireSchema();

    const amount = this.money(dto.amount, 'المبلغ');
    const occurredAt = this.date(dto.date, 'التاريخ');
    const type = dto.type.trim();
    const description = dto.description.trim();
    if (!type) throw new BadRequestException('نوع المصروف مطلوب');
    if (!description) throw new BadRequestException('وصف المصروف مطلوب');

    const reference = `ME-${dto.requestId ?? randomUUID()}`;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.manualExpense.findUnique({
          where: { reference },
          select: { id: true },
        });
        if (existing) {
          const movement = await tx.financeMovement.findFirst({
            where: { manualExpenseId: existing.id },
            include: FINANCE_INCLUDE,
          });
          if (movement) return this.serialize(movement);
        }

        if (dto.propertyId) {
          const property = await tx.property.findFirst({
            where: { id: dto.propertyId, deletedAt: null },
            select: { id: true },
          });
          if (!property)
            throw new BadRequestException('العقار المرتبط غير موجود');
        }

        const expense = await tx.manualExpense.create({
          data: {
            reference,
            type,
            amount,
            currency: dto.currency,
            description,
            propertyId: dto.propertyId ?? null,
            createdById: viewer.id,
            occurredAt,
          },
          select: { id: true },
        });

        const calculation = [
          `نوع المصروف: ${type}`,
          `المبلغ: ${amount.toFixed(3)} ${dto.currency}`,
          dto.propertyId ? 'مرتبط بعقار محدد' : 'غير مرتبط بعقار',
        ].join('\n');

        const movement = await tx.financeMovement.create({
          data: {
            reference: `FM-M-${expense.id.replace(/-/g, '')}`,
            direction: FinanceDirection.EXPENSE,
            sourceType: FinanceSourceType.MANUAL_EXPENSE,
            sourceId: expense.id,
            manualExpenseId: expense.id,
            createdById: viewer.id,
            amount,
            currency: dto.currency,
            counterparty: 'مصروفات الشركة',
            calculationNotes: calculation,
            notes: description,
            occurredAt,
          },
          include: FINANCE_INCLUDE,
        });

        await tx.auditLog.create({
          data: {
            actorId: viewer.id,
            action: 'FINANCE_MANUAL_EXPENSE_CREATE',
            entityType: 'ManualExpense',
            entityId: expense.id,
            after: {
              reference,
              type,
              amount: amount.toFixed(3),
              currency: dto.currency,
              description,
              propertyId: dto.propertyId ?? null,
              occurredAt: dto.date,
            },
          },
        });

        return this.serialize(movement);
      });
    } catch (error) {
      // Concurrent retries with the same requestId: the loser re-reads the
      // winner's row instead of reporting a duplicate or creating another one.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.manualExpense.findUnique({
          where: { reference },
          select: { id: true },
        });
        if (existing) {
          const movement = await this.prisma.financeMovement.findFirst({
            where: { manualExpenseId: existing.id },
            include: FINANCE_INCLUDE,
          });
          if (movement) return this.serialize(movement);
        }
      }
      throw error;
    }
  }

  /**
   * OWNER confirms that one employee commission was actually paid. The same
   * ledger movement is updated (never duplicated); pending commissions are
   * excluded from cash-out totals until this confirmation exists.
   */
  async confirmCommissionPayout(
    viewer: AuthUser,
    commissionId: string,
    dto: ConfirmCommissionPayoutDto,
  ) {
    this.assertOwner(viewer);
    await this.requireSchema();
    const paidAt = this.date(dto.paidAt, 'تاريخ الصرف');

    const result = await this.prisma.$transaction(async (tx) => {
      const commission = await tx.commission.findUnique({
        where: { id: commissionId },
        include: COMMISSION_INCLUDE,
      });
      if (!commission) throw new NotFoundException('العمولة غير موجودة');
      if (commission.status === PaymentStatus.CANCELLED)
        throw new ConflictException('لا يمكن صرف عمولة ملغاة');

      if (commission.status === PaymentStatus.PAID) {
        const movement = await this.ensureCommissionMovement(
          tx,
          commission,
          commission.paidAt ?? paidAt,
        );
        return {
          commission,
          movement,
          paidAt: commission.paidAt ?? paidAt,
        };
      }

      const claimed = await tx.commission.updateMany({
        where: { id: commissionId, status: PaymentStatus.PENDING },
        data: {
          status: PaymentStatus.PAID,
          paidAt,
          paidById: viewer.id,
        },
      });
      if (claimed.count !== 1) {
        const current = await tx.commission.findUnique({
          where: { id: commissionId },
          include: COMMISSION_INCLUDE,
        });
        if (!current) throw new NotFoundException('العمولة غير موجودة');
        if (current.status !== PaymentStatus.PAID)
          throw new ConflictException('تعذر تأكيد صرف العمولة');
        const movement = await this.ensureCommissionMovement(
          tx,
          current,
          current.paidAt ?? paidAt,
        );
        return {
          commission: current,
          movement,
          paidAt: current.paidAt ?? paidAt,
        };
      }

      const paid = await tx.commission.findUniqueOrThrow({
        where: { id: commissionId },
        include: COMMISSION_INCLUDE,
      });
      const movement = await this.ensureCommissionMovement(tx, paid, paidAt);

      await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action: 'FINANCE_COMMISSION_PAYOUT_CONFIRM',
          entityType: 'Commission',
          entityId: commissionId,
          before: {
            status: commission.status,
            paidAt: commission.paidAt?.toISOString() ?? null,
            paidById: commission.paidById ?? null,
          },
          after: {
            status: PaymentStatus.PAID,
            amount: paid.amount.toFixed(3),
            currency: paid.currency,
            paidAt: dto.paidAt,
            paidById: viewer.id,
          },
        },
      });

      // One notification per real payout, written in the SAME transaction as
      // the PENDING→PAID claim above. Retries and concurrent requests that hit
      // the already-paid branch never reach this block, and the unique
      // `(userId, eventKey)` index is a second idempotency guarantee.
      const propertyReference =
        paid.deal.property.approvedReference ?? paid.deal.property.reference;
      await this.notifications.deliverDrafts(tx, [
        {
          userId: paid.employee.userId,
          type: 'SYSTEM',
          title: 'صرف عمولة',
          body: `تم صرف عمولتك عن العقار ${propertyReference} بقيمة ${paid.amount.toFixed(3)} د.ك.`,
          propertyId: paid.deal.property.id,
          eventKey: `COMMISSION_PAID:${paid.id}`,
        },
      ]);

      return { commission: paid, movement, paidAt };
    });

    const paidBy = await this.prisma.user.findUnique({
      where: { id: viewer.id },
      select: { id: true, name: true },
    });

    return {
      commissionId: result.commission.id,
      status: 'PAID' as const,
      amount: result.commission.amount.toFixed(3),
      currency: result.commission.currency,
      paidAt: result.paidAt.toISOString().slice(0, 10),
      paidBy,
      movement: this.serialize(result.movement),
    };
  }

  /**
   * Returns the one COMMISSION movement for this commission, creating it only
   * for pre-migration/legacy rows that have no ledger entry yet. New deals
   * create it inside the deal transaction.
   */
  private async ensureCommissionMovement(
    tx: Prisma.TransactionClient,
    commission: CommissionRow,
    occurredAt: Date,
  ): Promise<MovementRow> {
    const existing = await tx.financeMovement.findFirst({
      where: {
        sourceType: FinanceSourceType.COMMISSION,
        sourceId: commission.id,
      },
      include: FINANCE_INCLUDE,
    });
    if (!existing) {
      return tx.financeMovement.create({
        data: {
          reference: `FM-C-${commission.id.replace(/-/g, '')}`,
          direction: FinanceDirection.EXPENSE,
          sourceType: FinanceSourceType.COMMISSION,
          sourceId: commission.id,
          commissionId: commission.id,
          createdById: commission.createdById,
          amount: commission.amount,
          currency: commission.currency,
          counterparty: commission.employee.user.name,
          calculationNotes: [
            `الصفقة: ${commission.deal.reference}`,
            `الموظف: ${commission.employee.user.name}`,
            `مبلغ العمولة: ${commission.amount.toFixed(3)}`,
            `الحالة المحاسبية: ${commission.status === PaymentStatus.PAID ? 'تم الصرف' : 'بانتظار الصرف'}`,
          ].join('\n'),
          notes: commission.notes,
          occurredAt,
        },
        include: FINANCE_INCLUDE,
      });
    }
    if (existing.occurredAt.getTime() !== occurredAt.getTime())
      return tx.financeMovement.update({
        where: { id: existing.id },
        data: { occurredAt },
        include: FINANCE_INCLUDE,
      });
    return existing;
  }

  private where(query: ListFinanceQueryDto): Prisma.FinanceMovementWhereInput {
    const period = query.period ?? 'all';
    const range = this.periodRange(period);
    const type = query.type;
    const search = query.query?.trim();
    const party = query.party?.trim();

    const searchWhere: Prisma.FinanceMovementWhereInput | null = search
      ? {
          OR: [
            { reference: { contains: search, mode: 'insensitive' } },
            { counterparty: { contains: search, mode: 'insensitive' } },
            { calculationNotes: { contains: search, mode: 'insensitive' } },
            { notes: { contains: search, mode: 'insensitive' } },
            { deal: { is: { reference: { contains: search, mode: 'insensitive' } } } },
            {
              deal: {
                is: {
                  property: {
                    title: { contains: search, mode: 'insensitive' },
                  },
                },
              },
            },
            {
              deal: {
                is: {
                  client: { name: { contains: search, mode: 'insensitive' } },
                },
              },
            },
            {
              commission: {
                is: {
                  deal: {
                    is: {
                      reference: { contains: search, mode: 'insensitive' },
                    },
                  },
                },
              },
            },
            {
              commission: {
                is: {
                  employee: {
                    user: { name: { contains: search, mode: 'insensitive' } },
                  },
                },
              },
            },
            {
              manualExpense: {
                is: { type: { contains: search, mode: 'insensitive' } },
              },
            },
            {
              manualExpense: {
                is: {
                  description: { contains: search, mode: 'insensitive' },
                },
              },
            },
            {
              payrollEntry: {
                is: {
                  employee: {
                    user: { name: { contains: search, mode: 'insensitive' } },
                  },
                },
              },
            },
          ],
        }
      : null;

    return {
      ...(range ? { occurredAt: range } : {}),
      ...(party ? { counterparty: party } : {}),
      ...(type ? { sourceType: this.sourceType(type) } : {}),
      ...(searchWhere ?? {}),
    };
  }

  private sourceType(type: FinanceMovementType): FinanceSourceType {
    switch (type) {
      case 'income':
        return FinanceSourceType.DEAL;
      case 'commission':
        return FinanceSourceType.COMMISSION;
      case 'payroll':
        return FinanceSourceType.PAYROLL;
      case 'manual':
        return FinanceSourceType.MANUAL_EXPENSE;
    }
  }

  private periodRange(period: FinancePeriod): { gte: Date; lt: Date } | null {
    if (period === 'all') return null;
    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    if (period === 'today') return { gte: today, lt: tomorrow };
    if (period === 'week') {
      const start = new Date(today);
      start.setUTCDate(start.getUTCDate() - 6);
      return { gte: start, lt: tomorrow };
    }
    const month = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    return { gte: month, lt: tomorrow };
  }

  private money(value: string, label: string): Prisma.Decimal {
    const [whole = '', fraction = ''] = value.split('.');
    if (whole.length > 12 || fraction.length > 3)
      throw new BadRequestException(
        `${label}: القيم المالية تُحفظ بثلاث منازل عشرية كحد أقصى`,
      );
    const decimal = new Prisma.Decimal(value);
    if (decimal.lte(0)) throw new BadRequestException(`${label}: القيمة غير صالحة`);
    return decimal;
  }

  private date(value: string, label: string): Date {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()))
      throw new BadRequestException(`${label}: التاريخ غير صالح`);
    return parsed;
  }

  private summaries(
    rows: Array<{
      amount: Prisma.Decimal;
      currency: string;
      sourceType: FinanceSourceType;
      direction: FinanceDirection;
      commission: { status: PaymentStatus } | null;
      payrollEntry: { status: PaymentStatus } | null;
    }>,
  ): FinanceSummaryBucketDto[] {
    const buckets = new Map<string, CurrencyTotals>();
    for (const row of rows) {
      const key = row.currency;
      const bucket = buckets.get(key) ?? {
        currency: key,
        count: 0,
        income: 0n,
        commission: 0n,
        payroll: 0n,
        manual: 0n,
        pendingCommission: 0n,
        pendingPayroll: 0n,
      };
      bucket.count += 1;
      const fils = decimalToFils(row.amount.toString());
      if (row.sourceType === FinanceSourceType.DEAL) {
        bucket.income += fils;
      } else if (row.sourceType === FinanceSourceType.COMMISSION) {
        if (row.commission?.status === PaymentStatus.PAID)
          bucket.commission += fils;
        else if (row.commission?.status === PaymentStatus.PENDING)
          bucket.pendingCommission += fils;
      } else if (row.sourceType === FinanceSourceType.PAYROLL) {
        if (row.payrollEntry?.status === PaymentStatus.PAID)
          bucket.payroll += fils;
        else if (row.payrollEntry?.status === PaymentStatus.PENDING)
          bucket.pendingPayroll += fils;
      } else if (row.sourceType === FinanceSourceType.MANUAL_EXPENSE) {
        bucket.manual += fils;
      }
      buckets.set(key, bucket);
    }

    return [...buckets.values()]
      .sort((a, b) =>
        a.currency === 'KWD' ? -1 : b.currency === 'KWD' ? 1 : a.currency.localeCompare(b.currency),
      )
      .map((bucket) => ({
        currency: bucket.currency,
        count: bucket.count,
        income: filsToDecimalString(bucket.income),
        commission: filsToDecimalString(bucket.commission),
        payroll: filsToDecimalString(bucket.payroll),
        manual: filsToDecimalString(bucket.manual),
        pendingCommission: filsToDecimalString(bucket.pendingCommission),
        pendingPayroll: filsToDecimalString(bucket.pendingPayroll),
        net: filsToDecimalString(
          bucket.income -
            bucket.commission -
            bucket.payroll -
            bucket.manual,
        ),
      }));
  }

  private serialize(movement: MovementRow): FinanceMovementDto {
    const kind = this.kind(movement.sourceType);
    const deal =
      movement.deal ??
      movement.commission?.deal ??
      null;
    const propertyRow = deal?.property ?? movement.manualExpense?.property ?? null;
    const employee = this.employeeOf(movement);
    const manager = this.managerOf(movement);
    const property = propertyRow
      ? {
          id: propertyRow.id,
          code: propertyRow.approvedReference ?? propertyRow.reference,
          title: propertyRow.title,
        }
      : null;
    return {
      id: movement.id,
      reference: movement.reference,
      kind,
      sourceType: movement.sourceType,
      sourceId: movement.sourceId,
      direction: movement.direction,
      amount: movement.amount.toFixed(3),
      currency: movement.currency,
      occurredAt: movement.occurredAt.toISOString().slice(0, 10),
      createdAt: movement.createdAt.toISOString(),
      title: this.title(movement, property?.title ?? null, employee?.name ?? null),
      counterparty: movement.counterparty,
      status: this.status(movement),
      property,
      client: deal?.client ?? null,
      employee,
      manager,
      calculation: (movement.calculationNotes ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      notes:
        movement.notes ??
        deal?.notes ??
        movement.commission?.notes ??
        movement.manualExpense?.description ??
        null,
      dealId: deal?.id ?? null,
      commissionId: movement.commission?.id ?? null,
      manualExpenseId: movement.manualExpense?.id ?? null,
    };
  }

  private kind(sourceType: FinanceSourceType): MovementKind {
    switch (sourceType) {
      case FinanceSourceType.DEAL:
        return 'deal';
      case FinanceSourceType.COMMISSION:
        return 'commission';
      case FinanceSourceType.PAYROLL:
        return 'payroll';
      case FinanceSourceType.MANUAL_EXPENSE:
        return 'manual';
    }
  }

  private status(movement: MovementRow): MovementStatus {
    switch (movement.sourceType) {
      case FinanceSourceType.DEAL:
        return 'EARNED';
      case FinanceSourceType.COMMISSION:
        return this.paymentStatus(movement.commission?.status);
      case FinanceSourceType.PAYROLL:
        return this.paymentStatus(movement.payrollEntry?.status);
      case FinanceSourceType.MANUAL_EXPENSE:
        return 'RECORDED';
    }
  }

  private paymentStatus(status: PaymentStatus | undefined): MovementStatus {
    if (status === PaymentStatus.PAID) return 'PAID';
    if (status === PaymentStatus.CANCELLED) return 'CANCELLED';
    return 'PENDING';
  }

  private employeeOf(
    movement: MovementRow,
  ): { id: string; name: string } | null {
    if (movement.sourceType === FinanceSourceType.DEAL) {
      const employee =
        movement.deal?.propertyEmployee ?? movement.deal?.clientEmployee ?? null;
      return employee
        ? { id: employee.userId, name: employee.user.name }
        : null;
    }
    if (movement.sourceType === FinanceSourceType.COMMISSION) {
      const employee = movement.commission?.employee;
      return employee
        ? { id: employee.userId, name: employee.user.name }
        : null;
    }
    if (movement.sourceType === FinanceSourceType.PAYROLL) {
      const employee = movement.payrollEntry?.employee;
      return employee
        ? { id: employee.userId, name: employee.user.name }
        : null;
    }
    return null;
  }

  private managerOf(
    movement: MovementRow,
  ): { id: string; name: string } | null {
    if (movement.sourceType === FinanceSourceType.DEAL) {
      const employee =
        movement.deal?.propertyEmployee ?? movement.deal?.clientEmployee ?? null;
      return employee?.manager ?? null;
    }
    if (movement.sourceType === FinanceSourceType.COMMISSION)
      return movement.commission?.employee.manager ?? null;
    if (movement.sourceType === FinanceSourceType.PAYROLL)
      return movement.payrollEntry?.employee.manager ?? null;
    return null;
  }

  private title(
    movement: MovementRow,
    propertyTitle: string | null,
    employeeName: string | null,
  ): string {
    switch (movement.sourceType) {
      case FinanceSourceType.DEAL: {
        const type =
          movement.deal?.type === 'RENT' ? 'إيجار' : 'بيع';
        return `عمولة ${type}${propertyTitle ? ` — ${propertyTitle}` : ''}`;
      }
      case FinanceSourceType.COMMISSION:
        return `عمولة ${employeeName ?? 'موظف'} — ${movement.commission?.deal.reference ?? 'صفقة'}`;
      case FinanceSourceType.PAYROLL:
        return `راتب ${employeeName ?? 'موظف'}`;
      case FinanceSourceType.MANUAL_EXPENSE:
        return movement.manualExpense?.type ?? 'مصروف يدوي';
    }
  }
}

function decimalToFils(value: string): bigint {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const fils =
    BigInt(whole || '0') * 1000n + BigInt((fraction + '000').slice(0, 3));
  return negative ? -fils : fils;
}

function filsToDecimalString(fils: bigint): string {
  const negative = fils < 0n;
  const absolute = negative ? -fils : fils;
  const fraction = (absolute % 1000n).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${absolute / 1000n}.${fraction}`;
}
