import { Injectable, NotFoundException } from '@nestjs/common';
import { Contact, Prisma } from '@prisma/client';
import { Role, type AuthUser } from '@arkan/shared';
import { PrismaService } from '../prisma/prisma.service';
import { resolveLimit } from '../common/pagination';
import { propertyVisibilityWhere } from '../properties/property-visibility';
import { contactOwnershipWhere } from './contact-policy';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { ListContactsQueryDto } from './dto/list-contacts.query';
import type {
  ContactDto,
  ContactPageDto,
  ContactPropertyRefDto,
} from './contact.dto';

/**
 * Linked properties are filtered inside the Prisma query with the same row-level
 * rule as `GET /properties`, so the response never carries a property the viewer
 * could not open directly. References are ordered for a stable card summary.
 */
function contactInclude(viewer: AuthUser) {
  return {
    properties: {
      where: propertyVisibilityWhere(viewer),
      select: { id: true, reference: true, listingType: true },
      orderBy: [{ reference: 'asc' }],
    },
    // Joined, not queried per row: the responsible employee's display name
    // comes from the related `User.name` in the same query.
    responsibleUser: { select: { name: true } },
  } satisfies Prisma.ContactInclude;
}

export function serializeContact(
  contact: Contact & { responsibleUser?: { name: string } | null },
  properties: readonly ContactPropertyRefDto[] = [],
): ContactDto {
  return {
    id: contact.id,
    type: contact.type,
    name: contact.name,
    phone: contact.phone,
    notes: contact.notes,
    responsibleUserId: contact.responsibleUserId,
    responsibleEmployeeName: contact.responsibleUser?.name ?? null,
    properties: properties.map((property) => ({
      id: property.id,
      reference: property.reference,
      listingType: property.listingType,
    })),
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  };
}

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(viewer: AuthUser, dto: CreateContactDto): Promise<ContactDto> {
    const contact = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contact.create({
        data: {
          type: dto.type,
          name: dto.name.trim(),
          phone: dto.phone.trim(),
          notes: dto.notes?.trim() || null,
          // Employees own the contacts they register; manager records are company
          // records (responsibleUserId = null) and are not auto-granted to employees.
          responsibleUserId: viewer.role === Role.EMPLOYEE ? viewer.id : null,
        },
        include: { responsibleUser: { select: { name: true } } },
      });
      await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action: 'CONTACT_CREATE',
          entityType: 'Contact',
          entityId: created.id,
          after: { type: created.type },
        },
      });
      return created;
    });
    return serializeContact(contact);
  }

  async list(
    viewer: AuthUser,
    query: ListContactsQueryDto,
  ): Promise<ContactPageDto> {
    const limit = resolveLimit(query.limit);
    const where: Prisma.ContactWhereInput = {
      ...contactOwnershipWhere(viewer),
      ...(query.type ? { type: query.type } : {}),
    };
    const rows = await this.prisma.contact.findMany({
      where,
      include: contactInclude(viewer),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: items.map((row) => serializeContact(row, row.properties)),
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    };
  }

  async findOne(viewer: AuthUser, id: string): Promise<ContactDto> {
    const contact = await this.prisma.contact.findFirst({
      where: { id, ...contactOwnershipWhere(viewer) },
      include: contactInclude(viewer),
    });
    if (!contact) throw new NotFoundException('Contact not found');
    return serializeContact(contact, contact.properties);
  }

  async update(
    viewer: AuthUser,
    id: string,
    dto: UpdateContactDto,
  ): Promise<ContactDto> {
    await this.requireVisible(viewer, id);
    const updated = await this.prisma.$transaction(async (tx) => {
      // Re-check ownership inside the write to avoid a stale authorization decision.
      const result = await tx.contact.findFirst({
        where: { id, ...contactOwnershipWhere(viewer) },
      });
      if (!result) throw new NotFoundException('Contact not found');
      const contact = await tx.contact.update({
        where: { id },
        data: {
          ...(dto.type ? { type: dto.type } : {}),
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone.trim() } : {}),
          ...(dto.notes !== undefined
            ? { notes: dto.notes?.trim() || null }
            : {}),
        },
        include: contactInclude(viewer),
      });
      await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action: 'CONTACT_UPDATE',
          entityType: 'Contact',
          entityId: id,
          after: { type: contact.type },
        },
      });
      return contact;
    });
    return serializeContact(updated, updated.properties);
  }

  /** Returns the contact when the viewer may act on it, otherwise 404. */
  private async requireVisible(
    viewer: AuthUser,
    id: string,
  ): Promise<Contact> {
    const contact = await this.prisma.contact.findFirst({
      where: { id, ...contactOwnershipWhere(viewer) },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    return contact;
  }

  /**
   * Authorization gate used when attaching an existing contact to a property. The
   * employee may only attach a contact they own; the manager may attach any contact.
   * Runs inside the caller's transaction so the decision and the write are atomic.
   */
  async requireUsableContact(
    viewer: AuthUser,
    contactId: string,
    client: Prisma.TransactionClient,
  ): Promise<Contact> {
    const contact = await client.contact.findFirst({
      where: { id: contactId, ...contactOwnershipWhere(viewer) },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    return contact;
  }
}
