import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PropertyStatus, Role } from '@prisma/client';
import type { AuthUser } from '@arkan/shared';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../auth/password';
import type {
  EmployeeDto,
  EmployeeListDto,
  EmployeePropertyDto,
} from './employee.dto';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

/** Newest properties kept per employee for the file drawer; the count is exact. */
const PROPERTY_LIMIT = 50;

/**
 * The single selection behind every employee read, so all three endpoints
 * answer with the identical, privacy-safe shape.
 */
const EMPLOYEE_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  employee: { select: { phone: true, hiredAt: true, baseSalary: true } },
  _count: { select: { createdProperties: true } },
} satisfies Prisma.UserSelect;

type EmployeeRow = Prisma.UserGetPayload<{ select: typeof EMPLOYEE_SELECT }>;

type PropertyRow = {
  id: string;
  reference: string;
  title: string;
  status: PropertyStatus;
  createdByUserId: string | null;
};

/**
 * Manager-only directory of real EMPLOYEE accounts.
 *
 * Every relationship is resolved through a stable `User.id` (or the 1:1
 * `EmployeeProfile`), never by matching a display name. The only statistic the
 * backend can currently derive is the property one, and it is linked strictly
 * through `Property.createdByUserId` — the same column the property responsible
 * pill uses, so renaming a user is reflected everywhere on the next read.
 */
@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  /** `GET /employees` — every EMPLOYEE-role account with its property stats. */
  async list(): Promise<EmployeeListDto> {
    const users = await this.prisma.user.findMany({
      where: { role: Role.EMPLOYEE },
      orderBy: { createdAt: 'asc' },
      select: EMPLOYEE_SELECT,
    });
    const byEmployee = await this.propertiesByEmployee(users.map((u) => u.id));
    return {
      items: users.map((user) =>
        this.serialize(user, byEmployee.get(user.id) ?? []),
      ),
    };
  }

  /**
   * `POST /employees` — creates a real `User` + `EmployeeProfile` so the new
   * account can log in with the password-hashing convention already used by the
   * seed and `AuthService`. Rejects a duplicate email rather than overwriting,
   * and records the creation in the audit trail without the password.
   */
  async create(viewer: AuthUser, dto: CreateEmployeeDto): Promise<EmployeeDto> {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing)
      throw new ConflictException('this email is already registered');

    const passwordHash = await hashPassword(dto.password);
    const created = await this.prisma
      .$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            name: dto.name.trim(),
            role: dto.role,
            isActive: dto.isActive ?? true,
            passwordHash,
            employee: {
              create: {
                phone: dto.phone?.trim() || null,
                hiredAt: dto.hiredAt ? new Date(dto.hiredAt) : null,
                baseSalary: dto.baseSalary ?? null,
              },
            },
          },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            isActive: true,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: viewer.id,
            action: 'EMPLOYEE_CREATE',
            entityType: 'User',
            entityId: user.id,
            // The audit trail records WHO and WHAT, never the chosen password.
            after: {
              name: user.name,
              email: user.email,
              role: user.role,
              isActive: user.isActive,
            },
          },
        });
        return user;
      })
      .catch((cause: unknown) => {
        // Two concurrent creations of the same email race past the pre-check;
        // the unique index turns that into a 409, never a 500.
        if (
          cause instanceof Prisma.PrismaClientKnownRequestError &&
          cause.code === 'P2002'
        )
          throw new ConflictException('this email is already registered');
        throw cause;
      });
    return this.readOne(created.id);
  }

  /**
   * `PATCH /employees/:id` — renames an EMPLOYEE account. Any other id (manager,
   * unknown) answers 404, so this endpoint can only ever touch the employee
   * directory the manager sees. The rename and its audit record are written in
   * one transaction.
   */
  async update(
    viewer: AuthUser,
    id: string,
    dto: UpdateEmployeeDto,
  ): Promise<EmployeeDto> {
    const name = dto.name.trim();
    await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findFirst({
        where: { id, role: Role.EMPLOYEE },
        select: { id: true, name: true },
      });
      if (!target) throw new NotFoundException('employee not found');

      await tx.user.update({ where: { id }, data: { name } });
      await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action: 'EMPLOYEE_RENAME',
          entityType: 'User',
          entityId: id,
          before: { name: target.name },
          after: { name },
        },
      });
    });
    return this.readOne(id);
  }

  /**
   * `PATCH /employees/:id/activation` — flips `User.isActive` for an EMPLOYEE
   * account. Managers are refused with 404, the body carries the desired state
   * only (a role field is rejected by validation), and repeating the current
   * state is a safe idempotent no-op.
   *
   * Deactivating revokes every existing session, so a disable → enable cycle
   * can never resurrect tokens issued before the deactivation. Nothing else
   * moves: `User.id`, email, password, role and every linked record stay in
   * place, keeping property statistics and responsible-name pills intact.
   */
  async setActivation(
    viewer: AuthUser,
    id: string,
    isActive: boolean,
  ): Promise<EmployeeDto> {
    await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findFirst({
        where: { id, role: Role.EMPLOYEE },
        select: { id: true, isActive: true },
      });
      if (!target) throw new NotFoundException('employee not found');
      if (target.isActive === isActive) return;

      await tx.user.update({ where: { id }, data: { isActive } });
      if (!isActive)
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action: isActive ? 'EMPLOYEE_ACTIVATE' : 'EMPLOYEE_DEACTIVATE',
          entityType: 'User',
          entityId: id,
          after: { isActive },
        },
      });
    });
    return this.readOne(id);
  }

  private async readOne(id: string): Promise<EmployeeDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: EMPLOYEE_SELECT,
    });
    const byEmployee = await this.propertiesByEmployee([id]);
    return this.serialize(user, byEmployee.get(id) ?? []);
  }

  /**
   * Loads the created properties for the given users in ONE query and groups
   * them in memory, so listing N employees stays a constant number of queries.
   */
  private async propertiesByEmployee(
    userIds: string[],
  ): Promise<Map<string, PropertyRow[]>> {
    const byEmployee = new Map<string, PropertyRow[]>();
    if (!userIds.length) return byEmployee;
    const rows = await this.prisma.property.findMany({
      where: { createdByUserId: { in: userIds } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        reference: true,
        title: true,
        status: true,
        createdByUserId: true,
      },
    });
    for (const row of rows) {
      if (!row.createdByUserId) continue;
      const list = byEmployee.get(row.createdByUserId);
      if (list) list.push(row);
      else byEmployee.set(row.createdByUserId, [row]);
    }
    return byEmployee;
  }

  private serialize(user: EmployeeRow, properties: PropertyRow[]): EmployeeDto {
    const propertiesByStatus = Object.values(PropertyStatus).reduce(
      (acc, status) => ({ ...acc, [status]: 0 }),
      {} as Record<PropertyStatus, number>,
    );
    for (const property of properties)
      propertiesByStatus[property.status] += 1;

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      phone: user.employee?.phone ?? null,
      hiredAt: user.employee?.hiredAt
        ? user.employee.hiredAt.toISOString()
        : null,
      baseSalary: user.employee?.baseSalary
        ? user.employee.baseSalary.toString()
        : null,
      propertyCount: user._count.createdProperties,
      propertiesByStatus,
      properties: properties
        .slice(0, PROPERTY_LIMIT)
        .map(
          (property): EmployeePropertyDto => ({
            id: property.id,
            reference: property.reference,
            title: property.title,
            status: property.status,
          }),
        ),
    };
  }
}
