import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FinanceDirection,
  FinanceSourceType,
  Prisma,
  Role,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '@arkan/shared';
import { isManager } from '../common/access/access-policy';
import { clientOwnershipWhere } from '../clients/client-policy';
import { resolveLimit } from '../common/pagination';
import { propertyVisibilityWhere } from '../properties/property-visibility';
import { PrismaService } from '../prisma/prisma.service';
import { financeSchemaReady } from '../finance/finance-schema';
import { CreateDealDto } from './dto/create-deal.dto';
import { ListDealClientsQueryDto } from './dto/list-deal-clients.query';
import { ListDealsQueryDto } from './dto/list-deals.query';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const CURRENCY = 'KWD';

/**
 * The projection every deal read returns. Property/owner/client data is limited
 * to what the deals cards and the details drawer display; no contact phones are
 * exposed through this endpoint.
 */
const DEAL_INCLUDE = {
  property: {
    select: {
      id: true,
      reference: true,
      approvedReference: true,
      title: true,
      area: true,
      sizeSqm: true,
      status: true,
      listingType: true,
      owner: { select: { name: true } },
      contact: { select: { name: true } },
    },
  },
  client: { select: { id: true, name: true } },
  propertyEmployee: {
    select: { id: true, userId: true, user: { select: { name: true } } },
  },
  clientEmployee: {
    select: { id: true, userId: true, user: { select: { name: true } } },
  },
  recordedBy: { select: { name: true } },
  commissions: {
    select: {
      id: true,
      commissionRole: true,
      amount: true,
      status: true,
      paidAt: true,
      employeeId: true,
      employee: { select: { userId: true } },
    },
  },
} satisfies Prisma.DealInclude;

type DealRow = Prisma.DealGetPayload<{ include: typeof DEAL_INCLUDE }>;

export interface DealCommissionDto {
  /** Stable `Commission.id` — the payout endpoint key (never an employee id). */
  id: string;
  role: 'PROPERTY_EMPLOYEE' | 'CLIENT_EMPLOYEE' | 'MANUAL';
  amount: string;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  /** Calendar date (YYYY-MM-DD) once paid, otherwise null. */
  paidAt: string | null;
  employeeUserId: string;
}

export interface DealDto {
  id: string;
  reference: string;
  type: 'SALE' | 'RENT' | 'EXCHANGE';
  price: string;
  companyCommission: string;
  propertyCommission: string;
  clientCommission: string;
  currency: string;
  closedAt: string;
  createdAt: string;
  property: {
    id: string;
    code: string;
    title: string;
    area: string | null;
    ownerName: string | null;
    status: string;
    listingType: 'SALE' | 'RENT' | 'EXCHANGE';
  };
  client: { id: string; name: string };
  propertyEmployee: { userId: string; name: string } | null;
  clientEmployee: { userId: string; name: string } | null;
  recordedBy: { name: string };
  notes: string | null;
  commissions: DealCommissionDto[];
}

@Injectable()
export class DealsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * OWNER: every deal. MANAGER: only deals whose property/client employee is in
   * the manager's CURRENT team (the same predicate the dashboard uses), so
   * another team's deals and OWNER-direct employees never appear.
   */
  private scopeWhere(viewer: AuthUser): Prisma.DealWhereInput {
    if (!isManager(viewer)) return {};
    return {
      OR: [
        { propertyEmployee: { managerUserId: viewer.id } },
        { clientEmployee: { managerUserId: viewer.id } },
      ],
    };
  }

  async list(viewer: AuthUser, query: ListDealsQueryDto) {
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const rows = await this.prisma.deal.findMany({
      where: this.scopeWhere(viewer),
      orderBy: [{ closedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: DEAL_INCLUDE,
    });
    const truncated = rows.length > limit;
    const page = truncated ? rows.slice(0, limit) : rows;
    return {
      items: page.map((row) => this.serialize(row)),
      nextCursor: truncated ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async get(viewer: AuthUser, id: string): Promise<DealDto> {
    const deal = await this.prisma.deal.findFirst({
      where: { id, ...this.scopeWhere(viewer) },
      include: DEAL_INCLUDE,
    });
    if (!deal) throw new NotFoundException('Deal not found');
    return this.serialize(deal);
  }

  async create(viewer: AuthUser, dto: CreateDealDto): Promise<DealDto> {
    const price = this.money(dto.price, 'سعر العقار', false);
    const companyCommission = this.money(
      dto.companyCommission,
      'عمولة الشركة',
      true,
    );
    const propertyCommission = this.money(
      dto.propertyCommission,
      'عمولة موظف العقار',
      true,
    );
    const clientCommission = this.money(
      dto.clientCommission,
      'عمولة موظف العميل',
      true,
    );
    const closedAt = new Date(`${dto.closedAt}T00:00:00.000Z`);
    if (Number.isNaN(closedAt.getTime()))
      throw new BadRequestException('تاريخ الإغلاق غير صالح');

    const deal = await this.prisma.$transaction(async (tx) => {
      const property = await tx.property.findFirst({
        where: {
          id: dto.propertyId,
          status: 'AVAILABLE',
          ...propertyVisibilityWhere(viewer),
        },
        select: {
          id: true,
          reference: true,
          approvedReference: true,
          title: true,
          createdByUserId: true,
          createdByUser: { select: { role: true } },
        },
      });
      if (!property)
        throw new NotFoundException(
          'العقار غير موجود أو لم يعد متاحًا لتسجيل صفقة',
        );

      // MANAGER cannot override the property's responsible employee. The only
      // permitted attribution is the employee who created that property. OWNER
      // retains the existing company-wide override.
      if (isManager(viewer)) {
        const propertyEmployeeUserId =
          property.createdByUser?.role === Role.EMPLOYEE
            ? property.createdByUserId
            : null;
        if (
          !propertyEmployeeUserId ||
          dto.propertyEmployeeUserId !== propertyEmployeeUserId
        )
          throw new ForbiddenException(
            'لا يمكن للمدير تغيير الموظف المسؤول عن العقار. استخدم الموظف الحالي فقط.',
          );
      }

      const client = await tx.client.findFirst({
        where: { id: dto.clientId, ...clientOwnershipWhere(viewer) },
        select: {
          id: true,
          name: true,
          responsibleEmployee: { select: { userId: true } },
        },
      });
      if (!client) throw new NotFoundException('العميل غير موجود');

      // MANAGER cannot override the client's responsible employee either: the
      // deal must use the employee actually linked to the selected client.
      // OWNER retains the existing company-wide override.
      if (isManager(viewer)) {
        const clientEmployeeUserId = client.responsibleEmployee?.userId ?? null;
        if (
          !clientEmployeeUserId ||
          dto.clientEmployeeUserId !== clientEmployeeUserId
        )
          throw new ForbiddenException(
            'لا يمكن للمدير تغيير الموظف المسؤول عن العميل. استخدم الموظف الحالي فقط.',
          );
      }

      const propertyEmployee = await this.resolveEmployee(
        tx,
        viewer,
        dto.propertyEmployeeUserId,
      );
      const clientEmployee = await this.resolveEmployee(
        tx,
        viewer,
        dto.clientEmployeeUserId,
      );

      // Atomic status claim: two concurrent submissions for the same property
      // can never both create a deal.
      const claimed = await tx.property.updateMany({
        where: { id: property.id, status: 'AVAILABLE', deletedAt: null },
        data: {
          status: dto.type === 'SALE' ? 'SOLD' : 'RENTED',
          version: { increment: 1 },
        },
      });
      if (claimed.count !== 1)
        throw new ConflictException(
          'العقار لم يعد متاحًا — ربما سُجّلت صفقة أخرى عليه للتو',
        );

      const reference = this.reference();
      const created = await tx.deal.create({
        data: {
          reference,
          type: dto.type,
          propertyId: property.id,
          clientId: client.id,
          recordedById: viewer.id,
          propertyEmployeeId: propertyEmployee.id,
          clientEmployeeId: clientEmployee.id,
          price,
          companyCommission,
          currency: CURRENCY,
          closedAt,
          notes: dto.notes?.trim() || null,
        },
        select: { id: true },
      });

      const propertyCommissionRow = await tx.commission.create({
        data: {
          dealId: created.id,
          employeeId: propertyEmployee.id,
          commissionRole: 'PROPERTY_EMPLOYEE',
          createdById: viewer.id,
          amount: propertyCommission,
          currency: CURRENCY,
        },
        select: { id: true },
      });
      const clientCommissionRow = await tx.commission.create({
        data: {
          dealId: created.id,
          employeeId: clientEmployee.id,
          commissionRole: 'CLIENT_EMPLOYEE',
          createdById: viewer.id,
          amount: clientCommission,
          currency: CURRENCY,
        },
        select: { id: true },
      });

      // The ledger writes only when the reviewed Finance migration is present.
      // On a database that has not been activated yet, deal creation stays
      // functional and never writes a rounded 3-decimal movement.
      if (await financeSchemaReady(tx)) {
        const propertyCode =
          property.approvedReference ?? property.reference;
        const dealCalculation = [
          `قيمة الصفقة: ${price.toFixed(3)}`,
          `نوع الصفقة: ${dto.type === 'SALE' ? 'بيع' : 'إيجار'}`,
          `عمولة الشركة: ${companyCommission.toFixed(3)}`,
          `العقار: ${propertyCode} — ${property.title}`,
          `العميل: ${client.name}`,
          `موظف العقار: ${propertyEmployee.name} — المدير: ${propertyEmployee.managerName ?? 'بدون مدير'}`,
          `عمولة موظف العقار: ${propertyCommission.toFixed(3)}`,
          `موظف العميل: ${clientEmployee.name} — المدير: ${clientEmployee.managerName ?? 'بدون مدير'}`,
          `عمولة موظف العميل: ${clientCommission.toFixed(3)}`,
          'ملاحظة: عمولة الشركة مستحقة عند إغلاق الصفقة، ولا تُعدّ نقدًا محصلًا تلقائيًا.',
        ].join('\n');

        await tx.financeMovement.create({
          data: {
            reference: `FM-D-${created.id.replace(/-/g, '')}`,
            direction: FinanceDirection.INCOME,
            sourceType: FinanceSourceType.DEAL,
            sourceId: created.id,
            dealId: created.id,
            createdById: viewer.id,
            amount: companyCommission,
            currency: CURRENCY,
            counterparty: 'الشركة',
            calculationNotes: dealCalculation,
            notes: dto.notes?.trim() || null,
            occurredAt: closedAt,
          },
        });

        if (propertyCommission.gt(0)) {
          await tx.financeMovement.create({
            data: {
              reference: `FM-C-${propertyCommissionRow.id.replace(/-/g, '')}`,
              direction: FinanceDirection.EXPENSE,
              sourceType: FinanceSourceType.COMMISSION,
              sourceId: propertyCommissionRow.id,
              commissionId: propertyCommissionRow.id,
              createdById: viewer.id,
              amount: propertyCommission,
              currency: CURRENCY,
              counterparty: propertyEmployee.name,
              calculationNotes: [
                `الصفقة: ${reference}`,
                'دور العمولة: موظف العقار',
                `الموظف: ${propertyEmployee.name} — المدير: ${propertyEmployee.managerName ?? 'بدون مدير'}`,
                `مبلغ العمولة: ${propertyCommission.toFixed(3)}`,
                'الحالة المحاسبية: بانتظار الصرف',
              ].join('\n'),
              occurredAt: closedAt,
            },
          });
        }

        if (clientCommission.gt(0)) {
          await tx.financeMovement.create({
            data: {
              reference: `FM-C-${clientCommissionRow.id.replace(/-/g, '')}`,
              direction: FinanceDirection.EXPENSE,
              sourceType: FinanceSourceType.COMMISSION,
              sourceId: clientCommissionRow.id,
              commissionId: clientCommissionRow.id,
              createdById: viewer.id,
              amount: clientCommission,
              currency: CURRENCY,
              counterparty: clientEmployee.name,
              calculationNotes: [
                `الصفقة: ${reference}`,
                'دور العمولة: موظف العميل',
                `الموظف: ${clientEmployee.name} — المدير: ${clientEmployee.managerName ?? 'بدون مدير'}`,
                `مبلغ العمولة: ${clientCommission.toFixed(3)}`,
                'الحالة المحاسبية: بانتظار الصرف',
              ].join('\n'),
              occurredAt: closedAt,
            },
          });
        }
      }

      // Notes now live on Deal.notes; the audit entry keeps the same snapshot
      // for the audit trail (it is no longer the read source).
      await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action: 'DEAL_CREATE',
          entityType: 'Deal',
          entityId: created.id,
          after: {
            reference,
            propertyId: property.id,
            clientId: client.id,
            type: dto.type,
            price: dto.price,
            companyCommission: dto.companyCommission,
            propertyCommission: dto.propertyCommission,
            clientCommission: dto.clientCommission,
            closedAt: dto.closedAt,
            notes: dto.notes?.trim() || null,
          },
        },
      });

      const row = await tx.deal.findUniqueOrThrow({
        where: { id: created.id },
        include: DEAL_INCLUDE,
      });
      return this.serialize(row);
    });

    return deal;
  }

  /**
   * `GET /deals/client-options` — searchable, cursor-paginated client picker.
   * The row-level rule is the SAME `clientOwnershipWhere` used by `/clients`,
   * so OWNER sees company clients while MANAGER sees own/team clients only.
   * No phone or other private client field is returned.
   */
  async clientOptions(viewer: AuthUser, query: ListDealClientsQueryDto) {
    const limit = resolveLimit(query.limit ?? 50);
    const search = query.search?.trim();
    const rows = await this.prisma.client.findMany({
      where: {
        AND: [
          clientOwnershipWhere(viewer),
          ...(search
            ? [
                {
                  OR: [
                    {
                      name: { contains: search, mode: 'insensitive' as const },
                    },
                    {
                      phone: { contains: search, mode: 'insensitive' as const },
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        name: true,
        responsibleEmployee: {
          select: { userId: true, user: { select: { name: true } } },
        },
      },
    });
    const truncated = rows.length > limit;
    const page = truncated ? rows.slice(0, limit) : rows;
    return {
      items: page.map((client) => ({
        id: client.id,
        name: client.name,
        responsibleUserId: client.responsibleEmployee?.userId ?? null,
        responsibleEmployeeName:
          client.responsibleEmployee?.user.name ?? null,
      })),
      nextCursor: truncated ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /**
   * Picker data for the existing wizard: authorised properties, clients and
   * active employees. Employees are resolved by the same team predicate used
   * by the employee directory, so a MANAGER can never select another team.
   */
  async options(viewer: AuthUser) {
    const managerId = isManager(viewer) ? viewer.id : null;
    const [properties, clients, employees] = await Promise.all([
      this.prisma.property.findMany({
        where: { ...propertyVisibilityWhere(viewer) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          reference: true,
          approvedReference: true,
          title: true,
          area: true,
          sizeSqm: true,
          status: true,
          listingType: true,
          owner: { select: { name: true } },
          contact: { select: { name: true } },
          createdByUserId: true,
          createdByUser: {
            select: { id: true, name: true, role: true },
          },
        },
      }),
      this.prisma.client.findMany({
        where: { ...clientOwnershipWhere(viewer) },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          responsibleEmployee: {
            select: { userId: true, user: { select: { name: true } } },
          },
        },
      }),
      this.prisma.user.findMany({
        where: {
          role: Role.EMPLOYEE,
          isActive: true,
          ...(managerId ? { employee: { managerUserId: managerId } } : {}),
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true },
      }),
    ]);

    return {
      properties: properties.map((property) => ({
        id: property.id,
        code: property.approvedReference ?? property.reference,
        title: property.title,
        area: property.sizeSqm?.toString() ?? property.area,
        ownerName: property.owner?.name ?? property.contact?.name ?? null,
        status: property.status,
        listingType: property.listingType,
        suggestedEmployeeUserId:
          property.createdByUser?.role === Role.EMPLOYEE
            ? property.createdByUser.id
            : null,
        suggestedEmployeeName:
          property.createdByUser?.role === Role.EMPLOYEE
            ? property.createdByUser.name
            : null,
      })),
      clients: clients.map((client) => ({
        id: client.id,
        name: client.name,
        responsibleUserId: client.responsibleEmployee?.userId ?? null,
        responsibleEmployeeName:
          client.responsibleEmployee?.user.name ?? null,
      })),
      employees: employees.map((employee) => ({
        userId: employee.id,
        name: employee.name,
      })),
    };
  }

  private async resolveEmployee(
    tx: Prisma.TransactionClient,
    viewer: AuthUser,
    userId: string,
  ): Promise<{
    id: string;
    userId: string;
    name: string;
    managerName: string | null;
  }> {
    const profile = await tx.employeeProfile.findFirst({
      where: {
        userId,
        ...(isManager(viewer) ? { managerUserId: viewer.id } : {}),
        user: { role: Role.EMPLOYEE, isActive: true },
      },
      select: {
        id: true,
        userId: true,
        user: { select: { name: true } },
        manager: { select: { name: true } },
      },
    });
    if (!profile)
      throw new BadRequestException(
        'الموظف المحدد غير متاح ضمن نطاق فريقك',
      );
    return {
      id: profile.id,
      userId: profile.userId,
      name: profile.user.name,
      managerName: profile.manager?.name ?? null,
    };
  }

  /**
   * Decimal money validation. The database columns are Decimal(15,3) (KWD
   * fils); values with more than three decimal places are rejected with an
   * explicit message rather than silently rounded.
   */
  private money(value: string, label: string, allowZero: boolean) {
    const [integerPart = '', fraction = ''] = value.split('.');
    if (integerPart.length > 12 || fraction.length > 3)
      throw new BadRequestException(
        `${label}: القيم المالية تُحفظ بثلاث منازل عشرية كحد أقصى`,
      );
    const decimal = new Prisma.Decimal(value);
    if (allowZero ? decimal.lt(0) : decimal.lte(0))
      throw new BadRequestException(`${label}: القيمة غير صالحة`);
    return decimal;
  }

  private reference(): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `D-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
  }

  private serialize(deal: DealRow): DealDto {
    const commission = (role: 'PROPERTY_EMPLOYEE' | 'CLIENT_EMPLOYEE') =>
      deal.commissions
        .find((row) => row.commissionRole === role)
        ?.amount.toFixed(3) ?? '0.000';
    return {
      id: deal.id,
      reference: deal.reference,
      type: deal.type,
      price: deal.price.toFixed(3),
      companyCommission: deal.companyCommission.toFixed(3),
      propertyCommission: commission('PROPERTY_EMPLOYEE'),
      clientCommission: commission('CLIENT_EMPLOYEE'),
      currency: deal.currency,
      closedAt: deal.closedAt.toISOString().slice(0, 10),
      createdAt: deal.createdAt.toISOString(),
      property: {
        id: deal.property.id,
        code: deal.property.approvedReference ?? deal.property.reference,
        title: deal.property.title,
        area: deal.property.sizeSqm?.toString() ?? deal.property.area,
        ownerName:
          deal.property.owner?.name ?? deal.property.contact?.name ?? null,
        status: deal.property.status,
        listingType: deal.property.listingType,
      },
      client: { id: deal.client.id, name: deal.client.name },
      propertyEmployee: deal.propertyEmployee
        ? {
            userId: deal.propertyEmployee.userId,
            name: deal.propertyEmployee.user.name,
          }
        : null,
      clientEmployee: deal.clientEmployee
        ? {
            userId: deal.clientEmployee.userId,
            name: deal.clientEmployee.user.name,
          }
        : null,
      recordedBy: { name: deal.recordedBy.name },
      notes: deal.notes,
      commissions: deal.commissions.map((row) => ({
        id: row.id,
        role: row.commissionRole,
        amount: row.amount.toFixed(3),
        status: row.status,
        paidAt: row.paidAt?.toISOString().slice(0, 10) ?? null,
        employeeUserId: row.employee.userId,
      })),
    };
  }
}
