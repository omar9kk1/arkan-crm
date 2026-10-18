import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PropertyStatus, Role } from '@prisma/client';
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
   * seed and `AuthService`. Rejects a duplicate email rather than overwriting.
   */
  async create(dto: CreateEmployeeDto): Promise<EmployeeDto> {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing)
      throw new ConflictException('this email is already registered');

    const passwordHash = await hashPassword(dto.password);
    const created = await this.prisma.user.create({
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
      select: { id: true },
    });
    return this.readOne(created.id);
  }

  /**
   * `PATCH /employees/:id` — renames an EMPLOYEE account. Any other id (manager,
   * unknown) answers 404, so this endpoint can only ever touch the employee
   * directory the manager sees.
   */
  async update(id: string, dto: UpdateEmployeeDto): Promise<EmployeeDto> {
    const target = await this.prisma.user.findFirst({
      where: { id, role: Role.EMPLOYEE },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('employee not found');

    await this.prisma.user.update({
      where: { id },
      data: { name: dto.name.trim() },
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
