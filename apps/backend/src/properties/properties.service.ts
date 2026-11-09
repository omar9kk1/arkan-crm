import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApprovalStatus,
  ContactType,
  DealType,
  NotificationType,
  Prisma,
  PropertyStatus,
} from '@prisma/client';
import { Role, type AuthUser } from '@arkan/shared';
import { createHash } from 'node:crypto';
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
  type PropertyChange,
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
import {
  allocateOfficialCode,
  nextSubmissionCode,
} from './property-reference';
import { propertyVisibilityWhere } from './property-visibility';
import {
  assertPropertyReviewPermission,
  isOwner,
  reviewNotificationRecipientIds,
} from '../common/access/access-policy';
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

function normalizeText(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  let v = String(value).trim().toLowerCase();
  v = v.replace(/\s+/g, ' ');
  v = v.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
  v = v.replace(/[أإآ]/g, 'ا');
  v = v.replace(/ة/g, 'ه');
  v = v.replace(/ى/g, 'ي');
  v = v.replace(/[،,.;:!?()[\]{}«»"'’“”]/g, '');
  v = v.replace(/\s+/g, ' ').trim();
  return v;
}

function normalizePhone(value: string | null | undefined): string {
  if (!value) return '';
  const ascii = String(value).replace(/[٠-٩]/g, (digit) =>
    String(digit.charCodeAt(0) - 0x0660),
  );
  return ascii.replace(/\D/g, '');
}

function normalizeNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  // Whitespace is missing, not numeric zero. A real `0` / `'0'` stays a value.
  if (typeof value === 'string' && value.trim() === '') return '';
  const n = Number(value);
  if (isNaN(n)) return normalizeText(String(value));
  return String(n);
}

/**
 * A client-generated operation id for `POST /properties`. Only a bounded,
 * URL-safe token is accepted; anything else is treated as "no idempotency key"
 * so a malformed header can never break a submission.
 */
function normalizeIdempotencyKey(
  value: string | null | undefined,
): string | null {
  const key = (value ?? '').trim();
  if (key.length < 8 || key.length > 128) return null;
  return /^[A-Za-z0-9._:-]+$/.test(key) ? key : null;
}

/**
 * Stable content fingerprint of a blocked attempt. It covers the real house
 * identifiers (location, block/plot, address), the owner identifiers and the
 * main physical attributes. Same content => same fingerprint (deduplicated
 * manager alert); a materially changed attempt => a new fingerprint.
 */
function duplicateAttemptFingerprint(input: {
  governorate?: string | null;
  district?: string | null;
  block?: string | null;
  plotNumber?: string | null;
  address?: string | null;
  ownerName?: string | null;
  ownerPhone?: string | null;
  sizeSqm?: string | null;
  floorCount?: number | null;
  listingType: string;
}): string {
  const parts = [
    normalizeText(input.governorate),
    normalizeText(input.district),
    normalizeText(input.block),
    normalizeText(input.plotNumber),
    normalizeText(input.address),
    normalizeText(input.ownerName),
    normalizePhone(input.ownerPhone),
    normalizeNumber(input.sizeSqm),
    input.floorCount === null || input.floorCount === undefined
      ? ''
      : String(input.floorCount),
    normalizeText(input.listingType),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 20);
}

interface CreatePropertyOutcome {
  confirmed: boolean;
  matchedProperty: {
    id: string;
    reference: string;
    status: PropertyStatus;
  } | null;
  propertyId: string | null;
  /** True when this request replayed an earlier committed outcome. */
  replayed?: boolean;
}

function resolveIdentity(payload: {
  governorate?: string | null;
  district?: string | null;
  block?: string | null;
  plotNumber?: string | null;
  address?: string | null;
}): { lockKey: string | null; where: { governorate?: string; district?: string }; incomplete: boolean } {
  const gov = trimOrNull(payload.governorate);
  const dist = trimOrNull(payload.district);
  const block = trimOrNull(payload.block);
  const plot = trimOrNull(payload.plotNumber);
  const addr = trimOrNull(payload.address);
  const parts = [
    normalizeText(gov),
    normalizeText(dist),
    normalizeText(block),
    normalizeText(plot),
    normalizeText(addr),
  ].filter(Boolean);
  const lockKey = parts.length ? parts.join('|') : null;
  const incomplete = !plot && !addr;
  const where: { governorate?: string; district?: string } = {};
  if (gov) where.governorate = gov;
  if (dist) where.district = dist;
  return { lockKey, where, incomplete };
}

const ACTIVE_DUPLICATE_STATUSES: PropertyStatus[] = [
  PropertyStatus.PENDING,
  PropertyStatus.AVAILABLE,
  PropertyStatus.SOLD,
  PropertyStatus.RENTED,
];

export function classifyDuplicate(
  existing: {
    governorate: string | null;
    district: string | null;
    block: string | null;
    plotNumber: string | null;
    address: string | null;
    sizeSqm: unknown;
    floorCount: number | null;
    listingType: string;
    description?: string | null;
    contact: { name: string; phone: string } | null;
    floors: { type: string; details: string | null }[];
  },
  payload: {
    governorate?: string | null;
    district?: string | null;
    block?: string | null;
    plotNumber?: string | null;
    address?: string | null;
    sizeSqm?: string | null;
    floorCount?: number | null;
    listingType: string;
    description?: string | null;
    newContact?: { name: string; phone: string } | null;
    contactId?: string | null;
    floors?: { type: string; details?: string | null }[] | null;
  },
  ownerName?: string | null,
  ownerPhone?: string | null,
): 'CONFIRMED' | 'POTENTIAL' | 'DISTINCT' {
  const exGov = normalizeText(existing.governorate);
  const exDist = normalizeText(existing.district);
  const exBlock = normalizeText(existing.block);
  const exPlot = normalizeText(existing.plotNumber);
  const exAddr = normalizeText(existing.address);

  const newGov = normalizeText(payload.governorate);
  const newDist = normalizeText(payload.district);
  const newBlock = normalizeText(payload.block);
  const newPlot = normalizeText(payload.plotNumber);
  const newAddr = normalizeText(payload.address);

  // --- Governorate and district must match for any similarity ---
  // Different explicit locations are an authoritative contradiction. A missing
  // side is NOT evidence on its own and never counts as a match.
  if (exGov && newGov && exGov !== newGov) return 'DISTINCT';
  if (exDist && newDist && exDist !== newDist) return 'DISTINCT';

  // --- STRONG PHYSICAL IDENTITY checks ---
  // `identityConflict` is set when an authoritative identifier is present on
  // both sides but disagrees. In that case the result can NEVER be CONFIRMED
  // based on softer similarity; it may still be POTENTIAL if enough
  // independent supporting evidence exists.
  let identityConflict = false;

  // If BOTH block and plot are present on both sides:
  if (exBlock && newBlock && exPlot && newPlot) {
    if (exBlock === newBlock && exPlot === newPlot) {
      return 'CONFIRMED'; // exact physical identity
    }
    // A different plot number is an authoritative contradiction.
    if (exPlot !== newPlot) {
      return 'DISTINCT';
    }
    // Same plot number but different block: identity is NOT confirmed, but
    // similarity analysis must continue (do not short-circuit).
    identityConflict = true;
  }

  // If address is present on both sides:
  if (exAddr && newAddr) {
    if (exAddr === newAddr) {
      return 'CONFIRMED'; // exact address match
    }
    return 'DISTINCT'; // different address is an authoritative contradiction
  }

  // --- Partial identity: at least one strong field is missing ---
  const plotMatch = !!(exPlot && newPlot && exPlot === newPlot);
  const blockMatch = !!(exBlock && newBlock && exBlock === newBlock);
  const blockConflict = !!(exBlock && newBlock && exBlock !== newBlock);

  // A different plot number is an authoritative contradiction, including when
  // the block is missing on one/both sides.
  if (exPlot && newPlot && exPlot !== newPlot) return 'DISTINCT';

  // Owner evidence. Missing values are never treated as a match.
  const exOwner = normalizeText(existing.contact?.name);
  const newOwner = normalizeText(ownerName ?? payload.newContact?.name);
  const ownerNameMatch = !!(exOwner && newOwner && exOwner === newOwner);
  const exPhone = normalizePhone(existing.contact?.phone);
  const newPhone = normalizePhone(ownerPhone ?? payload.newContact?.phone);
  const ownerPhoneMatch = !!(exPhone && newPhone && exPhone === newPhone);

  // Area / floors: real values only (numeric zero stays a real value).
  const exArea = normalizeNumber(existing.sizeSqm as string | number | null);
  const newArea = normalizeNumber(payload.sizeSqm);
  const areaMatch = !!(exArea && newArea && exArea === newArea);
  const floorCountMatch =
    existing.floorCount !== null &&
    payload.floorCount !== undefined &&
    payload.floorCount !== null &&
    existing.floorCount === payload.floorCount;
  const exFloorTypes = existing.floors.map((f) => f.type).sort().join(',');
  const newFloorTypes = (payload.floors ?? [])
    .map((f) => f.type)
    .sort()
    .join(',');
  const floorTypesMatch = !!(
    exFloorTypes &&
    newFloorTypes &&
    exFloorTypes === newFloorTypes
  );
  let floorDetailsMatch = false;
  if (
    floorTypesMatch &&
    existing.floors.length > 0 &&
    (payload.floors ?? []).length > 0
  ) {
    const newByType = new Map(
      (payload.floors ?? []).map((f) => [
        f.type,
        normalizeText(f.details ?? null),
      ]),
    );
    let matching = 0;
    let considered = 0;
    for (const f of existing.floors) {
      const nd = newByType.get(f.type);
      if (nd === undefined) continue;
      considered++;
      const exD = normalizeText(f.details);
      if (exD && nd && tokenOverlap(exD, nd) >= 0.5) matching++;
    }
    floorDetailsMatch =
      considered > 0 && matching >= Math.ceil(considered / 2);
  }

  // A real plot match plus a real owner identifier is enough to establish the
  // same physical house when the block is missing or incomplete. The owner
  // signal must be present on BOTH sides; two missing owners never confirm.
  const strongOwnerEvidence =
    ownerPhoneMatch ||
    (ownerNameMatch &&
      (areaMatch || floorCountMatch || floorTypesMatch || floorDetailsMatch));
  if (plotMatch && !blockConflict && strongOwnerEvidence) {
    return 'CONFIRMED';
  }

  // --- Supporting evidence scoring (POTENTIAL only) ---
  let score = 0;
  if (plotMatch) score += 3;
  if (blockMatch) score += 3;
  if (ownerNameMatch) score += 2;
  if (ownerPhoneMatch) score += 2;
  if (areaMatch) score += 1;
  if (floorCountMatch) score += 1;
  if (floorTypesMatch) score += 1;
  if (floorDetailsMatch) score += 1;

  // Description similarity (weak supporting evidence).
  const exDesc = normalizeText(existing.description ?? null);
  const newDesc = normalizeText(payload.description ?? null);
  if (exDesc && newDesc && tokenOverlap(exDesc, newDesc) >= 0.6) {
    score += 1;
  }

  const hasStrongMatch = plotMatch || blockMatch;

  // Threshold for POTENTIAL:
  //   - When an authoritative identifier contradicts (block conflict), require
  //     a stronger body of evidence (score >= 5): the plot match (3) plus at
  //     least two independent supporting points. This prevents a single shared
  //     plot number from creating a false alert.
  //   - Otherwise, a plot/block match plus at least one supporting point
  //     (score >= 4) is enough.
  const minScore = identityConflict ? 5 : 4;
  if (hasStrongMatch && score >= minScore) {
    return 'POTENTIAL';
  }

  // A real plot match with no block contradiction is still suspicious even when
  // the rest of the row is sparse: send it to manual review, never call it a
  // confirmed match.
  if (plotMatch && !blockConflict) {
    return 'POTENTIAL';
  }

  return 'DISTINCT';
}

/**
 * Token-overlap (Jaccard) similarity between two normalized texts.
 * Returns 0..1. Used only as weak supporting evidence.
 */
function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(/\s+/).filter(Boolean));
  const tb = new Set(b.split(/\s+/).filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function isDuplicateDecisionReason(reason?: string | null): boolean {
  const text = normalizeText(reason);
  if (!text) return false;
  return ['مكرر', 'تكرار', 'مشابه', 'تشابه', 'duplicate'].some((word) =>
    text.includes(normalizeText(word)),
  );
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
    idempotencyKey?: string,
  ): Promise<PropertyViewDto> {
    this.validateCreateShape(payload);
    const detected = this.files.assertValidImage(file);
    const sanitized = await this.files.sanitizeImage(file!.buffer, detected);
    const key = await this.files.persistBytes(sanitized.buffer, sanitized);
    const submitKey = normalizeIdempotencyKey(idempotencyKey);
    try {
      const result = await this.prisma.$transaction(
        async (tx): Promise<CreatePropertyOutcome> => {
        // Serialize retries of the SAME logical operation before touching the
        // duplicate detection or allocating anything. The committed AuditLog
        // row is the replay marker, so a timeout retry returns the original
        // outcome instead of creating a second property/P code/approval row.
        if (submitKey) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`SUBMIT:${viewer.id}:${submitKey}`})::bigint)`;
          const replay = await this.findIdempotentOutcome(
            tx,
            viewer.id,
            submitKey,
          );
          if (replay) return replay;
        }
        // --- Duplicate detection (advisory-locked) ---
        const identity = resolveIdentity(payload);
        if (identity.lockKey) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identity.lockKey})::bigint)`;
        }
        let ownerName: string | null = null;
        let ownerPhone: string | null = null;
        if (payload.newContact) {
          ownerName = payload.newContact.name;
          ownerPhone = payload.newContact.phone;
        } else if (payload.contactId) {
          const c = await tx.contact.findUnique({
            where: { id: payload.contactId },
            select: { name: true, phone: true },
          });
          ownerName = c?.name ?? null;
          ownerPhone = c?.phone ?? null;
        }
        const candidates = await tx.property.findMany({
          where: {
            status: { in: ACTIVE_DUPLICATE_STATUSES },
            deletedAt: null,
            ...(identity.where.governorate
              ? { governorate: identity.where.governorate }
              : {}),
            ...(identity.where.district ? { district: identity.where.district } : {}),
          },
          select: {
            id: true,
            reference: true,
            approvedReference: true,
            status: true,
            governorate: true,
            district: true,
            block: true,
            plotNumber: true,
            address: true,
            sizeSqm: true,
            floorCount: true,
            listingType: true,
            description: true,
            proposedOwner: true,
            contact: { select: { name: true, phone: true } },
            floors: { select: { type: true, details: true } },
          },
        });
        let classification: 'CONFIRMED' | 'POTENTIAL' | 'DISTINCT' = 'DISTINCT';
        let matchedProperty: { id: string; reference: string; status: PropertyStatus } | null = null;
        for (const candidate of candidates) {
          const candidateContact =
            candidate.contact ?? this.parseProposedOwner(candidate.proposedOwner);
          const r = classifyDuplicate(
            { ...candidate, contact: candidateContact },
            payload,
            ownerName,
            ownerPhone,
          );
          if (r === 'CONFIRMED') {
            classification = 'CONFIRMED';
            matchedProperty = {
              id: candidate.id,
              reference:
                candidate.approvedReference ?? candidate.reference,
              status: candidate.status,
            };
            break;
          }
          if (r === 'POTENTIAL' && !matchedProperty) {
            classification = 'POTENTIAL';
            matchedProperty = {
              id: candidate.id,
              reference:
                candidate.approvedReference ?? candidate.reference,
              status: candidate.status,
            };
          }
        }
        if (identity.incomplete && classification === 'DISTINCT') {
          throw new BadRequestException(
            'لا يمكن إضافة العقار بدون تفاصيل تحديد كافية (القطعة/القسيمة أو العنوان).',
          );
        }
        // Confirmed duplicate: persist the Manager alert and the idempotency
        // marker in THIS transaction, then let the caller turn the committed
        // result into an HTTP 409. No Property, approval request or P/A code is
        // created, and the submitting employee never learns the existing code.
        if (classification === 'CONFIRMED' && matchedProperty) {
          const mp = matchedProperty;
          const attemptedAt = new Date();
          const fingerprint = duplicateAttemptFingerprint({
            governorate: payload.governorate,
            district: payload.district,
            block: payload.block,
            plotNumber: payload.plotNumber,
            address: payload.address,
            ownerName,
            ownerPhone,
            sizeSqm: payload.sizeSqm ?? null,
            floorCount: payload.floorCount ?? null,
            listingType: payload.listingType,
          });
          await this.notifications.notifyDuplicateAttempt(
            tx,
            {
              propertyId: mp.id,
              reference: mp.reference,
              creatorId: viewer.id,
              approvalRequestId: null,
              version: 0,
            },
            { fingerprint, attemptedAt },
          );
          if (submitKey) {
            await tx.auditLog.create({
              data: {
                actorId: viewer.id,
                action: 'PROPERTY_DUPLICATE_BLOCKED',
                entityType: 'Property',
                entityId: mp.id,
                after: {
                  idempotencyKey: submitKey,
                  fingerprint,
                  matchedReference: mp.reference,
                },
              },
            });
          }
          return { confirmed: true, matchedProperty: mp, propertyId: null };
        }

        const potentialMatchId =
          classification === 'POTENTIAL' && matchedProperty
            ? matchedProperty.id
            : null;
        const potentialMatchRef =
          classification === 'POTENTIAL' && matchedProperty
            ? matchedProperty.reference
            : null;

        // --- Create property ---
        // OWNER is the highest authority and may create an AVAILABLE row.
        // MANAGER and EMPLOYEE submissions BOTH enter the PENDING review flow;
        // a Manager can never bypass review through direct creation.
        const requiresReview = !isOwner(viewer);
        // P codes are independent from the official A sequence. Both are
        // allocated INSIDE this transaction, so a rolled-back 409 consumes
        // neither, and concurrent submissions/approvals never duplicate.
        const reference = requiresReview
          ? await nextSubmissionCode(tx)
          : await allocateOfficialCode(tx);
        // Employee submissions stage the owner as provisional data on the
        // property. An official Contact is created only at Manager approval.
        const provisionalOwner =
          requiresReview && payload.newContact
            ? this.toProposedOwner(payload.newContact)
            : null;
        // A review submission's NEW contact is provisional until approval. An
        // EXISTING contactId is already official and may be linked as-is.
        const contact =
          requiresReview && payload.newContact
            ? null
            : await this.resolveContactInTx(tx, viewer, payload);
        const district = trimOrNull(payload.district);
        const governorate = trimOrNull(payload.governorate);
        const property = await tx.property.create({
          data: {
            reference,
            approvedReference: requiresReview ? null : reference,
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
            status: requiresReview
              ? PropertyStatus.PENDING
              : PropertyStatus.AVAILABLE,
            listingType: payload.listingType,
            description: trimOrNull(payload.description),
            contactId: contact?.id ?? null,
            ...(provisionalOwner
              ? { proposedOwner: provisionalOwner as Prisma.InputJsonValue }
              : {}),
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
        if (requiresReview)
          await tx.propertyApprovalRequest.create({
            data: {
              propertyId: property.id,
              requestedById: viewer.id,
              status: ApprovalStatus.PENDING,
              ...(potentialMatchId
                ? { duplicateCandidateIds: [potentialMatchId] }
                : {}),
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
              ...(submitKey ? { idempotencyKey: submitKey } : {}),
            },
          },
        });
        const eventContext: PropertyEventContext = {
          propertyId: property.id,
          reference: property.reference,
          creatorId: property.createdByUserId,
          approvalRequestId: null,
          version: property.version,
        };
        if (requiresReview) {
          if (potentialMatchId && potentialMatchRef) {
            await this.notifyPotentialDuplicate(
              tx,
              viewer,
              property.id,
              property.reference,
              potentialMatchId,
              potentialMatchRef,
            );
          } else {
            await this.notifications.notifyPropertySubmitted(tx, eventContext);
          }
        } else {
          await this.notifications.notifyPropertyAvailable(tx, eventContext);
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
        return {
          confirmed: false,
          matchedProperty: null,
          propertyId: property.id,
          replayed: false,
        };
      });

      if (result.confirmed) {
        throw new ConflictException(
          'لا يمكن إضافة العقار، لأنه مسجّل بالفعل في النظام.',
        );
      }
      // A replayed success keeps the ORIGINAL property; the image bytes this
      // retry uploaded are not linked to anything and must be discarded.
      if (result.replayed) await this.files.discard(key);
      return await this.getAuthorizedDetail(viewer, result.propertyId!);
    } catch (error) {
      await this.files.discard(key);
      throw error;
    }
  }

  /**
   * Looks up a previously COMMITTED result for the same client operation id.
   *
   * There is no dedicated idempotency table (and therefore no migration):
   * `AuditLog` already records every property creation and is written in the
   * same transaction as the property/P-code/approval row. The blocked-attempt
   * audit is written in the same committed transaction as its Manager alert.
   */
  private async findIdempotentOutcome(
    tx: Prisma.TransactionClient,
    actorId: string,
    idempotencyKey: string,
  ): Promise<CreatePropertyOutcome | null> {
    const rows = await tx.$queryRaw<
      Array<{ entityId: string; action: string }>
    >`
      SELECT "entityId", action
      FROM "AuditLog"
      WHERE "actorId" = ${actorId}::uuid
        AND "after"->>'idempotencyKey' = ${idempotencyKey}
        AND action IN ('PROPERTY_CREATE', 'PROPERTY_DUPLICATE_BLOCKED')
      ORDER BY "createdAt" ASC
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    if (row.action === 'PROPERTY_DUPLICATE_BLOCKED') {
      return {
        confirmed: true,
        matchedProperty: null,
        propertyId: null,
        replayed: true,
      };
    }
    const property = await tx.property.findFirst({
      where: {
        id: row.entityId,
        createdByUserId: actorId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!property) return null;
    return {
      confirmed: false,
      matchedProperty: null,
      propertyId: property.id,
      replayed: true,
    };
  }

  async countMine(viewer: AuthUser): Promise<number> {
    return this.prisma.property.count({
      where: { createdByUserId: viewer.id, deletedAt: null },
    });
  }

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
          { approvedReference: { startsWith: search.trim().toUpperCase() } },
          {
            approvedReference: { contains: search, mode: 'insensitive' },
          },
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

  private async notifyPotentialDuplicate(
    tx: Prisma.TransactionClient,
    viewer: AuthUser,
    propertyId: string,
    _propertyReference: string,
    matchId: string,
    _matchRef: string,
  ): Promise<void> {
    // OWNERs + the submitter's current Manager only. Never another team.
    const recipients = await reviewNotificationRecipientIds(tx, {
      id: viewer.id,
      role: viewer.role,
    });
    // Human-readable only: the codes, the submitter's display name and the
    // review status are resolved from their records at READ time (see the
    // notifications service). The stored message never carries a UUID or any
    // technical payload.
    await tx.notification.createMany({
      data: recipients.map((userId: string) => ({
        userId,
        type: NotificationType.SYSTEM,
        title: 'عقار مشابه يحتاج إلى مراجعة',
        body: 'تم اكتشاف تشابه محتمل بين عقارين في النظام. يُرجى مراجعة البيانات قبل اتخاذ القرار.',
        propertyId,
        eventKey: `POTENTIAL_DUPLICATE:${propertyId}:${matchId}`,
      })),
      skipDuplicates: true,
    });
  }

  async approve(
    viewer: AuthUser,
    id: string,
    dto: ApprovePropertyDto,
  ): Promise<PropertyViewDto> {
    const existing = await this.requireExisting(id);
    await assertPropertyReviewPermission(
      this.prisma,
      viewer,
      existing,
      'APPROVE',
    );
    // Potential-duplicate review gate.
    const latestApproval = await this.prisma.propertyApprovalRequest.findFirst({
      where: { propertyId: id },
      orderBy: { createdAt: 'desc' },
      select: { duplicateCandidateIds: true },
    });
    const candidateIds = latestApproval?.duplicateCandidateIds as string[] | null;
    if (Array.isArray(candidateIds) && candidateIds.length > 0 && !dto.approveAsDistinct) {
      throw new BadRequestException(
        'يجب مراجعة العقار المحتمل التكرار وتأكيده كعقار مختلف قبل الاعتماد.',
      );
    }
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
      // Official A code: assigned only at the successful approval, inside the
      // transaction (a failed/stale approval rolls the allocation back). Legacy
      // pending rows that already carry an A-style reference keep that code
      // instead of consuming another one.
      let approvedReference = existing.approvedReference;
      if (!approvedReference) {
        approvedReference = /^A-\d{6}$/.test(existing.reference)
          ? existing.reference
          : await allocateOfficialCode(tx);
        await tx.property.update({
          where: { id },
          data: { approvedReference },
        });
      }
      // Promote a provisional employee-submitted owner ONLY now, at approval,
      // atomically with the status transition.
      const promotedOwnerId = await this.promoteProvisionalOwner(tx, existing);
      if (promotedOwnerId && promotedOwnerId !== existing.contactId) {
        await tx.property.update({
          where: { id },
          data: { contactId: promotedOwnerId, proposedOwner: Prisma.DbNull },
        });
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
        // The approval notification uses the OFFICIAL A code assigned in this
        // transaction, never the original P submission code.
        reference: approvedReference ?? existing.reference,
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
    await assertPropertyReviewPermission(
      this.prisma,
      viewer,
      existing,
      'REJECT',
    );
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
      await this.notifications.notifyPropertyRejected(
        tx,
        {
          propertyId: id,
          reference: existing.reference,
          creatorId: existing.createdByUserId,
          approvalRequestId,
          version: existing.version + 1,
        },
        {
          reason,
          decidedAt: new Date(),
          isDuplicate: isDuplicateDecisionReason(reason),
        },
      );
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
    await assertPropertyReviewPermission(
      this.prisma,
      viewer,
      existing,
      'CHANGES',
    );
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
      // A PENDING edit can change the duplicate picture. The advisory lock is
      // taken on the NEW identity BEFORE the row is written, exactly like the
      // create path, so a concurrent create/edit of the same house can never
      // miss the other side and leave the manager with stale candidates.
      const recalculatesDuplicates =
        existing.status === PropertyStatus.PENDING;
      const recalculatedIdentity = recalculatesDuplicates
        ? resolveIdentity({
            governorate:
              payload.governorate !== undefined
                ? payload.governorate
                : existing.governorate,
            district:
              payload.district !== undefined
                ? payload.district
                : existing.district,
            block:
              payload.block !== undefined ? payload.block : existing.block,
            plotNumber:
              payload.plotNumber !== undefined
                ? payload.plotNumber
                : existing.plotNumber,
            address:
              payload.address !== undefined ? payload.address : existing.address,
          })
        : null;
      if (recalculatedIdentity?.lockKey) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${recalculatedIdentity.lockKey})::bigint)`;
      }
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
        if (viewer.role === Role.EMPLOYEE) {
          // An employee's owner change stays provisional: never an official
          // Contact before approval. The old link (if any) is detached, not
          // deleted.
          data.proposedOwner = this.toProposedOwner(payload.newContact) as Prisma.InputJsonValue;
          data.contactId = null;
        } else {
          const contact = await tx.contact.create({
            data: {
              type: payload.newContact.type,
              name: payload.newContact.name.trim(),
              phone: payload.newContact.phone.trim(),
              notes: trimOrNull(payload.newContact.notes),
              responsibleUserId: null,
            },
          });
          data.contactId = contact.id;
          data.proposedOwner = Prisma.DbNull;
        }
      } else if (payload.contactId) {
        const contact = await this.contacts.requireUsableContact(
          viewer,
          payload.contactId,
          tx,
        );
        data.contactId = contact.id;
        data.proposedOwner = Prisma.DbNull;
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

      // The genuine field changes of THIS save, used both for the edit
      // notification and for the manager's approval copy. PENDING edits keep
      // their status, so their changes are computed after every write below.
      let editChanges: PropertyChange[] = [];
      // A replacement image staged with an open PENDING round. It is not the
      // property's image yet, but the manager is told that it will change.
      let roundPendingImageId: string | null = null;

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
        roundPendingImageId = pendingImageId;
        editChanges = changes;
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
          // The current public code of the row being reviewed: A for a property
          // that was already in the program, P for a first submission.
          reference: existing.approvedReference ?? existing.reference,
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
          roundPendingImageId = asset.id;
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

      // PENDING edits keep their status, so their genuine changes are measured
      // against the pre-save baseline captured above (after every write).
      if (!returnsToReview) {
        const submitted = await capturePropertySnapshot(tx, id);
        const effective = submitted
          ? {
              ...submitted,
              primaryImageId:
                roundPendingImageId ?? submitted.primaryImageId,
            }
          : null;
        editChanges = effective
          ? diffPropertySnapshots(baseline, effective)
          : [];
      }

      // Recalculate the potential-duplicate candidates from the SAVED row, so
      // the Manager's open review drawer and its comparison always reflect the
      // edit instead of the candidates captured at submission time.
      if (recalculatesDuplicates && recalculatedIdentity) {
        await this.recalculateDuplicateCandidates(tx, id, recalculatedIdentity);
      }

      // Only an employee's genuine change to a still-PENDING property notifies
      // the Manager. A no-op save, a failed save and an approved-row edit (which
      // opens a new review round with its own RESUBMITTED event) send nothing.
      if (
        recalculatesDuplicates &&
        viewer.role === Role.EMPLOYEE &&
        editChanges.length > 0
      ) {
        const actor = await tx.user.findUnique({
          where: { id: viewer.id },
          select: { name: true },
        });
        await this.notifications.notifyPropertyEdited(
          tx,
          {
            propertyId: id,
            reference: existing.approvedReference ?? existing.reference,
            creatorId: existing.createdByUserId,
            approvalRequestId: null,
            version: existing.version + 1,
          },
          {
            employeeName: actor?.name ?? 'موظف',
            changeSummary: formatPropertyChanges(editChanges),
            editedAt: new Date(),
          },
        );
      }

      await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action: 'PROPERTY_UPDATE',
          entityType: 'Property',
          entityId: id,
          after: {
            status: returnsToReview ? PropertyStatus.PENDING : existing.status,
            ...(editChanges.length
              ? { changedFields: editChanges.map((change) => change.label) }
              : {}),
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

  /**
   * Recomputes the ACTIVE properties that may duplicate the freshly saved row
   * and stores their ids on the latest review round. This is the edit-time twin
   * of the create-time detection: the classifier is unchanged (and still never
   * treats two missing values as evidence), but it now runs against the row the
   * employee actually saved.
   *
   * Confirmed and potential matches are both kept: the Manager must explicitly
   * review a match before approving; create-time CONFIRMED rejection remains
   * untouched.
   */
  private async recalculateDuplicateCandidates(
    tx: Prisma.TransactionClient,
    propertyId: string,
    identity: { where: { governorate?: string; district?: string } },
  ): Promise<string[]> {
    const updated = await tx.property.findUnique({
      where: { id: propertyId },
      select: {
        governorate: true,
        district: true,
        block: true,
        plotNumber: true,
        address: true,
        sizeSqm: true,
        floorCount: true,
        listingType: true,
        description: true,
        proposedOwner: true,
        contact: { select: { name: true, phone: true } },
        floors: { select: { type: true, details: true } },
      },
    });
    if (!updated) return [];

    const provisional =
      updated.contact ?? this.parseProposedOwner(updated.proposedOwner);
    const classificationPayload = {
      governorate: updated.governorate,
      district: updated.district,
      block: updated.block,
      plotNumber: updated.plotNumber,
      address: updated.address,
      sizeSqm: updated.sizeSqm ? updated.sizeSqm.toString() : null,
      floorCount: updated.floorCount,
      listingType: updated.listingType,
      description: updated.description,
      floors: updated.floors.map((floor) => ({
        type: floor.type,
        details: floor.details,
      })),
      newContact: provisional
        ? { name: provisional.name, phone: provisional.phone }
        : null,
    };

    const candidates = await tx.property.findMany({
      where: {
        id: { not: propertyId },
        status: { in: ACTIVE_DUPLICATE_STATUSES },
        deletedAt: null,
        ...(identity.where.governorate
          ? { governorate: identity.where.governorate }
          : {}),
        ...(identity.where.district
          ? { district: identity.where.district }
          : {}),
      },
      select: {
        id: true,
        reference: true,
        approvedReference: true,
        status: true,
        governorate: true,
        district: true,
        block: true,
        plotNumber: true,
        address: true,
        sizeSqm: true,
        floorCount: true,
        listingType: true,
        description: true,
        proposedOwner: true,
        contact: { select: { name: true, phone: true } },
        floors: { select: { type: true, details: true } },
      },
    });

    const candidateIds: string[] = [];
    for (const candidate of candidates) {
      const candidateContact =
        candidate.contact ?? this.parseProposedOwner(candidate.proposedOwner);
      const result = classifyDuplicate(
        { ...candidate, contact: candidateContact },
        classificationPayload,
        provisional?.name ?? null,
        provisional?.phone ?? null,
      );
      if (result !== 'DISTINCT') candidateIds.push(candidate.id);
    }

    const latest = await tx.propertyApprovalRequest.findFirst({
      where: { propertyId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (latest) {
      await tx.propertyApprovalRequest.update({
        where: { id: latest.id },
        data: { duplicateCandidateIds: candidateIds },
      });
    }
    return candidateIds;
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
      // The duplicate candidates were recalculated by the employee's edit and
      // live on the previous round. Carry them into the new round, otherwise a
      // correction + resubmission would silently lose the Manager's comparison.
      const previousRound = await tx.propertyApprovalRequest.findFirst({
        where: { propertyId: id },
        orderBy: { createdAt: 'desc' },
        select: { duplicateCandidateIds: true },
      });
      const carriedCandidates = Array.isArray(
        previousRound?.duplicateCandidateIds,
      )
        ? (previousRound.duplicateCandidateIds as Prisma.InputJsonValue)
        : undefined;
      // Preserve review history: a NEW pending request is created while the
      // previous REJECTED / CHANGES_REQUESTED request row remains untouched.
      const request = await tx.propertyApprovalRequest.create({
        data: {
          propertyId: id,
          requestedById: viewer.id,
          status: ApprovalStatus.PENDING,
          ...(carriedCandidates !== undefined
            ? { duplicateCandidateIds: carriedCandidates }
            : {}),
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
      // A correction SAVED by the employee already sent the Manager the
      // «تم تعديل عقار تحت المراجعة» alert. This resubmission is the separate
      // event that puts the row back in the actionable review queue.
      await this.notifications.notifyPropertyResubmitted(tx, {
        propertyId: id,
        reference: existing.approvedReference ?? existing.reference,
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

  // ---------------------------------------------------------------------------
  // Trash (OWNER-only)
  // ---------------------------------------------------------------------------

  private assertTrashAccess(viewer: AuthUser): void {
    if (!isOwner(viewer))
      throw new ForbiddenException(
        'Only the OWNER can manage the property trash',
      );
  }

  /** OWNER sees every trashed row. */
  private trashedScopeWhere(viewer: AuthUser): Prisma.PropertyWhereInput {
    if (isOwner(viewer)) return {};
    return {
      OR: [
        { createdByUserId: viewer.id },
        { createdByUser: { employee: { managerUserId: viewer.id } } },
      ],
    };
  }

  private async assertTrashedScope(
    viewer: AuthUser,
    createdByUserId: string | null,
  ): Promise<void> {
    if (isOwner(viewer)) return;
    if (!createdByUserId)
      throw new NotFoundException('Property not found');
    if (createdByUserId === viewer.id) return;
    const member = await this.prisma.employeeProfile.findFirst({
      where: { userId: createdByUserId, managerUserId: viewer.id },
      select: { id: true },
    });
    if (!member) throw new NotFoundException('Property not found');
  }

  private async getTrashedDetail(
    viewer: AuthUser,
    id: string,
  ): Promise<PropertyViewDto> {
    const property = await this.prisma.property.findUnique({
      where: { id },
      include: propertyDetailInclude,
    });
    if (!property) throw new NotFoundException('Property not found');
    return serializeProperty(property, viewer);
  }

  /** Manager-only list of soft-deleted properties (Trash). */
  async listTrash(viewer: AuthUser): Promise<PropertyPageDto> {
    this.assertTrashAccess(viewer);
    const rows = await this.prisma.property.findMany({
      where: {
        deletedAt: { not: null },
        ...this.trashedScopeWhere(viewer),
      },
      include: propertyDetailInclude,
      orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
    });
    return {
      items: rows.map((row) => serializeProperty(row, viewer)),
      nextCursor: null,
    };
  }

  /**
   * Soft delete: move a property to Trash. The row, its code, owner/contact
   * association, floors, images and history are preserved. Owner/Contact/Client
   * records are NEVER touched.
   */
  async softDelete(
    viewer: AuthUser,
    id: string,
    reason?: string,
  ): Promise<PropertyViewDto> {
    this.assertTrashAccess(viewer);
    const existing = await this.prisma.property.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Property not found');
    await this.assertTrashedScope(viewer, existing.createdByUserId);
    if (existing.deletedAt)
      throw new ConflictException('العقار موجود في سلة المحذوفات بالفعل.');
    await this.prisma.$transaction(async (tx) => {
      await tx.property.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          deletedByUserId: viewer.id,
          deletionReason: reason?.trim() || null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action: 'PROPERTY_TRASH',
          entityType: 'Property',
          entityId: id,
          before: { status: existing.status, deletedAt: null },
          after: {
            status: existing.status,
            deletedAt: new Date().toISOString(),
            reason: reason?.trim() || null,
          },
        },
      });
      await this.notifications.notifyPropertyTrashed(
        tx,
        {
          propertyId: id,
          reference: existing.reference,
          creatorId: existing.createdByUserId,
          approvalRequestId: null,
          version: existing.version,
        },
        {
          reason: reason?.trim() || null,
          deletedAt: new Date(),
          isDuplicate: isDuplicateDecisionReason(reason),
        },
      );
    });
    // Owner/Contact/Client relation is untouched; the serialized row still
    // carries it (the Manager is authorized to see it).
    return this.getTrashedDetail(viewer, id);
  }

  /**
   * Restore a trashed property. The original code and all preserved relations
   * (owner/contact, floors, images, history) come back unchanged.
   *
   * Before reactivation we check for an equivalent ACTIVE property and refuse
   * silently creating a duplicate active house.
   */
  async restore(viewer: AuthUser, id: string): Promise<PropertyViewDto> {
    this.assertTrashAccess(viewer);
    const existing = await this.prisma.property.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Property not found');
    await this.assertTrashedScope(viewer, existing.createdByUserId);
    if (!existing.deletedAt)
      throw new BadRequestException('هذا العقار ليس في سلة المحذوفات.');
    const conflict = await this.findActiveIdentityConflict(existing);
    if (conflict)
      throw new ConflictException(
        `تعذّر الاستعادة: يوجد عقار نشط بنفس الهوية (${conflict.reference}). راجع العقار المتعارض أولاً.`,
      );
    const trashedAt = existing.deletedAt;
    await this.prisma.$transaction(async (tx) => {
      const restoredAt = new Date();
      await tx.property.update({
        where: { id },
        data: { deletedAt: null, deletedByUserId: null, deletionReason: null },
      });
      await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action: 'PROPERTY_RESTORE',
          entityType: 'Property',
          entityId: id,
          before: { deletedAt: existing.deletedAt?.toISOString() ?? null },
          after: {
            deletedAt: null,
            restoredAt: restoredAt.toISOString(),
          },
        },
      });
      // The restored property keeps its original status + code; only the
      // Trash marker is cleared. Notify the original creator inside the same
      // transaction so a failed restore never sends one.
      await this.notifications.notifyPropertyRestored(
        tx,
        {
          propertyId: id,
          reference: existing.approvedReference ?? existing.reference,
          creatorId: existing.createdByUserId,
          approvalRequestId: null,
          version: existing.version,
        },
        { restoredAt, trashedAt },
      );
    });
    return this.getAuthorizedDetail(viewer, id);
  }

  private async findActiveIdentityConflict(existing: {
    id: string;
    governorate: string | null;
    district: string | null;
    block: string | null;
    plotNumber: string | null;
    address: string | null;
  }): Promise<{ id: string; reference: string } | null> {
    const or: Prisma.PropertyWhereInput[] = [];
    if (existing.block && existing.plotNumber)
      or.push({ block: existing.block, plotNumber: existing.plotNumber });
    if (existing.address) or.push({ address: existing.address });
    if (or.length === 0) return null;
    return this.prisma.property.findFirst({
      where: {
        id: { not: existing.id },
        deletedAt: null,
        status: { in: ACTIVE_DUPLICATE_STATUSES },
        ...(existing.governorate ? { governorate: existing.governorate } : {}),
        ...(existing.district ? { district: existing.district } : {}),
        OR: or,
      },
      select: { id: true, reference: true },
    });
  }

  /**
   * Permanent deep delete of a property that is ALREADY in Trash.
   *
   * Deletes only property-exclusive data. Owner/Contact/Client records are
   * independent CRM entities and are deliberately never deleted. Owner-level
   * follow-up history is retained: its optional `propertyId` reference is
   * cleared (and the subject deactivated) instead of deleting the history.
   *
   * Protected financial/history dependencies (deals, manual expenses, client
   * interests) BLOCK the operation rather than being silently destroyed.
   */
  async permanentDelete(
    viewer: AuthUser,
    id: string,
    confirmationCode: string,
  ): Promise<{ id: string; reference: string }> {
    this.assertTrashAccess(viewer);
    const property = await this.prisma.property.findUnique({
      where: { id },
      include: {
        files: { select: { id: true, key: true } },
        deals: { select: { id: true } },
        manualExpenses: { select: { id: true } },
        propertyInterests: { select: { id: true } },
      },
    });
    if (!property) throw new NotFoundException('Property not found');
    await this.assertTrashedScope(viewer, property.createdByUserId);
    if (!property.deletedAt)
      throw new BadRequestException(
        'الحذف النهائي مسموح فقط للعقارات الموجودة في سلة المحذوفات.',
      );
    if (confirmationCode.trim() !== property.reference)
      throw new BadRequestException(
        'رمز التأكيد غير مطابق لرقم العقار. اكتب رقم العقار بالكامل.',
      );

    const blockers: string[] = [];
    if (property.deals.length) blockers.push('صفقات مرتبطة');
    if (property.manualExpenses.length) blockers.push('مصروفات مالية مرتبطة');
    if (property.propertyInterests.length) blockers.push('اهتمامات عملاء مرتبطة');
    if (blockers.length)
      throw new ConflictException(
        `لا يمكن الحذف النهائي: توجد ${blockers.join('، ')} تتطلب الاحتفاظ بها.`,
      );

    const fileKeys = property.files.map((file) => file.key);

    await this.prisma.$transaction(async (tx) => {
      // Owner-level follow-up history is RETAINED: only the optional property
      // reference is cleared so no broken FK remains.
      await tx.followUp.updateMany({
        where: { propertyId: id },
        data: { propertyId: null },
      });
      await tx.followUpSubject.updateMany({
        where: { propertyId: id },
        data: { propertyId: null, active: false, deactivatedAt: new Date() },
      });

      // Exclusive property data.
      // Keep the historical decision notifications (rejection / manager
      // deletion) in the employee inbox by detaching them from the row; every
      // other property notification is exclusive noise and is removed.
      await tx.notification.deleteMany({
        where: {
          propertyId: id,
          NOT: {
            OR: [
              { eventKey: { startsWith: 'PROPERTY_REJECTED:' } },
              { eventKey: { startsWith: 'PROPERTY_TRASHED:' } },
            ],
          },
        },
      });
      await tx.notification.updateMany({
        where: {
          propertyId: id,
          OR: [
            { eventKey: { startsWith: 'PROPERTY_REJECTED:' } },
            { eventKey: { startsWith: 'PROPERTY_TRASHED:' } },
          ],
        },
        data: { propertyId: null },
      });
      await tx.propertyApprovalRequest.deleteMany({ where: { propertyId: id } });
      await tx.propertyRevision.deleteMany({ where: { propertyId: id } });
      await tx.propertyFloor.deleteMany({ where: { propertyId: id } });
      await tx.requestedProperty.deleteMany({ where: { propertyId: id } });
      await tx.propertyRegistrant.deleteMany({ where: { propertyId: id } });
      await tx.propertyAssignment.deleteMany({ where: { propertyId: id } });

      // Release the primary-image FK before deleting the file rows.
      await tx.property.update({
        where: { id },
        data: { primaryImageId: null },
      });
      await tx.fileAsset.deleteMany({ where: { propertyId: id } });

      // Owner/Contact/Client and their history are intentionally NOT touched.
      await tx.property.delete({ where: { id } });

      // Minimal tombstone: reserves the code forever, no house/owner details.
      await tx.propertyTombstone.create({
        data: {
          reference: property.reference,
          deletedByUserId: viewer.id,
          summary: {
            governorate: property.governorate,
            district: property.district,
            block: property.block,
            plotNumber: property.plotNumber,
            listingType: property.listingType,
            submissionReference: property.reference,
            approvedReference: property.approvedReference,
            trashedAt: property.deletedAt?.toISOString() ?? null,
          },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: viewer.id,
          action: 'PROPERTY_PERMANENT_DELETE',
          entityType: 'Property',
          entityId: id,
          before: {
            reference: property.reference,
            status: property.status,
            deletedAt: property.deletedAt?.toISOString() ?? null,
          },
          after: { reference: property.reference, permanent: true },
        },
      });
    });

    // Best-effort file cleanup AFTER the DB commit (never leave a committed
    // deletion pointing at live bytes).
    for (const key of fileKeys) await this.files.discard(key);

    return { id, reference: property.reference };
  }

  /**
   * Read-only historical detail for the ORIGINAL submitter of a rejected or
   * soft-deleted property. Other employees get a non-disclosing 404, and a
   * permanently deleted row is gone (graceful unavailable message).
   */
  async history(viewer: AuthUser, id: string): Promise<PropertyViewDto> {
    const property = await this.prisma.property.findFirst({
      where: { id, createdByUserId: viewer.id },
      include: propertyDetailInclude,
    });
    if (!property) {
      throw new NotFoundException(
        'تفاصيل العقار لم تعد متاحة بعد الحذف النهائي.',
      );
    }
    return serializeProperty(property, viewer);
  }

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
    const property = await this.prisma.property.findFirst({
      where: { id, deletedAt: null },
    });
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

  private toProposedOwner(input: {
    type: ContactType;
    name: string;
    phone: string;
    notes?: string | null;
  }): { type: ContactType; name: string; phone: string; notes: string | null } {
    return {
      type: input.type,
      name: input.name.trim(),
      phone: input.phone.trim(),
      notes: trimOrNull(input.notes),
    };
  }

  private parseProposedOwner(value: Prisma.JsonValue | null): {
    type: ContactType;
    name: string;
    phone: string;
    notes: string | null;
  } | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    if (typeof v.name !== 'string' || typeof v.phone !== 'string') return null;
    return {
      type: v.type === 'BROKER' ? ContactType.BROKER : ContactType.OWNER,
      name: v.name,
      phone: v.phone,
      notes: typeof v.notes === 'string' ? v.notes : null,
    };
  }

  /**
   * Resolve/create the official owner at Manager approval time.
   * Reuses an existing Contact by NORMALIZED PHONE (never by name alone), and
   * serializes concurrent approvals of the same owner with an advisory lock.
   */
  private async promoteProvisionalOwner(
    tx: Prisma.TransactionClient,
    property: {
      contactId: string | null;
      proposedOwner: Prisma.JsonValue | null;
      createdByUserId: string | null;
    },
  ): Promise<string | null> {
    if (property.contactId) return property.contactId;
    const proposed = this.parseProposedOwner(property.proposedOwner);
    if (!proposed) return null;
    const phoneKey = normalizePhone(proposed.phone);
    const lockKey = `OWNER_PROMOTE:${phoneKey || normalizeText(proposed.name)}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;
    if (phoneKey) {
      const contacts = await tx.contact.findMany({
        select: { id: true, phone: true },
        orderBy: { createdAt: 'asc' },
      });
      const match = contacts.find((c) => normalizePhone(c.phone) === phoneKey);
      if (match) return match.id;
    }
    const created = await tx.contact.create({
      data: {
        type: proposed.type,
        name: proposed.name.trim(),
        phone: proposed.phone.trim(),
        notes: proposed.notes,
        responsibleUserId: property.createdByUserId,
      },
    });
    return created.id;
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


}
