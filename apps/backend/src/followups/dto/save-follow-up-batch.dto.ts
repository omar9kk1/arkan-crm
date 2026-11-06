import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';

/**
 * Body of `POST /follow-ups/batch` — ONE safe, atomic save of a single phone
 * conversation covering several follow-up subjects (task §5).
 *
 * Validation contract (server-side, class-validator is the single source):
 *   - every submitted note must contain meaningful non-whitespace text —
 *     an EMPTY subject note is simply never submitted by the UI, and the API
 *     refuses whitespace-only notes instead of silently skipping them;
 *   - duplicate subject ids in one batch are rejected (each subject is saved
 *     at most once per submit, which the `(authorId, batchId, subjectId)`
 *     unique enforces at the database level);
 *   - the client-generated `batchId` makes a double-submitted/retried batch
 *     resolve to the ALREADY committed rows (idempotent replay), never to a
 *     second history entry.
 */
export class SaveFollowUpItemDto {
  /** The authorized follow-up subject (a foreign id answers 404). */
  @IsUUID()
  subjectId!: string;

  /** Hand-written note — must contain at least one non-whitespace char. */
  @IsString()
  @Length(1, 5000)
  @Matches(/\S/, {
    message: 'ملاحظة المتابعة لا يمكن أن تكون فارغة.',
  })
  note!: string;
}

export class SaveFollowUpBatchDto {
  /** One uuid per panel submit (idempotency/conversation correlation key). */
  @IsUUID()
  batchId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SaveFollowUpItemDto)
  items!: SaveFollowUpItemDto[];
}
