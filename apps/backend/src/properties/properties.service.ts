import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApprovalStatus,
  DealType,
  Prisma,
  PropertyStatus,
} from '@prisma/client';
import { Role, type AuthUser } from '@arkan/shared';
import type { ReadStream } from 'node:fs';
import { PrismaService } from '../prisma/prisma.service';
import { ContactsService } from '../contacts/contacts.service';
import {
  capturePropertySnapshot,
  decodeRevisionPayload,
  diffPropertySnapshots,
  formatPropertyChanges,
  reviewRoundState,
  snapshotFromPropertyRow,
} from './property-changes';
import { FilesService, type UploadedImageFile } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { PropertyEventContext } from '../notifications/notification-events';
import { resolveLimit } from '../common/pagination';
import { toDecimal } from '../common/money';
import {
  assertNoPrivateContactInfo,
  UNKNOWN_LOCATION_SENTINEL,
} from '../common/text/public-text';
import { CreatePropertyPayloadDto } from './dto/create-property-payload.dto';
import { UpdatePropertyPayloadDto } from './dto/update-property-payload.dto';
import { ListPropertiesQueryDto } from './dto/list-properties.query';
import { ApprovePropertyDto } from './dto/approve-property.dto';
import { RejectPropertyDto } from './dto/reject-property.dto';
import { RequestChangesDto } from './dto/request-changes.dto';
import { PropertyFloorInputDto } from './dto/property-floor.dto';
import { RequestedPropertyInputDto } from './dto/requested-property.dto';
import { nextPropertyCode } from './property-reference';
import { propertyVisibilityWhere } from './property-visibility';
import {
  propertyDetailInclude,
  serializeProperty,
} from './property-serializer';
import type { PropertyPageDto, PropertyViewDto } from './property.dto';

const CURRENCY = 'KWD';

function trimOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function generatePropertyTitle(
  listingType: DealType,
  district: string | null,
  governorate: string | null,
): string {
  const operation =
    listingType === DealType.SALE
      ? 'بيع'
      : listingType === DealType.RENT
        ? 'إيجار'
        : 'بدل';
  const place = district ?? governorate;
  return place ? `عقار ${operation} - ${place}` : `عقار ${operation}`;
}

function budgetRangeError(
  input?: RequestedPropertyInputDto,
): string | null {
  if (!input?.budgetMin || !input?.budgetMax) return null;
  if (new Prisma.Decimal(input.budgetMin).gt(new Prisma.Decimal(input.budgetMax)))
    return 'budgetMin must not exceed budgetMax';
  return null;
}

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Creation
  // ---------------------------------------------------------------------------

  async create(
    viewer: AuthUser,
    payload: CreatePropertyPayloadDto,
    file?: UploadedImageFile,
  ): Promise<PropertyViewDto> {
    this.validateCreateShape(payload);
    const detected = this.files.assertValidImage(file);
    // Decode, strip every embedded metadata block (EXIF/GPS/XMP/IPTC) and re-encode
    // before anything touches durable storage. The original uploaded bytes are never
    // written. A failure here aborts the request before any Property, Contact or
    // FileAsset row can be created.
    const sanitized = await this.files.sanitizeImage(file!.buffer, detected);
    const key = await this.files.persistBytes(sanitized.buffer, sanitized);
    // The code is allocated from the DATABASE counter BEFORE the transaction:
    // the allocation is atomic (two employees can never receive the same code)
    // and a rolled-back creation leaves a gap, never a reused code.
    const reference = await this.generateUniqueReference();
    try {
      const propertyId = await this.prisma.$transaction(async (tx) => {
        const contact = await this.resolveContactInTx(tx, viewer, payload);
        const isEmployee = viewer.role === Role.EMPLOYEE;
        const district = trimOrNull(payload.district);
        const governorate = trimOrNull(payload.governorate);
        const property = await tx.property.create({
          data: {
            reference,
            title:
              trimOrNull(payload.title) ??
              generatePropertyTitle(payload.listingType, district, governorate),
            area: district ?? governorate ?? UNKNOWN_LOCATION_SENTINEL,
            address: trimOrNull(payload.address),
            governorate,
            district,
            block: trimOrNull(payload.block),
            plotNumber: trimOrNull(payload.plotNumber),
            sizeSqm: toDecimal(payload.sizeSqm, 'sizeSqm'),
            floorCount: payload.floorCount ?? null,
            askingPrice: toDecimal(payload.askingPrice, 'askingPrice'),
            negotiable: payload.negotiable ?? null,
            currency: CURRENCY,
            status: isEmployee
              ? PropertyStatus.PENDING
              : PropertyStatus.AVAILABLE,
            listingType: payload.listingType,
            description: trimOrNull(payload.description),
            contactId: contact.id,
            createdByUserId: viewer.id,
          },
        });
        if (payload.floors?.length)
          await this.insertFloors(tx, property.id, payload.floors);
        if (
          payload.listingType === DealType.EXCHANGE &&
          payload.requestedProperty
        )
          await tx.requestedProperty.create({
            data: {
              propertyId: property.id,
              ...this.mapRequested(payload.requestedProperty),
            },
          });
        const asset = await this.files.createAsset(tx, {
          key,
          mimeType: sanitized.mimeType,
          sizeBytes: sanitized.sizeBytes,
          uploadedById: viewer.id,
          propertyId: property.id,
        });
        await tx.property.update({
          where: { id: property.id },
          data: { primaryImageId: asset.id },
        });
        if (isEmployee)
          await tx.propertyApprovalRequest.create({
            data: {
              propertyId: property.id,
              requestedById: viewer.id,
              status: ApprovalStatus.PENDING,
            },
          });
        await tx.auditLog.create({
          data: {
            actorId: viewer.id,
            action: 'PROPERTY_CREATE',
            entityType: 'Property',
            entityId: property.id,
            after: {
              status: property.status,
              listingType: property.listingType,
            },
          },
        });
        // In-app notifications are written in THIS transaction, so they can never
        // announce a property that the transaction later rolls back. An employee
        // submission notifies the managers; a manager-created property is
        // AVAILABLE immediately, so it announces new stock to the employees.
        const eventContext: PropertyEventContext = {
          propertyId: property.id,
          reference: property.reference,
          creatorId: property.createdByUserId,
          approvalRequestId: null,
          version: property.version,
        };
        if (isEmployee)
          await this.notifications.notifyPropertySubmitted(tx, eventContext);
        else {
          await this.notifications.notifyPropertyAvailable(tx, eventContext);
          // A manager-created property is AVAILABLE immediately: this approved
          // snapshot is the baseline of every later comparison.
          const snapshot = await capturePropertySnapshot(tx, property.id);
          if (snapshot)
            await tx.propertyRevision.create({
              data: {
                propertyId: property.id,
                status: ApprovalStatus.APPROVED,
                payload: snapshot as unknown as Prisma.InputJsonValue,
                baseVersion: property.version,
                requestedById: viewer.id,
                reviewedById: viewer.id,
                reviewedAt: new Date(),
              },
            });
        }
        return property.id;
      });
      return await this.getAuthorizedDetail(viewer, propertyId);
    } catch (error) {
      // Compensate: a failed transaction must not leave image bytes on disk.
      await this.files.discard(key);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async list(
    viewer: AuthUser,
    query: ListPropertiesQueryDto,
  ): Promise<PropertyPageDto> {
    const limit = resolveLimit(query.limit);
    const search = query.q?.trim();
    // Every constraint lives in its own AND entry. The visibility filter for an
    // employee is itself a top-level `OR`, so spreading it next to a search
    // `OR` would silently REPLACE the row-level rule — composing via explicit
    // `AND` entries keeps RBAC intact whatever shape each filter takes.
    const filters: Prisma.PropertyWhereInput[] = [
      propertyVisibilityWhere(viewer),
    ];
    if (query.status) filters.push({ status: query.status });
    if (query.listingType) filters.push({ listingType: query.listingType });
    if (query.governorate) filters.push({ governorate: query.governorate });
    if (query.district) filters.push({ district: query.district });
    if (search) {
      // Free-text match over PUBLIC listing fields only (the full property
      // code among them). The search never touches the Contact table, and the
      // visibility entry above still decides what this viewer can see, so
      // RBAC and privacy are exactly as before.
      filters.push({
        OR: [
          // The code is searched with an INDEXED prefix match (the
          // `text_pattern_ops` index) plus a case-insensitive fallback, so
          // `A-0001` finds `A-000123` without scanning the table.
          { reference: { startsWith: search.trim().toUpperCase() } },
          { reference: { contains: search, mode: 'insensitive' } },
          { title: { contains: search, mode: 'insensitive' } },
          { area: { contains: search, mode: 'insensitive' } },
          { district: { contains: search, mode: 'insensitive' } },
          { governorate: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    // A single {AND: [visibility]} equals the visibility itself.
    const where =
      filters.length === 1 ? filters[0] : { AND: filters as Prisma.PropertyWhereInput[] };
    const rows = await this.prisma.property.findMany({
      where,
      include: propertyDetailInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: items.map((row) => serializeProperty(row, viewer)),
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    };
  }

  async findOne(viewer: AuthUser, id: string): Promise<PropertyViewDto> {
    return this.getAuthorizedDetail(viewer, id);
  }

  /**
   * Streams the primary image using the SAME visibility policy as the detail
   * endpoint, so an employee can never fetch the image of someone else's PENDING or
   * REJECTED property. Storage keys/paths are never returned.
   */
  async openImage(
    viewer: AuthUser,
    id: string,
  ): Promise<{ stream: ReadStream; mimeType: string; sizeBytes: number }> {
    const property = await this.prisma.property.findFirst({
      where: { id, ...propertyVisibilityWhere(viewer) },
      select: {
        primaryImage: {
          select: { key: true, mimeType: true, sizeBytes: true },
        },
      },
    });
    if (!property?.primaryImage)
      throw new NotFoundException('Image not found');
    const stream = await this.files.openImage(property.primaryImage);
    return {
      stream,
      mimeType: property.primaryImage.mimeType,
      sizeBytes: Number(property.primaryImage.sizeBytes),
    };
  }

  // ---------------------------------------------------------------------------
  // Manager review
  // ---------------------------------------------------------------------------

  async approve(
    viewer: AuthUser,
    id: string,
    dto: ApprovePropertyDto,
  ): Promise<PropertyViewDto> {
    const existing = await this.requireExisting(id);
    await this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.property.updateMany({
        where: {
          id,
          status: PropertyStatus.PENDING,
          ...(dto.version ? { version: dto.version } : {}),
        },
        data: { status: PropertyStatus.AVAILABLE, version: { increment: 1 } },
      });
      if (transitioned.count === 0)
        throw new ConflictException(
          'The property is no longer PENDING or the version is stale',
        );
      // A property that was left PENDING while its latest review is
      // CHANGES_REQUESTED must NOT be approved until the creator resubmits.
      const latest = await tx.propertyApprovalRequest.findFirst({
        where: { propertyId: id },
        orderBy: { createdAt: 'desc' },
      });
      if (latest && latest.status !== ApprovalStatus.PENDING)
        throw new ConflictException(
          'The review is no longer awaiting a manager decision',
        );
      if (latest) {
        const decided = await tx.propertyApprovalRequest.updateMany({
          where: { id: latest.id, status: ApprovalStatus.PENDING },
          data: {
            status: ApprovalStatus.APPROVED,
            reviewedById: viewer.id,
            reviewedAt: new Date(),
          },
        });
        if (decided.count === 0)
          throw new ConflictException(
            'The review is no longer awaiting a manager decision',
          );
      }
      await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action: 'PROPERTY_APPROVE',
          entityType: 'Property',
          entityId: id,
          after: { status: PropertyStatus.AVAILABLE },
        },
      });
      // Approval produces two distinct events: the creator learns the decision,
      // and the OTHER employees learn that a new property entered the program.
      //
      // The approved snapshot is recorded (the already existing
      // `PropertyRevision` table), so the NEXT approval round can compare the
      // version that was in the program with the one that is approved now and
      // report the fields that really changed.
      // The baseline is the review round's stored pre-edit state — the exact
      // state the manager was shown when the property was sent back for
      // review — so the creator and the other employees receive the SAME
      // verified changes at approval time.
      const round = await reviewRoundState(tx, id, existing);
      const baseline = round.baseline;
      // A staged replacement image becomes the property's public image NOW —
      // at the manager's approval, never before it.
      if (round.pendingImageId) {
        await tx.property.update({
          where: { id },
          data: { primaryImageId: round.pendingImageId },
        });
      }
      const snapshot = await capturePropertySnapshot(tx, id);
      const changes =
        baseline && snapshot ? diffPropertySnapshots(baseline, snapshot) : [];
      if (snapshot) {
        const approvedData = {
          status: ApprovalStatus.APPROVED,
          payload: snapshot as unknown as Prisma.InputJsonValue,
          baseVersion: existing.version + 1,
          reviewedById: viewer.id,
          reviewedAt: new Date(),
        };
        if (round.roundRevisionId) {
          // Close the review round: the row that CARRIED it (its baseline and
          // any staged image) becomes this round's approved record. There is
          // exactly one row per round, and no second PENDING row is ever left
          // behind — the database allows only one PENDING revision per
          // property, so leaving it open would break the NEXT edit cycle.
          await tx.propertyRevision.update({
            where: { id: round.roundRevisionId },
            data: approvedData,
          });
        } else {
          // No open round row (e.g. a manager-created property or a legacy
          // record): the approved snapshot starts the revision history.
          await tx.propertyRevision.create({
            data: {
              propertyId: id,
              requestedById: existing.createdByUserId ?? viewer.id,
              ...approvedData,
            },
          });
        }
      }
      // A property that was already approved before (an earlier review round)
      // is not new stock: the alert describes the change instead.
      const priorRound = await tx.propertyApprovalRequest.findFirst({
        where: {
          propertyId: id,
          status: ApprovalStatus.APPROVED,
          ...(latest?.id ? { id: { not: latest.id } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      const eventContext: PropertyEventContext = {
        propertyId: id,
        reference: existing.reference,
        creatorId: existing.createdByUserId,
        approvalRequestId: latest?.id ?? null,
        version: existing.version + 1,
        availabilityKind: priorRound ? 'UPDATED' : 'NEW',
        ...(changes.length
          ? { changeSummary: formatPropertyChanges(changes) }
          : {}),
      };
      await this.notifications.notifyPropertyApproved(tx, eventContext);
      await this.notifications.notifyPropertyAvailable(tx, eventContext);
    });
    return this.getAuthorizedDetail(viewer, id);
  }

  async reject(
    viewer: AuthUser,
    id: string,
    dto: RejectPropertyDto,
  ): Promise<PropertyViewDto> {
    const reason = dto.reason.trim();
    if (!reason)
      throw new BadRequestException('A rejection reason is required');
    const existing = await this.requireExisting(id);
    await this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.property.updateMany({
        where: {
          id,
          status: PropertyStatus.PENDING,
          ...(dto.version ? { version: dto.version } : {}),
        },
        data: { status: PropertyStatus.REJECTED, version: { increment: 1 } },
      });
      if (transitioned.count === 0)
        throw new ConflictException(
          'The property is no longer PENDING or the version is stale',
        );
      // Close this round's revision carrier. Leaving it PENDING would break
      // the property's NEXT edit cycle: the database allows only one PENDING
      // revision per property, so a review round must never linger after its
      // decision. The row keeps its baseline payload and is inert afterwards.
      await tx.propertyRevision.updateMany({
        where: { propertyId: id, status: ApprovalStatus.PENDING },
        data: {
          status: ApprovalStatus.REJECTED,
          reviewedById: viewer.id,
          reviewedAt: new Date(),
        },
      });
      // The latest review must still be awaiting a decision. This blocks a
      // reject of a request that was already answered (e.g. CHANGES_REQUESTED)
      // so Request Changes and Reject can never both fire on one submission.
      const latest = await tx.propertyApprovalRequest.findFirst({
        where: { propertyId: id },
        orderBy: { createdAt: 'desc' },
      });
      if (latest && latest.status !== ApprovalStatus.PENDING)
        throw new ConflictException(
          'The review is no longer awaiting a manager decision',
        );
      let approvalRequestId: string;
      if (latest) {
        const decided = await tx.propertyApprovalRequest.updateMany({
          where: { id: latest.id, status: ApprovalStatus.PENDING },
          data: {
            status: ApprovalStatus.REJECTED,
            notes: reason,
            reviewedById: viewer.id,
            reviewedAt: new Date(),
          },
        });
        if (decided.count === 0)
          throw new ConflictException(
            'The review is no longer awaiting a manager decision',
          );
        approvalRequestId = latest.id;
      } else {
        // Keep rejection history even if no pending request row existed.
        const created = await tx.propertyApprovalRequest.create({
          data: {
            propertyId: id,
            requestedById: viewer.id,
            status: ApprovalStatus.REJECTED,
            notes: reason,
            reviewedById: viewer.id,
            reviewedAt: new Date(),
          },
        });
        approvalRequestId = created.id;
      }
      await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action: 'PROPERTY_REJECT',
          entityType: 'Property',
          entityId: id,
          after: { status: PropertyStatus.REJECTED },
        },
      });
      // Only the creator is told about a rejection, and only in the same
      // transaction that recorded it. The manager's free-text reason is NEVER
      // copied into the notification.
      await this.notifications.notifyPropertyRejected(tx, {
        propertyId: id,
        reference: existing.reference,
        creatorId: existing.createdByUserId,
        approvalRequestId,
        version: existing.version + 1,
      });
    });
    return this.getAuthorizedDetail(viewer, id);
  }

  /**
   * Manager asks the creator to change something. This is NOT a rejection:
   * - `Property.status` stays PENDING (only the creator/manager can still see it).
   * - the current creation approval becomes CHANGES_REQUESTED and keeps the
   *   manager's instructions in its existing `notes` field;
   * - the property version is incremented so the manager's next decision needs a
   *   fresh read;
   * - the row must not be decidable again until the creator resubmits.
   */
  async requestChanges(
    viewer: AuthUser,
    id: string,
    dto: RequestChangesDto,
  ): Promise<PropertyViewDto> {
    const reason = dto.reason?.trim();
    if (!reason)
      throw new BadRequestException('Instructions for changes are required');
    const existing = await this.requireExisting(id);
    await this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.property.updateMany({
        where: {
          id,
          status: PropertyStatus.PENDING,
          ...(dto.version ? { version: dto.version } : {}),
        },
        // Status intentionally unchanged: the property is still PENDING.
        data: { version: { increment: 1 } },
      });
      if (transitioned.count === 0)
        throw new ConflictException(
          'The property is no longer PENDING or the version is stale',
        );
      const latest = await tx.propertyApprovalRequest.findFirst({
        where: { propertyId: id },
        orderBy: { createdAt: 'desc' },
      });
      if (!latest || latest.status !== ApprovalStatus.PENDING)
        throw new ConflictException(
          'The review is no longer awaiting a manager decision',
        );
      const requested = await tx.propertyApprovalRequest.updateMany({
        where: { id: latest.id, status: ApprovalStatus.PENDING },
        data: {
          status: ApprovalStatus.CHANGES_REQUESTED,
          notes: reason,
          reviewedById: viewer.id,
          reviewedAt: new Date(),
        },
      });
      if (requested.count === 0)
        throw new ConflictException(
          'The review is no longer awaiting a manager decision',
        );
      // Audit stores only the state transition — never the free-text reason or
      // any private contact data (the instructions live on the approval row).
      await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action: 'PROPERTY_REQUEST_CHANGES',
          entityType: 'Property',
          entityId: id,
          after: {
            status: PropertyStatus.PENDING,
            reviewStatus: ApprovalStatus.CHANGES_REQUESTED,
          },
        },
      });
      // "Request changes" is deliberately NOT a rejection, so the creator gets
      // the correction wording (never «تم رفض العقار»). The instructions stay on
      // the approval row and are not copied into the notification.
      await this.notifications.notifyPropertyChangesRequested(tx, {
        propertyId: id,
        reference: existing.reference,
        creatorId: existing.createdByUserId,
        approvalRequestId: latest.id,
        version: existing.version + 1,
      });
    });
    return this.getAuthorizedDetail(viewer, id);
  }

  // ---------------------------------------------------------------------------
  // Creator correction + resubmission
  // ---------------------------------------------------------------------------

  async update(
    viewer: AuthUser,
    id: string,
    payload: UpdatePropertyPayloadDto,
    file?: UploadedImageFile,
  ): Promise<PropertyViewDto> {
    const existing = await this.requireExisting(id);
    // `createdByUserId` is the server-authoritative owner of the row: an
    // employee can never edit a property created by someone else, not even by
    // guessing the id. The conflicting states answer 403 here (not 404) because
    // the id is real and the caller is authenticated — the row's existence is
    // not a secret from its own non-creator in this path.
    if (existing.createdByUserId !== viewer.id)
      throw new ForbiddenException(
        'Only the property creator can edit this property',
      );
    if (
      existing.status !== PropertyStatus.PENDING &&
      existing.status !== PropertyStatus.REJECTED &&
      existing.status !== PropertyStatus.AVAILABLE
    )
      throw new ConflictException(
        'Only PENDING, REJECTED or AVAILABLE properties can be edited',
      );
    if (existing.version !== payload.version)
      throw new ConflictException(
        'Stale version: the property changed since it was loaded',
      );
    this.validateUpdateShape(payload, existing.listingType);
    // Editing an APPROVED row sends it back through review: the row becomes
    // PENDING and a NEW approval round starts. Editing a PENDING/REJECTED row
    // keeps its current status (the creator still resubmits explicitly).
    const returnsToReview = existing.status === PropertyStatus.AVAILABLE;

    // A replacement image travels with the edit. It is sanitized and stored
    // BEFORE the transaction (exactly like a creation) and compensated — the
    // bytes are discarded — when the transaction does not commit, so a failed
    // save never leaves an orphaned file and never touches the approved image.
    let staged: {
      key: string;
      mimeType: string;
      sizeBytes: number;
    } | null = null;
    if (file) {
      const detected = this.files.assertValidImage(file);
      const sanitized = await this.files.sanitizeImage(file.buffer, detected);
      staged = {
        key: await this.files.persistBytes(sanitized.buffer, sanitized),
        mimeType: sanitized.mimeType,
        sizeBytes: sanitized.sizeBytes,
      };
    }

    try {
      await this.prisma.$transaction(async (tx) => {
      const data: Prisma.PropertyUncheckedUpdateManyInput = {
        version: { increment: 1 },
      };
      if (payload.title !== undefined) data.title = payload.title.trim();
      if (payload.governorate !== undefined)
        data.governorate = trimOrNull(payload.governorate);
      if (payload.district !== undefined)
        data.district = trimOrNull(payload.district);
      if (payload.block !== undefined) data.block = trimOrNull(payload.block);
      if (payload.plotNumber !== undefined)
        data.plotNumber = trimOrNull(payload.plotNumber);
      if (payload.address !== undefined)
        data.address = trimOrNull(payload.address);
      if (payload.sizeSqm !== undefined)
        data.sizeSqm = toDecimal(payload.sizeSqm, 'sizeSqm');
      if (payload.floorCount !== undefined)
        data.floorCount = payload.floorCount;
      if (payload.askingPrice !== undefined)
        data.askingPrice = toDecimal(payload.askingPrice, 'askingPrice');
      if (payload.negotiable !== undefined)
        data.negotiable = payload.negotiable ?? null;
      if (payload.description !== undefined)
        data.description = trimOrNull(payload.description);
      if (payload.listingType !== undefined)
        data.listingType = payload.listingType;
      if (
        payload.district !== undefined ||
        payload.governorate !== undefined
      ) {
        const nextDistrict =
          payload.district !== undefined
            ? trimOrNull(payload.district)
            : existing.district;
        const nextGovernorate =
          payload.governorate !== undefined
            ? trimOrNull(payload.governorate)
            : existing.governorate;
        data.area =
          nextDistrict ?? nextGovernorate ?? UNKNOWN_LOCATION_SENTINEL;
      }
      if (payload.newContact) {
        const contact = await tx.contact.create({
          data: {
            type: payload.newContact.type,
            name: payload.newContact.name.trim(),
            phone: payload.newContact.phone.trim(),
            notes: trimOrNull(payload.newContact.notes),
            responsibleUserId:
              viewer.role === Role.EMPLOYEE ? viewer.id : null,
          },
        });
        data.contactId = contact.id;
      } else if (payload.contactId) {
        const contact = await this.contacts.requireUsableContact(
          viewer,
          payload.contactId,
          tx,
        );
        data.contactId = contact.id;
      }

      // The baseline of this edit is the state the program shows NOW — captured
      // BEFORE the row and its floors are rewritten, so the floors are part of
      // it. It is stored with the review round, so the later approval can
      // report exactly the same verified changes.
      const baseline =
        (await capturePropertySnapshot(tx, id)) ??
        snapshotFromPropertyRow(existing);

      const transitioned = await tx.property.updateMany({
        where: {
          id,
          createdByUserId: viewer.id,
          status: existing.status,
          version: payload.version,
        },
        data: returnsToReview
          ? { ...data, status: PropertyStatus.PENDING }
          : data,
      });
      if (transitioned.count === 0)
        throw new ConflictException('Stale version or invalid state');
      if (payload.floors !== undefined) {
        await tx.propertyFloor.deleteMany({ where: { propertyId: id } });
        if (payload.floors.length)
          await this.insertFloors(tx, id, payload.floors);
      }

      const nextListing = payload.listingType ?? existing.listingType;
      if (nextListing === DealType.EXCHANGE) {
        if (payload.requestedProperty) {
          const mapped = this.mapRequested(payload.requestedProperty);
          await tx.requestedProperty.upsert({
            where: { propertyId: id },
            create: { propertyId: id, ...mapped },
            update: mapped,
          });
        }
      } else {
        await tx.requestedProperty.deleteMany({ where: { propertyId: id } });
      }

      if (returnsToReview) {
        // A fresh review round: the previous APPROVED request row stays
        // untouched, so the approval history is preserved and the manager sees
        // exactly one open request per submission.
        const request = await tx.propertyApprovalRequest.create({
          data: {
            propertyId: id,
            requestedById: viewer.id,
            status: ApprovalStatus.PENDING,
          },
        });
        // The manager must know WHAT changed before deciding. The baseline is
        // the state the program showed BEFORE this edit, and it is stored WITH
        // the review round, so the later approval reports the SAME verified
        // changes to the creator and to the other employees.
        const submitted = await capturePropertySnapshot(tx, id);
        // A replacement image is STAGED with the review round: it becomes the
        // property's public image only when the manager approves the edit.
        let pendingImageId: string | null = null;
        if (staged) {
          const asset = await this.files.createAsset(tx, {
            key: staged.key,
            mimeType: staged.mimeType,
            sizeBytes: staged.sizeBytes,
            uploadedById: viewer.id,
            propertyId: id,
          });
          pendingImageId = asset.id;
        }
        const effective = submitted
          ? {
              ...submitted,
              primaryImageId: pendingImageId ?? submitted.primaryImageId,
            }
          : null;
        const changes = effective
          ? diffPropertySnapshots(baseline, effective)
          : [];
        // The database allows only ONE PENDING revision per property (a
        // partial unique index). The open round's row is the round CARRIER:
        // a property edited again (a later round) REUSES that row with the
        // current edit's baseline instead of creating a second PENDING row —
        // which used to fail the unique constraint on the second cycle.
        const openRound = await tx.propertyRevision.findFirst({
          where: { propertyId: id, status: ApprovalStatus.PENDING },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        const roundPayload = {
          baseline: baseline as unknown as Prisma.InputJsonValue,
          pendingImageId,
        } as unknown as Prisma.InputJsonValue;
        if (openRound) {
          await tx.propertyRevision.update({
            where: { id: openRound.id },
            data: {
              payload: roundPayload,
              baseVersion: existing.version,
              requestedById: viewer.id,
            },
          });
        } else {
          await tx.propertyRevision.create({
            data: {
              propertyId: id,
              status: ApprovalStatus.PENDING,
              payload: roundPayload,
              baseVersion: existing.version,
              requestedById: viewer.id,
            },
          });
        }
        await this.notifications.notifyPropertyResubmitted(tx, {
          propertyId: id,
          reference: existing.reference,
          creatorId: existing.createdByUserId,
          approvalRequestId: request.id,
          version: existing.version + 1,
          ...(changes.length
            ? {
                submissionKind: 'UPDATED' as const,
                changeSummary: formatPropertyChanges(changes),
              }
            : {}),
        });
      } else if (staged) {
        // The row is not sent back through review (a PENDING row keeps its open
        // round, a REJECTED one has none): a replacement image is only ever
        // applied with a manager's decision.
        if (existing.status === PropertyStatus.PENDING) {
          // The open round carries the staged image, so the manager decides it
          // together with the rest of the row.
          const openRound = await tx.propertyRevision.findFirst({
            where: { propertyId: id, status: ApprovalStatus.PENDING },
            orderBy: { createdAt: 'desc' },
            select: { id: true, payload: true },
          });
          const state = decodeRevisionPayload(openRound?.payload);
          const asset = await this.files.createAsset(tx, {
            key: staged.key,
            mimeType: staged.mimeType,
            sizeBytes: staged.sizeBytes,
            uploadedById: viewer.id,
            propertyId: id,
          });
          const payload = {
            baseline: (state.baseline ??
              baseline) as unknown as Prisma.InputJsonValue,
            pendingImageId: asset.id,
          } as unknown as Prisma.InputJsonValue;
          if (openRound) {
            await tx.propertyRevision.update({
              where: { id: openRound.id },
              data: { payload },
            });
          } else {
            await tx.propertyRevision.create({
              data: {
                propertyId: id,
                status: ApprovalStatus.PENDING,
                payload,
                baseVersion: existing.version,
                requestedById: viewer.id,
              },
            });
          }
          staged = null;
        }
        if (staged) {
          // No open round: the replacement is not applied and its bytes are
          // discarded (the approved image stays exactly as it is).
          await this.files.discard(staged.key);
          staged = null;
        }
      }

      await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action: 'PROPERTY_UPDATE',
          entityType: 'Property',
          entityId: id,
          after: {
            status: returnsToReview ? PropertyStatus.PENDING : existing.status,
          },
        },
      });
    });
    } catch (error) {
      // A failed save never leaves the replacement behind, and the approved
      // image stays exactly as it was.
      if (staged) await this.files.discard(staged.key);
      throw error;
    }
    return this.getAuthorizedDetail(viewer, id);
  }

  async resubmit(viewer: AuthUser, id: string): Promise<PropertyViewDto> {
    const existing = await this.requireExisting(id);
    if (existing.createdByUserId !== viewer.id)
      throw new ForbiddenException(
        'Only the property creator can resubmit this property',
      );
    // Two allowed source states:
    //   A) REJECTED                           → back to PENDING;
    //   B) PENDING with a CHANGES_REQUESTED latest review → back to review.
    if (existing.status === PropertyStatus.PENDING) {
      const latest = await this.prisma.propertyApprovalRequest.findFirst({
        where: { propertyId: id },
        orderBy: { createdAt: 'desc' },
      });
      if (latest?.status !== ApprovalStatus.CHANGES_REQUESTED)
        throw new ConflictException(
          'This property is already awaiting manager review',
        );
    } else if (existing.status !== PropertyStatus.REJECTED) {
      throw new ConflictException(
        'Only REJECTED properties or properties with requested changes can be resubmitted',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.property.updateMany({
        where: {
          id,
          createdByUserId: viewer.id,
          status: existing.status,
        },
        data: { status: PropertyStatus.PENDING, version: { increment: 1 } },
      });
      if (transitioned.count === 0)
        throw new ConflictException(
          'The property is no longer awaiting correction',
        );
      // Re-read inside the transaction: for a PENDING row the property-level
      // guard above does not change (PENDING → PENDING), so this read — taken
      // after the row lock serialises concurrent resubmissions — is what makes a
      // duplicate resubmission of a CHANGES_REQUESTED row return 409.
      if (existing.status === PropertyStatus.PENDING) {
        const latest = await tx.propertyApprovalRequest.findFirst({
          where: { propertyId: id },
          orderBy: { createdAt: 'desc' },
        });
        if (latest?.status !== ApprovalStatus.CHANGES_REQUESTED)
          throw new ConflictException(
            'This property is already awaiting manager review',
          );
      }
      // Preserve review history: a NEW pending request is created while the
      // previous REJECTED / CHANGES_REQUESTED request row remains untouched.
      const request = await tx.propertyApprovalRequest.create({
        data: {
          propertyId: id,
          requestedById: viewer.id,
          status: ApprovalStatus.PENDING,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action: 'PROPERTY_RESUBMIT',
          entityType: 'Property',
          entityId: id,
          after: { status: PropertyStatus.PENDING },
        },
      });
      // Managers are notified only here — a correction merely SAVED (update)
      // notifies nobody until the employee actually resubmits.
      await this.notifications.notifyPropertyResubmitted(tx, {
        propertyId: id,
        reference: existing.reference,
        creatorId: existing.createdByUserId,
        approvalRequestId: request.id,
        version: existing.version + 1,
      });
    });
    return this.getAuthorizedDetail(viewer, id);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async getAuthorizedDetail(
    viewer: AuthUser,
    id: string,
  ): Promise<PropertyViewDto> {
    const property = await this.prisma.property.findFirst({
      where: { id, ...propertyVisibilityWhere(viewer) },
      include: propertyDetailInclude,
    });
    if (!property) throw new NotFoundException('Property not found');
    return serializeProperty(property, viewer);
  }

  private async requireExisting(id: string) {
    const property = await this.prisma.property.findUnique({ where: { id } });
    if (!property) throw new NotFoundException('Property not found');
    return property;
  }

  private validateCreateShape(payload: CreatePropertyPayloadDto): void {
    const hasExisting = payload.contactId !== undefined;
    const hasNew = payload.newContact !== undefined;
    if (hasExisting === hasNew)
      throw new BadRequestException(
        'Provide exactly one of contactId or newContact',
      );
    if (
      payload.listingType !== DealType.EXCHANGE &&
      payload.requestedProperty !== undefined
    )
      throw new BadRequestException(
        'requestedProperty is only allowed for EXCHANGE listings',
      );
    const budget = budgetRangeError(payload.requestedProperty);
    if (budget) throw new BadRequestException(budget);
    assertNoPrivateContactInfo(payload.description ?? null, 'description');
    payload.floors?.forEach((floor, index) =>
      assertNoPrivateContactInfo(floor.details ?? null, `floors[${index}].details`),
    );
    if (payload.requestedProperty) {
      assertNoPrivateContactInfo(
        payload.requestedProperty.notes ?? null,
        'requestedProperty.notes',
      );
      assertNoPrivateContactInfo(
        payload.requestedProperty.floorRequirements ?? null,
        'requestedProperty.floorRequirements',
      );
    }
  }

  private validateUpdateShape(
    payload: UpdatePropertyPayloadDto,
    currentListingType: DealType,
  ): void {
    if (payload.contactId !== undefined && payload.newContact !== undefined)
      throw new BadRequestException(
        'Provide at most one of contactId or newContact',
      );
    const listingType = payload.listingType ?? currentListingType;
    if (
      listingType !== DealType.EXCHANGE &&
      payload.requestedProperty !== undefined
    )
      throw new BadRequestException(
        'requestedProperty is only allowed for EXCHANGE listings',
      );
    const budget = budgetRangeError(payload.requestedProperty);
    if (budget) throw new BadRequestException(budget);
    assertNoPrivateContactInfo(payload.description ?? null, 'description');
    payload.floors?.forEach((floor, index) =>
      assertNoPrivateContactInfo(floor.details ?? null, `floors[${index}].details`),
    );
    if (payload.requestedProperty) {
      assertNoPrivateContactInfo(
        payload.requestedProperty.notes ?? null,
        'requestedProperty.notes',
      );
      assertNoPrivateContactInfo(
        payload.requestedProperty.floorRequirements ?? null,
        'requestedProperty.floorRequirements',
      );
    }
  }

  private async resolveContactInTx(
    tx: Prisma.TransactionClient,
    viewer: AuthUser,
    payload: CreatePropertyPayloadDto,
  ) {
    if (payload.newContact)
      return tx.contact.create({
        data: {
          type: payload.newContact.type,
          name: payload.newContact.name.trim(),
          phone: payload.newContact.phone.trim(),
          notes: trimOrNull(payload.newContact.notes),
          responsibleUserId: viewer.role === Role.EMPLOYEE ? viewer.id : null,
        },
      });
    return this.contacts.requireUsableContact(
      viewer,
      payload.contactId as string,
      tx,
    );
  }

  private insertFloors(
    tx: Prisma.TransactionClient,
    propertyId: string,
    floors: PropertyFloorInputDto[],
  ): Promise<Prisma.BatchPayload> {
    return tx.propertyFloor.createMany({
      data: floors.map((floor, index) => ({
        propertyId,
        type: floor.type,
        customLabel: trimOrNull(floor.customLabel),
        details: trimOrNull(floor.details),
        sortOrder: floor.sortOrder ?? index,
      })),
    });
  }

  private mapRequested(input: RequestedPropertyInputDto) {
    return {
      governorate: trimOrNull(input.governorate),
      district: trimOrNull(input.district),
      block: trimOrNull(input.block),
      plotNumber: trimOrNull(input.plotNumber),
      sizeSqm: toDecimal(input.sizeSqm, 'requestedProperty.sizeSqm'),
      floorRequirements: trimOrNull(input.floorRequirements),
      notes: trimOrNull(input.notes),
      budgetMin: toDecimal(input.budgetMin, 'requestedProperty.budgetMin'),
      budgetMax: toDecimal(input.budgetMax, 'requestedProperty.budgetMax'),
    };
  }

  private async generateUniqueReference(): Promise<string> {
    // The code is allocated from the DATABASE counter BEFORE the property
    // transaction: the allocation is atomic (no two employees can receive the
    // same code) and a rolled-back creation leaves a gap, never a reused code.
    return nextPropertyCode(this.prisma);
  }
}
