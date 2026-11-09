import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface OwnerPromotionCandidate {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  linked: {
    properties: number;
    clients: number;
    contacts: number;
    notifications: number;
  };
}

export interface OwnerPromotionPreview {
  dryRun: boolean;
  existingOwners: number;
  selected: OwnerPromotionCandidate | null;
  candidates: OwnerPromotionCandidate[];
}

/**
 * One-time, explicit promotion of the existing primary Manager to OWNER.
 *
 * Safety properties:
 * - never promotes every Manager;
 * - refuses when more than one active Manager exists and no explicit email/id
 *   was supplied;
 * - refuses when an OWNER already exists;
 * - `dryRun` is the default (no writes);
 * - promotion bumps authVersion and revokes every refresh token in the SAME
 *   transaction, so all old access/refresh sessions die and a fresh login is
 *   required.
 */
@Injectable()
export class OwnerPromotionService {
  constructor(private readonly prisma: PrismaService) {}

  private async candidate(
    user: {
      id: string;
      email: string;
      name: string;
      createdAt: Date;
    },
  ): Promise<OwnerPromotionCandidate> {
    const [properties, clients, contacts, notifications] = await Promise.all([
      this.prisma.property.count({ where: { createdByUserId: user.id } }),
      this.prisma.client.count({
        where: {
          OR: [
            { createdByUserId: user.id },
            { responsibleEmployee: { userId: user.id } },
          ],
        },
      }),
      this.prisma.contact.count({ where: { responsibleUserId: user.id } }),
      this.prisma.notification.count({ where: { userId: user.id } }),
    ]);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt.toISOString(),
      linked: { properties, clients, contacts, notifications },
    };
  }

  async preview(email?: string): Promise<OwnerPromotionPreview> {
    const existingOwners = await this.prisma.user.count({
      where: { role: Role.OWNER },
    });
    const managers = await this.prisma.user.findMany({
      where: { role: Role.MANAGER, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, name: true, createdAt: true },
    });
    const candidates = await Promise.all(
      managers.map((manager) => this.candidate(manager)),
    );

    let selected: OwnerPromotionCandidate | null = null;
    if (email) {
      const normalized = email.trim().toLowerCase();
      selected =
        candidates.find(
          (candidate) => candidate.email.toLowerCase() === normalized,
        ) ?? null;
      if (!selected)
        throw new BadRequestException(
          'The requested email is not an active MANAGER candidate',
        );
    } else if (candidates.length === 1) {
      selected = candidates[0] ?? null;
    } else if (candidates.length === 0) {
      throw new BadRequestException(
        'No active MANAGER candidate exists to promote',
      );
    } else {
      throw new BadRequestException(
        `Ambiguous promotion: ${candidates.length} active Managers exist. ` +
          'Re-run with an explicit --email; no account was guessed.',
      );
    }

    return {
      dryRun: true,
      existingOwners,
      selected,
      candidates,
    };
  }

  async promote(input: {
    email?: string;
    dryRun: boolean;
    confirm: boolean;
  }): Promise<OwnerPromotionPreview> {
    const preview = await this.preview(input.email);
    if (input.dryRun) return preview;

    if (preview.existingOwners > 0)
      throw new ConflictException(
        'An OWNER already exists; refusing to promote another account',
      );
    if (!input.confirm)
      throw new BadRequestException(
        'Refusing to write without --confirm (dry-run is the default)',
      );
    const selected = preview.selected;
    if (!selected)
      throw new BadRequestException('No promotion candidate selected');

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.user.findFirst({
        where: { id: selected.id, role: Role.MANAGER, isActive: true },
        select: { id: true, role: true },
      });
      if (!current)
        throw new ConflictException(
          'The selected account is no longer an active MANAGER',
        );
      await tx.user.update({
        where: { id: selected.id },
        data: {
          role: Role.OWNER,
          authVersion: { increment: 1 },
        },
      });
      await tx.refreshToken.updateMany({
        where: { userId: selected.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorId: selected.id,
          action: 'OWNER_PROMOTE',
          entityType: 'User',
          entityId: selected.id,
          before: { role: Role.MANAGER },
          after: { role: Role.OWNER, system: true },
        },
      });
    });

    return { ...preview, dryRun: false };
  }
}
