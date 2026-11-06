import {
  ArrayMaxSize,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * One proposed property interest of a review submission — the same fields the
 * direct client save accepts. Existence/availability/visibility are ALWAYS
 * re-checked server-side inside the review/apply transactions.
 */
export class ReviewInterestInputDto {
  @IsUUID()
  propertyId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

/**
 * Body of `POST /client-reviews` (an employee submission) and of
 * `PATCH /client-reviews/:id` (an explicit refreshed proposal).
 *
 * `kind: 'CREATION'` proposes a NEW client (no `clientId`);
 * `kind: 'EDIT'` proposes changes to an existing approved client and MUST
 * carry its `clientId`. The linked-property interests are part of BOTH —
 * the review stages identity values AND the wizard request document AND
 * the recorded interest changes, and approval applies them atomically.
 */
export class SubmitClientReviewDto {
  @IsIn(['CREATION', 'EDIT'])
  kind!: 'CREATION' | 'EDIT';

  /** The approved client being edited (required for EDIT, absent for CREATION). */
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsString()
  @Length(1, 120)
  name!: string;

  @IsString()
  @Length(3, 32)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;

  /** The proposed structured wizard document — valid JSON, or null. */
  @IsOptional()
  @IsString()
  @MaxLength(100000)
  requestData?: string | null;

  /** Interests to upsert on approval (each validated server-side). */
  @IsOptional()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ReviewInterestInputDto)
  addInterests?: ReviewInterestInputDto[];

  /** EDIT only: property ids of recorded interests being removed. */
  @IsOptional()
  @ArrayMaxSize(10)
  @IsUUID(undefined, { each: true })
  removeInterests?: string[];

  /** The requester's note for the reviewer (review UI only). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  submissionNote?: string | null;

  /**
   * Requester-scoped idempotency key of THE wizard session (a UUID the
   * frontend keeps stable while the session lives). A repeated accidental
   * submission with the same key + same content resolves to the SAME review
   * instead of a duplicate row. Never returned for another requester.
   */
  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;
}

/** Body of `POST /client-reviews/:id/approve|reject|request-changes`. */
export class DecideClientReviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reviewNotes?: string | null;
}
